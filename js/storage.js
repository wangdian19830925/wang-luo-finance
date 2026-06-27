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
  cloudLastSyncError: null,
  cloudInitError: null,
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
      lastError: this.cloudLastSyncError || this.cloudInitError,
      user: this.cloudUser,
      docId: this.cloudDocId
    };
    this.syncListeners.forEach(fn => {
      try { fn(status); } catch (e) {}
    });
  },

  // 登录模式持久化
  _LOGIN_MODE_KEY: 'fm_cloud_login_mode',
  _getLoginMode() {
    try { return localStorage.getItem(this._LOGIN_MODE_KEY); } catch (e) { return null; }
  },
  _setLoginMode(mode) {
    try { localStorage.setItem(this._LOGIN_MODE_KEY, mode || ''); } catch (e) {}
  },

  // 恢复已有会话（页面刷新后）
  async restoreSession() {
    if (!this.cloudSyncEnabled || !this.cloudApp) return { success: false, reason: 'not-ready' };
    const auth = this._getAuth();
    if (!auth) return { success: false, reason: 'no-auth' };

    try {
      // 优先检查 CloudBase 是否已有有效会话
      if (typeof auth.getSession === 'function') {
        const { data, error } = await auth.getSession();
        if (!error && data && data.session && data.session.user) {
          this.cloudUser = data.session.user;
          const uid = this._getUserId();
          console.log('[CloudBase] 会话已恢复:', uid || this.cloudUser.email || 'anonymous');
          this._emitSyncStatus();
          const syncResult = await this.syncWithCloud();
          return { success: syncResult.success, source: 'session-restored', reason: syncResult.error || syncResult.reason };
        }
      }

      // 无会话时根据上次登录模式处理
      const mode = this._getLoginMode();
      if (mode === 'anonymous') {
        console.log('[CloudBase] 上次为匿名登录，尝试自动匿名登录');
        const ok = await this.loginAnonymously();
        return { success: ok, source: 'anonymous-login' };
      }
      if (mode === 'email') {
        console.log('[CloudBase] 上次为邮箱登录，但会话已过期，等待用户手动登录');
        return { success: false, reason: 'needs-login' };
      }
      return { success: false, reason: 'no-session' };
    } catch (e) {
      console.error('[CloudBase] 恢复会话失败:', e);
      return { success: false, reason: e.message || String(e) };
    }
  },
  _getAuth() {
    if (!this.cloudApp) return null;
    // v2: app.auth 是对象，直接暴露 signInAnonymously 等方法
    if (this.cloudApp.auth && typeof this.cloudApp.auth === 'object') {
      return this.cloudApp.auth;
    }
    // v1: app.auth() 返回 auth 实例
    if (typeof this.cloudApp.auth === 'function') {
      return this.cloudApp.auth();
    }
    return null;
  },

  // 获取 Database 实例（兼容 SDK v2 / v1）
  _getDb() {
    if (!this.cloudApp) return null;
    if (typeof this.cloudApp.database === 'function') {
      return this.cloudApp.database();
    }
    if (this.cloudApp.database && typeof this.cloudApp.database === 'object') {
      return this.cloudApp.database;
    }
    return null;
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

      // 验证 Auth / Database 模块可用（兼容 v2 对象式与 v1 函数式）
      const auth = this._getAuth();
      const db = this._getDb();
      if (!auth) {
        throw new Error('CloudBase Auth 模块未加载，请确认已引入 cloudbase.full.js (v2)');
      }
      if (!db) {
        throw new Error('CloudBase Database 模块未加载，请确认已引入 cloudbase.full.js (v2)');
      }

      this.cloudDb = db;
      this.cloudSyncEnabled = true;
      console.log('[CloudBase] 初始化成功，环境:', config.env);
      this._emitSyncStatus();
      return true;
    } catch (e) {
      console.error('[CloudBase] 初始化失败:', e);
      this.cloudSyncEnabled = false;
      this.cloudInitError = e.message || String(e);
      this._emitSyncStatus();
      return false;
    }
  },

  // 匿名登录（CloudBase SDK v2: auth.signInAnonymously）
  async loginAnonymously() {
    if (!this.cloudSyncEnabled || !this.cloudApp) return false;
    try {
      this.cloudSyncing = true;
      this.cloudLastSyncError = null;
      this._emitSyncStatus();
      const auth = this._getAuth();
      if (!auth) throw new Error('Auth 模块不可用');

      let user = null;
      // v2 API: { data: { user, session }, error }
      if (typeof auth.signInAnonymously === 'function') {
        const { data, error } = await auth.signInAnonymously();
        if (error) throw error;
        user = (data && data.user) ? data.user : data;
      } else {
        // v1 兜底：anonymousAuthProvider().signIn()
        const provider = auth.anonymousAuthProvider ? auth.anonymousAuthProvider() : null;
        if (provider && typeof provider.signIn === 'function') {
          const state = await provider.signIn();
          user = (state && state.user) ? state.user : state;
        } else {
          throw new Error('未找到可用的匿名登录方法');
        }
      }

      this.cloudUser = user || { is_anonymous: true };
      const uid = (this.cloudUser.uid || this.cloudUser.id || this.cloudUser.openid || this.cloudUser.userId) || 'anonymous';
      console.log('[CloudBase] 匿名登录成功:', uid);
      this._setLoginMode('anonymous');

      const syncResult = await this.syncWithCloud();
      if (!syncResult.success) {
        throw new Error(syncResult.error || '同步失败');
      }
      return true;
    } catch (e) {
      console.error('[CloudBase] 匿名登录失败:', e);
      this.cloudLastSyncError = '匿名登录失败: ' + (e.message || String(e));
      this._emitSyncStatus();
      throw e;
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  // 邮箱登录（CloudBase SDK v2: auth.signInWithPassword）
  async loginWithEmail(email, password) {
    if (!this.cloudSyncEnabled || !this.cloudApp) return false;
    try {
      this.cloudSyncing = true;
      this.cloudLastSyncError = null;
      this._emitSyncStatus();
      const auth = this._getAuth();
      if (!auth) throw new Error('Auth 模块不可用');

      let user = null;
      // v2 API
      if (typeof auth.signInWithPassword === 'function') {
        const { data, error } = await auth.signInWithPassword({ email: email, password: password });
        if (error) throw error;
        user = (data && data.user) ? data.user : data;
      } else if (typeof auth.signInWithEmailAndPassword === 'function') {
        // v1 兜底
        const state = await auth.signInWithEmailAndPassword(email, password);
        user = (state && state.user) ? state.user : state;
      } else {
        throw new Error('未找到可用的邮箱登录方法');
      }

      this.cloudUser = user || { email: email };
      const uid = (this.cloudUser.uid || this.cloudUser.id || this.cloudUser.userId || this.cloudUser.email) || 'email';
      console.log('[CloudBase] 邮箱登录成功:', uid);
      this._setLoginMode('email');
      // 释放同步锁，避免 syncWithCloud 因自己持有锁而返回 syncing
      this.cloudSyncing = false;
      this._emitSyncStatus();
      const syncResult = await this.syncWithCloud();
      if (!syncResult.success) {
        throw new Error(syncResult.error || syncResult.reason || '同步失败');
      }
      return true;
    } catch (e) {
      console.error('[CloudBase] 邮箱登录失败:', e);
      this.cloudLastSyncError = '邮箱登录失败: ' + (e.message || String(e));
      this._emitSyncStatus();
      throw e;
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  // 邮箱注册（CloudBase SDK v2: auth.signUp -> verifyOtp）
  async registerWithEmail(email, password) {
    if (!this.cloudSyncEnabled || !this.cloudApp) return false;
    try {
      this.cloudSyncing = true;
      this.cloudLastSyncError = null;
      this._emitSyncStatus();
      const auth = this._getAuth();
      if (!auth) throw new Error('Auth 模块不可用');

      if (typeof auth.signUp === 'function') {
        // v2: signUp 发送验证码并返回 { data: { verifyOtp }, error }
        const username = this._generateUsername(email);
        const { data, error } = await auth.signUp({
          email: email,
          password: password,
          username: username
        });
        if (error) throw error;
        if (data && typeof data.verifyOtp === 'function') {
          this._pendingVerifyOtp = data.verifyOtp;
          this._pendingEmail = email;
          this._pendingPassword = password;
          return { needsVerification: true, message: '验证码已发送至邮箱，请查收并输入' };
        }
        this.cloudUser = (data && data.user) ? data.user : data;
      } else if (typeof auth.signUpWithEmailAndPassword === 'function') {
        // v1 兜底
        const state = await auth.signUpWithEmailAndPassword(email, password);
        this.cloudUser = (state && state.user) ? state.user : state;
      } else {
        throw new Error('未找到可用的注册方法');
      }

      const uid = (this.cloudUser.uid || this.cloudUser.id || this.cloudUser.userId || this.cloudUser.email) || 'email';
      console.log('[CloudBase] 邮箱注册成功:', uid);
      this._setLoginMode('email');
      const syncResult = await this.syncWithCloud();
      if (!syncResult.success) {
        throw new Error(syncResult.error || '同步失败');
      }
      return true;
    } catch (e) {
      console.error('[CloudBase] 邮箱注册失败:', e);
      this.cloudLastSyncError = '邮箱注册失败: ' + (e.message || String(e));
      this._emitSyncStatus();
      throw e;
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  // 验证邮箱注册验证码（继续完成 signUp）
  async verifyEmailCode(code) {
    if (!this.cloudSyncEnabled || !this.cloudApp) return false;
    if (!this._pendingVerifyOtp) throw new Error('请先点击"注册"获取验证码');
    try {
      this.cloudSyncing = true;
      this.cloudLastSyncError = null;
      this._emitSyncStatus();
      const { data, error } = await this._pendingVerifyOtp({ token: code });
      if (error) throw error;

      // 验证通过后用邮箱+密码真正登录，确保 cloudUser 有 uid
      const auth = this._getAuth();
      let user = null;
      if (auth && typeof auth.signInWithPassword === 'function' && this._pendingPassword) {
        try {
          const signInRes = await auth.signInWithPassword({
            email: this._pendingEmail,
            password: this._pendingPassword
          });
          if (!signInRes.error) {
            user = (signInRes.data && signInRes.data.user) ? signInRes.data.user : signInRes.data;
          }
        } catch (signInErr) {
          console.warn('[CloudBase] 验证后自动登录失败:', signInErr);
        }
      }

      // 兜底：如果登录没拿到 user，尝试从 verifyOtp 的 data 取
      if (!user) {
        user = (data && data.user) ? data.user : { email: this._pendingEmail };
      }

      this.cloudUser = user || { email: this._pendingEmail };
      this._pendingVerifyOtp = null;
      this._pendingEmail = null;
      this._pendingPassword = null;
      this._setLoginMode('email');
      const uid = this._getUserId();
      console.log('[CloudBase] 邮箱验证成功:', uid || this.cloudUser.email);

      // 释放同步锁，避免 syncWithCloud 因自己持有锁而返回 syncing
      this.cloudSyncing = false;
      this._emitSyncStatus();
      const syncResult = await this.syncWithCloud();
      if (!syncResult.success) {
        throw new Error(syncResult.error || syncResult.reason || '同步失败');
      }
      return true;
    } catch (e) {
      console.error('[CloudBase] 邮箱验证失败:', e);
      this.cloudLastSyncError = '邮箱验证失败: ' + (e.message || String(e));
      this._emitSyncStatus();
      throw e;
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  // 生成符合 CloudBase 规则的用户名（用于邮箱注册）
  _generateUsername(email) {
    const base = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
    const tail = Math.random().toString(36).substr(2, 4);
    let username = (base + '_' + tail).toLowerCase();
    if (username.length > 32) username = username.substr(0, 32);
    if (/^[0-9_-]/.test(username)) username = 'u' + username;
    if (/[-_]$/.test(username)) username = username + '0';
    if (!/[a-zA-Z]/.test(username)) username = 'u' + username;
    return username;
  },

  // 登出
  async logout() {
    if (!this.cloudApp) return;
    try {
      const auth = this._getAuth();
      if (auth && typeof auth.signOut === 'function') {
        await auth.signOut();
      } else if (auth && typeof auth.signOut === 'function') {
        await auth.signOut();
      }
      this.cloudUser = null;
      this.cloudDocId = null;
      this.cloudLastSync = null;
      this._pendingVerifyOtp = null;
      this._pendingEmail = null;
      this._pendingPassword = null;
      this._setLoginMode(null);
      this._emitSyncStatus();
    } catch (e) {
      console.error('[CloudBase] 登出失败:', e);
    }
  },

  // 从本地组装完整数据包（同步用，包含已删除记录）
  _getLocalDataPackage() {
    const data = {};
    Object.keys(this.keys).forEach(k => {
      data[k] = this.get(this.keys[k], true); // true = 包含已删除
    });
    return {
      data: data,
      updatedAt: new Date().toISOString(),
      clientVersion: 'v97'
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

  // 统一时间戳读取：updatedAt > updated > createdAt > 1970-01-01
  _itemTimestamp(item) {
    if (!item) return 0;
    const raw = item.updatedAt || item.updated || item.createdAt || 0;
    const t = new Date(raw).getTime();
    return isNaN(t) ? 0 : t;
  },

  // 业务稳定键：用于跨设备去重（同一业务记录在不同设备可能生成不同随机 ID）
  _getStableBusinessKey(item, key) {
    if (!item) return null;
    if (key === 'insurance') return item.contractNo || null;
    if (key === 'stocks' || key === 'funds' || key === 'rsu' || key === 'annuities') return item.code || null;
    if (key === 'loans') return item.contractNo || item.accountNo || null;
    return null;
  },

  // 合并两个数据包（按 id 去重，LWW：updatedAt/updated/createdAt 较新的优先；支持软删除）
  _mergeDataPackages(localPkg, cloudPkg) {
    const merged = { data: {}, updatedAt: new Date().toISOString(), clientVersion: 'v84' };
    Object.keys(this.keys).forEach(k => {
      const localArr = (localPkg && localPkg.data && Array.isArray(localPkg.data[k])) ? localPkg.data[k] : [];
      const cloudArr = (cloudPkg && cloudPkg.data && Array.isArray(cloudPkg.data[k])) ? cloudPkg.data[k] : [];
      const map = {};
      let addedFromCloud = 0, conflictWinCloud = 0, conflictWinLocal = 0;

      // 先添加本地记录
      localArr.forEach(item => {
        if (!item || !item.id) return;
        map[item.id] = item;
      });

      // 再用云端记录合并（LWW）
      cloudArr.forEach(item => {
        if (!item || !item.id) return;
        if (!map[item.id]) {
          map[item.id] = item;
          addedFromCloud++;
        } else {
          const oldTime = this._itemTimestamp(map[item.id]);
          const newTime = this._itemTimestamp(item);
          if (newTime > oldTime) {
            map[item.id] = item;
            conflictWinCloud++;
          } else if (newTime < oldTime) {
            conflictWinLocal++;
          }
        }
      });

      let list = Object.values(map);

      // 二次去重：按业务稳定键（合同号/股票代码/基金代码等）合并跨设备重复记录
      // 场景：不同设备导入同一默认数据时生成不同随机 ID，导致同步后出现双份
      const groups = {};
      const toRemove = new Set();
      list.forEach(item => {
        const bk = this._getStableBusinessKey(item, k);
        if (!bk) return;
        if (!groups[bk]) {
          groups[bk] = item;
        } else {
          const a = groups[bk];
          const b = item;
          const aTime = this._itemTimestamp(a);
          const bTime = this._itemTimestamp(b);
          let winner = a;
          let loser = b;
          if (bTime > aTime) {
            winner = b; loser = a;
          } else if (bTime === aTime) {
            // 时间相同：优先保留 ID 等于业务键的记录（更稳定）
            if (b.id === bk) { winner = b; loser = a; }
          }
          // 统一使用业务稳定键作为 ID，确保后续同步一致
          if (winner.id !== bk) {
            winner.id = bk;
            winner.updatedAt = new Date().toISOString();
          }
          groups[bk] = winner;
          toRemove.add(loser.id);
        }
      });
      if (toRemove.size > 0) {
        list = list.filter(item => !toRemove.has(item.id));
        console.log(`[CloudBase] 按业务键去重 ${k}: 合并 ${toRemove.size} 条重复记录`);
      }

      merged.data[k] = list;
      if (addedFromCloud > 0 || conflictWinCloud > 0 || conflictWinLocal > 0) {
        console.log(`[CloudBase] 合并 ${k}: 云端新增 ${addedFromCloud}, 云端覆盖 ${conflictWinCloud}, 本地保留 ${conflictWinLocal}`);
      }
    });
    return merged;
  },

  // 从云端拉取数据
  async pullFromCloud() {
    if (!this.cloudSyncEnabled || !this.cloudDb) return { doc: null, count: 0, error: 'CloudBase 未初始化' };
    const collection = this.cloudDb.collection(this.cloudConfig.collection);
    try {
      const res = await collection.limit(1).get();
      if (res.data && res.data.length > 0) {
        const doc = res.data[0];
        this.cloudDocId = doc._id;
        let count = 0;
        if (doc.data) {
          Object.keys(doc.data).forEach(k => {
            if (Array.isArray(doc.data[k])) count += doc.data[k].length;
          });
        }
        console.log('[CloudBase] 拉取到云端数据，docId:', doc._id, '总记录数:', count);
        return { doc: doc, count: count, error: null };
      }
      console.log('[CloudBase] 云端无数据');
      return { doc: null, count: 0, error: null };
    } catch (e) {
      console.error('[CloudBase] 拉取失败:', e);
      this.cloudLastSyncError = '拉取失败: ' + (e.message || String(e));
      this._emitSyncStatus();
      return { doc: null, count: 0, error: e.message || String(e) };
    }
  },

  // 推送数据到云端
  async pushToCloud(pkg) {
    if (!this.cloudSyncEnabled || !this.cloudDb) return false;
    if (!pkg) pkg = this._getLocalDataPackage();
    const collection = this.cloudDb.collection(this.cloudConfig.collection);
    try {
      const docData = {
        data: pkg.data,
        updatedAt: pkg.updatedAt,
        clientVersion: pkg.clientVersion
      };
      if (this.cloudDocId) {
        // v2: update 直接传入字段
        const res = await collection.doc(this.cloudDocId).update(docData);
        console.log('[CloudBase] 更新云端数据成功, res:', res);
      } else {
        // v2: add 直接传入字段
        const res = await collection.add(docData);
        console.log('[CloudBase] 新增云端数据, res:', res);
        // v2 返回格式: { data: { _id: '...' }, error: null }
        if (res && res.data && res.data._id) {
          this.cloudDocId = res.data._id;
        } else if (res && res._id) {
          this.cloudDocId = res._id;
        }
        console.log('[CloudBase] docId:', this.cloudDocId);
      }
      this.cloudLastSync = new Date().toISOString();
      return true;
    } catch (e) {
      console.error('[CloudBase] 推送失败:', e);
      this.cloudLastSyncError = '推送失败: ' + (e.message || String(e));
      this._emitSyncStatus();
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
    const diag = {
      userId: this._getUserId(),
      docId: this.cloudDocId || null,
      startedAt: new Date().toISOString()
    };
    try {
      const localPkg = this._getLocalDataPackage();
      console.log('[CloudBase] 本地数据包:', JSON.stringify(localPkg).substring(0, 300) + '...');

      const { doc: cloudDoc, count: cloudCount, error: pullError } = await this.pullFromCloud();
      diag.cloudDocId = (cloudDoc && cloudDoc._id) || this.cloudDocId || null;
      diag.cloudCount = cloudCount || 0;
      if (pullError) {
        return { success: false, error: '拉取云端数据失败: ' + pullError, diag: diag };
      }

      const cloudPkg = cloudDoc ? {
        data: cloudDoc.data,
        updatedAt: cloudDoc.updatedAt,
        clientVersion: cloudDoc.clientVersion
      } : null;

      console.log('[CloudBase] 云端数据包:', cloudPkg ? JSON.stringify(cloudPkg).substring(0, 300) + '...' : 'null');

      let mergedPkg;
      let source;
      if (!cloudPkg) {
        // 云端无数据，直接推送本地
        mergedPkg = localPkg;
        source = 'local';
        console.log('[CloudBase] 云端无数据，使用本地数据');
      } else if (!localPkg.data || this._isEmptyData(localPkg.data)) {
        // 本地无数据，使用云端
        mergedPkg = cloudPkg;
        source = 'cloud';
        console.log('[CloudBase] 本地无数据，使用云端数据');
      } else {
        // 合并，以 updatedAt 判断是否需要覆盖
        const localTime = new Date(localPkg.updatedAt || 0).getTime();
        const cloudTime = new Date(cloudPkg.updatedAt || 0).getTime();
        mergedPkg = this._mergeDataPackages(localPkg, cloudPkg);
        source = localTime >= cloudTime ? 'merge-local-newer' : 'merge-cloud-newer';
        console.log('[CloudBase] 合并数据，来源:', source, 'localTime:', localPkg.updatedAt, 'cloudTime:', cloudPkg.updatedAt);
      }

      // 写回本地
      this._applyDataPackage(mergedPkg);
      console.log('[CloudBase] 已应用合并数据到本地');

      // 统计合并后现金账户数量，用于诊断
      const mergedCashCount = Array.isArray(mergedPkg.data && mergedPkg.data.cashAccounts) ? mergedPkg.data.cashAccounts.length : 0;
      const localCashCount = Array.isArray(localPkg.data && localPkg.data.cashAccounts) ? localPkg.data.cashAccounts.length : 0;
      diag.mergedCashCount = mergedCashCount;
      diag.localCashCount = localCashCount;
      diag.addedCashCount = Math.max(0, mergedCashCount - localCashCount);

      // 推回云端（确保云端也是最新合并结果）
      const pushSuccess = await this.pushToCloud(mergedPkg);
      if (!pushSuccess) {
        console.error('[CloudBase] 同步失败：推送云端数据失败');
        return { success: false, error: '推送云端数据失败，请检查网络或 CloudBase 安全域名配置', diag: diag };
      }
      console.log('[CloudBase] 已推送合并数据到云端');

      this.cloudLastSync = new Date().toISOString();
      this.cloudLastSyncError = null;
      this._emitSyncStatus();
      console.log('[CloudBase] 同步完成，来源:', source, 'diag:', diag);
      return { success: true, source: source, diag: diag };
    } catch (e) {
      console.error('[CloudBase] 同步失败:', e);
      this.cloudLastSyncError = e.message || String(e);
      this._emitSyncStatus();
      return { success: false, error: e.message || String(e), diag: diag };
    } finally {
      this.cloudSyncing = false;
      this._emitSyncStatus();
    }
  },

  _getUserId() {
    if (!this.cloudUser) return null;
    return this.cloudUser.uid || this.cloudUser.id || this.cloudUser.openid || this.cloudUser.userId || this.cloudUser.email || null;
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

  get(key, includeDeleted) {
    try {
      const data = localStorage.getItem(key);
      let arr = data ? JSON.parse(data) : [];
      if (!includeDeleted) {
        arr = arr.filter(item => !(item && item.deleted));
      }
      return arr;
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
    const data = this.get(key, true); // 包含已删除，避免 ID 冲突
    item.id = item.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const now = new Date().toISOString();
    item.createdAt = item.createdAt || now;
    item.updatedAt = item.updatedAt || now;
    item.deleted = false;
    delete item.deletedAt;
    data.push(item);
    this.set(key, data);
    return item;
  },

  update(key, id, updates) {
    const data = this.get(key, true); // 包含已删除，支持取消删除
    const index = data.findIndex(item => item && item.id === id);
    if (index !== -1) {
      const now = new Date().toISOString();
      updates.updatedAt = now;
      // 取消软删除（更新视为复活）
      if (data[index].deleted) {
        updates.deleted = false;
        updates.deletedAt = null;
        delete updates.deletedAt;
      }
      // 补齐 createdAt，确保 LWW 时间戳可用
      if (!data[index].createdAt) {
        data[index].createdAt = now;
      }
      data[index] = { ...data[index], ...updates };
      this.set(key, data);
      return data[index];
    }
    return null;
  },

  delete(key, id) {
    const data = this.get(key, true); // 包含已删除，找到目标记录
    const index = data.findIndex(item => item && item.id === id);
    if (index !== -1) {
      const now = new Date().toISOString();
      data[index].deleted = true;
      data[index].deletedAt = now;
      data[index].updatedAt = now;
      this.set(key, data);
    }
    return true;
  },

  // 快捷读取（默认过滤已删除记录）
  getCashAccounts(includeDeleted) { return this.get(this.keys.cashAccounts, includeDeleted); },
  getIncome(includeDeleted)      { return this.get(this.keys.income, includeDeleted); },
  getExpense(includeDeleted)     { return this.get(this.keys.expense, includeDeleted); },
  getAssets(includeDeleted)      { return this.get(this.keys.assets, includeDeleted); },
  getInsurance(includeDeleted)   { return this.get(this.keys.insurance, includeDeleted); },
  getStocks(includeDeleted)      { return this.get(this.keys.stocks, includeDeleted); },
  getRsu(includeDeleted)         { return this.get(this.keys.rsu, includeDeleted); },
  getFunds(includeDeleted)       { return this.get(this.keys.funds, includeDeleted); },
  getLoans(includeDeleted)       { return this.get(this.keys.loans, includeDeleted); },
  getAnnuities(includeDeleted)   { return this.get(this.keys.annuities, includeDeleted); },

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
