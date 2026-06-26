// 数据存储层 - 本地 localStorage + CloudBase 云端同步
const Storage = {
  keys: {
    income: 'fm_income',
    expense: 'fm_expense',
    cashAccounts: 'fm_cash_accounts',
    assets: 'fm_assets',
    insurance: 'fm_insurance',
    stocks: 'fm_stocks',
    rsu: 'fm_rsu',
    funds: 'fm_funds',
    loans: 'fm_loans',
    annuities: 'fm_annuities',
    notifications: 'fm_notifications'
  },

  // CloudBase 相关配置与状态
  cloudConfig: {
    env: null,
    collection: 'finance_data'
  },
  cloudApp: null,
  cloudDb: null,
  cloudSyncEnabled: false,
  cloudSyncing: false,
  cloudLastSync: null,
  cloudUser: null,
  cloudDocId: null,
  syncDebounceTimer: null,
  syncListeners: [],

  // 注册 CloudBase 同步状态监听器（用于 UI 更新）
  onSyncStatusChange(listener) {
    if (typeof listener === 'function') this.syncListeners.push(listener);
  },

  _emitSyncStatus() {
    const status = {
      enabled: this.cloudSyncEnabled,
      syncing: this.cloudSyncing,
      lastSync: this.cloudLastSync,
      user: this.cloudUser,
      docId: this.cloudDocId
    };
    this.syncListeners.forEach(fn => {
      try { fn(status); } catch (e) {}
    });
  },

  // 初始化 CloudBase
  async initCloudbase(config) {
    config = config || {};
    if (!config.env) {
      console.warn('[CloudBase] 未提供 env，跳过云端同步');
      return false;
    }
    if (typeof cloudbase === 'undefined') {
      console.warn('[CloudBase] SDK 未加载，跳过云端同步');
      return false;
    }
    try {
      this.cloudConfig.env = config.env;
      this.cloudApp = cloudbase.init({ env: config.env });
      this.cloudDb = this.cloudApp.database();
      this.cloudSyncEnabled = true;
      console.log('[CloudBase] 初始化成功，环境:', config.env);
      this._emitSyncStatus();
      return true;
    } catch (e) {
      console.error('[CloudBase] 初始化失败:', e);
      this.cloudSyncEnabled = false;
      return false;
    }
  },

  // 匿名登录
  async loginAnonymously() {
    if (!this.cloudSyncEnabled || !this.cloudApp) return false;
    try {
      this.cloudSyncing = true;
      this._emitSyncStatus();
      const auth = this.cloudApp.auth();
      const state = await auth.signInAnonymously();
      this.cloudUser = state.user || state;
      console.log('[CloudBase] 匿名登录成功:', this.cloudUser.uid || this.cloudUser.openid);
      await this.syncWithCloud();
      return true;
    } catch (e) {
      console.error('[CloudBase] 匿名登录失败:', e);
      return false;
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  // 邮箱登录
  async loginWithEmail(email, password) {
    if (!this.cloudSyncEnabled || !this.cloudApp) return false;
    try {
      this.cloudSyncing = true;
      this._emitSyncStatus();
      const auth = this.cloudApp.auth();
      const state = await auth.signInWithEmailAndPassword(email, password);
      this.cloudUser = state.user || state;
      console.log('[CloudBase] 邮箱登录成功:', this.cloudUser.uid || this.cloudUser.email);
      await this.syncWithCloud();
      return true;
    } catch (e) {
      console.error('[CloudBase] 邮箱登录失败:', e);
      throw e;
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  // 邮箱注册
  async registerWithEmail(email, password) {
    if (!this.cloudSyncEnabled || !this.cloudApp) return false;
    try {
      this.cloudSyncing = true;
      this._emitSyncStatus();
      const auth = this.cloudApp.auth();
      const state = await auth.signUpWithEmailAndPassword(email, password);
      this.cloudUser = state.user || state;
      console.log('[CloudBase] 邮箱注册成功:', this.cloudUser.uid || this.cloudUser.email);
      await this.syncWithCloud();
      return true;
    } catch (e) {
      console.error('[CloudBase] 邮箱注册失败:', e);
      throw e;
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  // 登出
  async logout() {
    if (!this.cloudApp || !this.cloudApp.auth) return;
    try {
      await this.cloudApp.auth().signOut();
      this.cloudUser = null;
      this.cloudDocId = null;
      this.cloudLastSync = null;
      this._emitSyncStatus();
    } catch (e) {
      console.error('[CloudBase] 登出失败:', e);
    }
  },

  // 从本地组装完整数据包
  _getLocalDataPackage() {
    const data = {};
    Object.keys(this.keys).forEach(k => {
      data[k] = this.get(this.keys[k]);
    });
    return {
      data: data,
      updatedAt: new Date().toISOString(),
      clientVersion: 'v62'
    };
  },

  // 将数据包写入本地
  _applyDataPackage(pkg) {
    if (!pkg || !pkg.data) return false;
    this._applyingCloudData = true;
    try {
      Object.keys(this.keys).forEach(k => {
        const incoming = Array.isArray(pkg.data[k]) ? pkg.data[k] : [];
        this.set(this.keys[k], incoming);
      });
      return true;
    } finally {
      this._applyingCloudData = false;
    }
  },

  // 合并两个数据包（按 id 去重，更新时间较新的优先）
  _mergeDataPackages(localPkg, cloudPkg) {
    const merged = { data: {}, updatedAt: new Date().toISOString(), clientVersion: 'v62' };
    Object.keys(this.keys).forEach(k => {
      const localArr = (localPkg && localPkg.data && Array.isArray(localPkg.data[k])) ? localPkg.data[k] : [];
      const cloudArr = (cloudPkg && cloudPkg.data && Array.isArray(cloudPkg.data[k])) ? cloudPkg.data[k] : [];
      const map = {};
      const mergeItem = (item) => {
        if (!item || !item.id) return;
        if (!map[item.id]) {
          map[item.id] = item;
        } else {
          const oldTime = new Date(map[item.id].updatedAt || map[item.id].createdAt || 0).getTime();
          const newTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
          if (newTime >= oldTime) map[item.id] = item;
        }
      };
      localArr.forEach(mergeItem);
      cloudArr.forEach(mergeItem);
      merged.data[k] = Object.values(map);
    });
    return merged;
  },

  // 从云端拉取数据
  async pullFromCloud() {
    if (!this.cloudSyncEnabled || !this.cloudDb) return null;
    const collection = this.cloudDb.collection(this.cloudConfig.collection);
    try {
      const res = await collection.limit(1).get();
      if (res.data && res.data.length > 0) {
        const doc = res.data[0];
        this.cloudDocId = doc._id;
        console.log('[CloudBase] 拉取到云端数据，docId:', doc._id);
        return doc;
      }
      console.log('[CloudBase] 云端无数据');
      return null;
    } catch (e) {
      console.error('[CloudBase] 拉取失败:', e);
      return null;
    }
  },

  // 推送数据到云端
  async pushToCloud(pkg) {
    if (!this.cloudSyncEnabled || !this.cloudDb) return false;
    if (!pkg) pkg = this._getLocalDataPackage();
    const collection = this.cloudDb.collection(this.cloudConfig.collection);
    try {
      if (this.cloudDocId) {
        await collection.doc(this.cloudDocId).update({
          data: {
            data: pkg.data,
            updatedAt: pkg.updatedAt,
            clientVersion: pkg.clientVersion
          }
        });
        console.log('[CloudBase] 更新云端数据成功');
      } else {
        const res = await collection.add({ data: pkg });
        this.cloudDocId = res.id;
        console.log('[CloudBase] 新增云端数据成功，docId:', res.id);
      }
      this.cloudLastSync = new Date().toISOString();
      return true;
    } catch (e) {
      console.error('[CloudBase] 推送失败:', e);
      return false;
    }
  },

  // 双向同步：拉取云端 + 合并 + 推送
  async syncWithCloud() {
    if (!this.cloudSyncEnabled || !this.cloudDb || !this.cloudUser) {
      console.log('[CloudBase] 未满足同步条件，跳过');
      return { success: false, reason: 'not-ready' };
    }
    if (this.cloudSyncing) {
      console.log('[CloudBase] 同步中，跳过');
      return { success: false, reason: 'syncing' };
    }
    this.cloudSyncing = true;
    this._emitSyncStatus();
    try {
      const localPkg = this._getLocalDataPackage();
      const cloudDoc = await this.pullFromCloud();
      const cloudPkg = cloudDoc ? {
        data: cloudDoc.data,
        updatedAt: cloudDoc.updatedAt,
        clientVersion: cloudDoc.clientVersion
      } : null;

      let mergedPkg;
      let source;
      if (!cloudPkg) {
        // 云端无数据，直接推送本地
        mergedPkg = localPkg;
        source = 'local';
      } else if (!localPkg.data || this._isEmptyData(localPkg.data)) {
        // 本地无数据，使用云端
        mergedPkg = cloudPkg;
        source = 'cloud';
      } else {
        // 合并，以 updatedAt 判断是否需要覆盖
        const localTime = new Date(localPkg.updatedAt || 0).getTime();
        const cloudTime = new Date(cloudPkg.updatedAt || 0).getTime();
        mergedPkg = this._mergeDataPackages(localPkg, cloudPkg);
        source = localTime >= cloudTime ? 'merge-local-newer' : 'merge-cloud-newer';
      }

      // 写回本地
      this._applyDataPackage(mergedPkg);

      // 推回云端（确保云端也是最新合并结果）
      const pushSuccess = await this.pushToCloud(mergedPkg);

      this.cloudLastSync = new Date().toISOString();
      console.log('[CloudBase] 同步完成，来源:', source);
      return { success: true, source: source, pushed: pushSuccess };
    } catch (e) {
      console.error('[CloudBase] 同步失败:', e);
      return { success: false, error: e.message };
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  _isEmptyData(data) {
    if (!data) return true;
    return Object.keys(data).every(k => !Array.isArray(data[k]) || data[k].length === 0);
  },

  // 触发云端同步（防抖，避免频繁写入）
  _triggerCloudSync() {
    if (!this.cloudSyncEnabled || !this.cloudUser) return;
    if (this._applyingCloudData) return; // 应用云端数据时不触发反向同步
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    this.syncDebounceTimer = setTimeout(() => {
      this.syncWithCloud().catch(e => console.error(e));
    }, 2000);
  },

  get(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      this._triggerCloudSync();
      return true;
    } catch (e) {
      return false;
    }
  },

  add(key, item) {
    const data = this.get(key);
    item.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    item.createdAt = new Date().toISOString();
    data.push(item);
    this.set(key, data);
    return item;
  },

  update(key, id, updates) {
    const data = this.get(key);
    const index = data.findIndex(item => item.id === id);
    if (index !== -1) {
      updates.updatedAt = new Date().toISOString();
      data[index] = { ...data[index], ...updates };
      this.set(key, data);
      return data[index];
    }
    return null;
  },

  delete(key, id) {
    const data = this.get(key);
    const filtered = data.filter(item => item.id !== id);
    this.set(key, filtered);
    return true;
  },

  // 快捷读取
  getCashAccounts() { return this.get(this.keys.cashAccounts); },
  getIncome()      { return this.get(this.keys.income); },
  getExpense()     { return this.get(this.keys.expense); },
  getAssets()      { return this.get(this.keys.assets); },
  getInsurance()   { return this.get(this.keys.insurance); },
  getStocks()      { return this.get(this.keys.stocks); },
  getRsu()         { return this.get(this.keys.rsu); },
  getFunds()       { return this.get(this.keys.funds); },
  getLoans()       { return this.get(this.keys.loans); },
  getAnnuities()   { return this.get(this.keys.annuities); },

  // 获取汇率（与 app.js 保持一致，含有效性校验）
  _getFxRates() {
    try {
      var raw = localStorage.getItem("fm_exchange_rates");
      var rates = raw ? JSON.parse(raw) : {};
      if (typeof rates !== 'object' || rates === null) rates = {};
      if (!rates.USDCNY || rates.USDCNY < 6) rates.USDCNY = 7.2;
      if (!rates.HKDCNY || rates.HKDCNY < 0.5) rates.HKDCNY = 0.92;
      return rates;
    } catch(e) { return {}; }
  },

  // 外币 → 人民币
  _toCNY(amount, currency) {
    var rates = this._getFxRates();
    var rate = 1;
    if (currency === "USD") rate = rates.USDCNY || 7.2;
    else if (currency === "HKD") rate = rates.HKDCNY || 0.92;
    return (parseFloat(amount) || 0) * rate;
  },

  // 计算总资产（统一按人民币计价）
  // 注意：RSU 未解禁部分不计入资产
  calcTotalAssets() {
    let total = 0;
    this.getStocks().forEach(s => {
      const shares = parseInt(s.shares) || 0;
      const price = parseFloat(s.currentPrice) || parseFloat(s.cost) || 0;
      const currency = s.currency || "CNY";
      const valueCNY = this._toCNY(shares * price, currency);
      total += valueCNY;
    });
    // RSU: 仅纳入已解禁部分
    this.getRsu().forEach(r => {
      var vested = parseInt(r.vested) || 0;
      if (vested > 0) {
        var price = parseFloat(r.currentPrice) || parseFloat(r.grantPrice) || 0;
        total += vested * price;
      }
    });
    // 基金：计入持仓金额
    this.getFunds().forEach(f => {
      total += parseFloat(f.holdValue) || 0;
    });
    // 企业年金：计入各组合余额
    this.getAnnuities().forEach(a => {
      total += parseFloat(a.balance) || 0;
    });
    // 保险沉淀资产：累计已缴保费（强资产型保单: 年金/万能/两全/返还型重疾）
    total += this.calcInsuranceSettledValue();
    // 现金资产：各账户余额（收入-支出）
    total += this.calcCashTotal();
    return total;
  },

  // 计算现金资产总额（各账户余额加总）
  calcCashTotal() {
    var accounts = this.get(this.keys.cashAccounts);
    var total = 0;
    accounts.forEach(function(a) { total += parseFloat(a.balance) || 0; });
    return total;
  },

  // 保险沉淀资产（=累计已缴保费, 纳入总资产）
  // 复用 app.js 的 calcInsurancePaidTotal 算法: paidUntil = nextPayDate.year - 1
  calcInsuranceSettledValue() {
    var list = this.get(this.keys.insurance);
    var total = 0;
    list.forEach(function(p) {
      var m = (p.payPeriod || "").match(/(\d{4})\s*-\s*(\d{4})/);
      if (!m) return;
      var startY = parseInt(m[1]);
      var endY = parseInt(m[2]);
      var premium = parseFloat(p.premium) || 0;
      var paidUntil = p.nextPayDate ? parseInt(p.nextPayDate.split('-')[0]) - 1 : startY - 1;
      for (var y = startY; y <= Math.min(endY, paidUntil); y++) {
        total += premium;
      }
    });
    return total;
  },

  // 保险沉淀资产在指定历史日期的金额
  // 口径：遍历 16 张保单，对每张保单:
  //   - 如果保单生效日 > targetDate → 0 (那时还没买)
  //   - 否则在 startY..endY 中, 对每个缴费年 y, 判断 targetDate 是否 ≥ 缴费年结束日
  //     (用次年 1 月 1 日作为缴费年结束日的代理: y 年内任一时点已缴 y 年)
  //   - 累计 ≤ 已经结束缴费的年数 × 年缴
  // 注意: nextPayDate 表示"下一次扣款日", 推算过去的"已缴年数" ≤ nextPayDate.year - 1
  calcInsuranceSettledValueAt(targetDate) {
    var list = this.get(this.keys.insurance);
    if (!(targetDate instanceof Date)) targetDate = new Date(targetDate);
    var targetY = targetDate.getFullYear();
    var total = 0;
    list.forEach(function(p) {
      var m = (p.payPeriod || "").match(/(\d{4})\s*-\s*(\d{4})/);
      if (!m) return;
      var startY = parseInt(m[1]);
      var endY = parseInt(m[2]);
      var premium = parseFloat(p.premium) || 0;

      // 1. 还没到生效年: 0
      if (targetY < startY) return;

      // 2. 已完全缴清: 全额
      if (targetY >= endY + 1) {
        total += premium * (endY - startY + 1);
        return;
      }

      // 3. 中间状态: 按"已结束缴费的年数" 累加
      // 已结束缴费的年数 = targetY - startY (targetY 这一年还没结束, 因为 nextPayDate 通常在年末)
      // 但更准确: 已缴年数 = min(endY, paidUntil) - startY + 1
      // 其中 paidUntil = nextPayDate.year - 1
      var paidUntil = p.nextPayDate ? parseInt(p.nextPayDate.split('-')[0]) - 1 : startY - 1;

      // 历史点: 该日已缴年数 = min(已过的年数, paidUntil - startY + 1)
      // 简化: 假设每年内一次性扣款, 在 nextPayDate 那天发生
      var yearsCompleted;
      if (p.nextPayDate) {
        var npParts = p.nextPayDate.split('-');
        var npDate = new Date(parseInt(npParts[0]), parseInt(npParts[1]) - 1, parseInt(npParts[2]));
        if (targetDate < npDate) {
          // 还没到下次扣款日: 已缴年数 = (nextPayDate.year - 1) - startY + 1
          yearsCompleted = paidUntil - startY + 1;
        } else {
          // 已过下次扣款日: 已缴年数 = (targetY - startY + 1), 但不超过 endY - startY + 1
          yearsCompleted = Math.min(targetY - startY + 1, endY - startY + 1);
        }
      } else {
        // 无 nextPayDate: 视为 targetY 那一年的下一年才扣, 已缴年数 = targetY - startY
        yearsCompleted = Math.max(0, targetY - startY);
      }
      yearsCompleted = Math.max(0, Math.min(endY - startY + 1, yearsCompleted));
      total += premium * yearsCompleted;
    });
    return total;
  },

  // 或有资产（保额/未来给付, 不纳入总资产, 仅展示）
  // 简版: 3 张重疾保单赔付 30万×3 = 90万
  // 识别: product 含 "重大疾病保险" 或 "重疾"
  calcInsuranceContingentAsset() {
    var list = this.get(this.keys.insurance);
    var total = 0;
    list.forEach(function(p) {
      var name = p.product || "";
      if (name.indexOf("重大疾病") >= 0 || name.indexOf("重疾") >= 0) {
        total += 300000; // 30 万/张
      }
    });
    return total;
  },

  // 或有负债（未来保费承诺, 不纳入总负债, 仅展示）
  // 口径: 16 张全期合计 - 已缴沉淀
  calcInsuranceContingentLiability() {
    var list = this.get(this.keys.insurance);
    var totalAll = 0, totalPaid = 0;
    list.forEach(function(p) {
      var m = (p.payPeriod || "").match(/(\d{4})\s*-\s*(\d{4})/);
      if (!m) return;
      var startY = parseInt(m[1]);
      var endY = parseInt(m[2]);
      var premium = parseFloat(p.premium) || 0;
      var n = endY - startY + 1;
      totalAll += premium * n;
      var paidUntil = p.nextPayDate ? parseInt(p.nextPayDate.split('-')[0]) - 1 : startY - 1;
      var paidY = Math.max(0, Math.min(endY, paidUntil) - startY + 1);
      totalPaid += premium * paidY;
    });
    return Math.max(0, totalAll - totalPaid);
  },

  // RSU 已解禁价值
  calcRsuVestedValue() {
    let total = 0;
    this.getRsu().forEach(r => {
      var vested = parseInt(r.vested) || 0;
      if (vested > 0) {
        var price = parseFloat(r.currentPrice) || parseFloat(r.grantPrice) || 0;
        total += vested * price;
      }
    });
    return total;
  },

  // RSU 未解禁价值（仅供参考，不计入资产）
  calcRsuLockedValue() {
    let total = 0;
    this.getRsu().forEach(r => {
      var totalShares = parseInt(r.totalShares) || 0;
      var vested = parseInt(r.vested) || 0;
      var locked = totalShares - vested;
      if (locked > 0) {
        var price = parseFloat(r.currentPrice) || parseFloat(r.grantPrice) || 0;
        var gp = parseFloat(r.grantPrice) || 0;
        total += Math.max(0, locked * (price - gp));
      }
    });
    return total;
  },

  // 计算总负债（优先使用 balance 字段，否则用 total - paid）
  calcTotalDebts() {
    let total = 0;
    this.getLoans().forEach(l => {
      var b = parseFloat(l.balance);
      if (b >= 0) {
        total += b;
      } else {
        const loanTotal = parseFloat(l.total) || 0;
        const loanPaid = parseFloat(l.paid) || 0;
        total += Math.max(0, loanTotal - loanPaid);
      }
    });
    return total;
  },

  // 净资产
  calcNetWorth() {
    return this.calcTotalAssets() - this.calcTotalDebts();
  },

  // 年金总额
  calcTotalAnnuities() {
    let total = 0;
    this.getAnnuities().forEach(a => { total += parseFloat(a.balance) || 0; });
    return total;
  },

  // 即将到期的保险提醒（30天内）
  getInsuranceReminders(daysAhead = 30) {
    const insurance = this.getInsurance();
    const now = new Date(); now.setHours(0,0,0,0);
    const reminders = [];

    insurance.forEach(item => {
      if (!item.nextPayDate) return;
      const parts = item.nextPayDate.split('-');
      const nextPay = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      const diffDays = Math.ceil((nextPay - now) / 86400000);
      if (diffDays >= 0 && diffDays <= daysAhead) {
        reminders.push({ ...item, daysLeft: diffDays });
      }
    });

    return reminders.sort((a, b) => a.daysLeft - b.daysLeft);
  },

  // 最近记录
  getRecentRecords(limit = 10) {
    const income  = this.getIncome().map(i => ({ ...i, type: 'income' }));
    const expense = this.getExpense().map(i => ({ ...i, type: 'expense' }));
    const all = [...income, ...expense];
    all.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    return all.slice(0, limit);
  },

  // 导出所有用户数据（不含汇率等可重新获取的临时数据）
  exportAllData() {
    const data = {};
    Object.keys(this.keys).forEach(k => {
      data[k] = this.get(this.keys[k]);
    });
    // 额外保留汇率，方便跨设备一致性
    try {
      const fx = localStorage.getItem('fm_exchange_rates');
      if (fx) data._exchangeRates = JSON.parse(fx);
    } catch (e) {}
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: data
    };
  },

  // 导入数据：mode = 'merge' | 'replace'
  importAllData(packageJson, mode) {
    mode = mode || 'merge';
    if (!packageJson || !packageJson.data) throw new Error('无效的数据文件');

    const imported = packageJson.data;
    const mergedSummary = {};

    Object.keys(this.keys).forEach(k => {
      const key = this.keys[k];
      const incoming = Array.isArray(imported[k]) ? imported[k] : [];
      if (mode === 'replace') {
        this.set(key, incoming);
        mergedSummary[k] = { before: 0, after: incoming.length, added: incoming.length };
        return;
      }

      // 智能合并：以 id 去重，导入数据优先（较新）
      const existing = this.get(key);
      const map = {};
      existing.forEach(item => { if (item && item.id) map[item.id] = item; });
      let added = 0, updated = 0;
      incoming.forEach(item => {
        if (!item || !item.id) return;
        if (!map[item.id]) {
          map[item.id] = item;
          added++;
        } else {
          // 以更新时间或创建时间较晚的为准
          const oldItem = map[item.id];
          const oldTime = new Date(oldItem.updatedAt || oldItem.createdAt || 0).getTime();
          const newTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
          if (newTime >= oldTime) {
            map[item.id] = item;
            updated++;
          }
        }
      });
      const merged = Object.values(map);
      this.set(key, merged);
      mergedSummary[k] = { before: existing.length, after: merged.length, added: added, updated: updated };
    });

    // 恢复汇率（可选）
    if (imported._exchangeRates && typeof imported._exchangeRates === 'object') {
      localStorage.setItem('fm_exchange_rates', JSON.stringify(imported._exchangeRates));
    }

    return mergedSummary;
  },

  // 清空所有本地数据
  clearAllData() {
    Object.keys(this.keys).forEach(k => localStorage.removeItem(this.keys[k]));
    localStorage.removeItem('fm_exchange_rates');
    return true;
  }
};
