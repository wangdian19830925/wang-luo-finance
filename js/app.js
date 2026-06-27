// 主应用逻辑
const App = {
  currentPage: "dashboard",

  // 图标辅助函数 — 返回 SVG use 引用（扁平抽象风格）
  icon(name, cls) {
    cls = cls || '';
    return '<svg class="icon ' + cls + '"><use href="#icon-' + name + '"/></svg>';
  },

  // 公司Logo映射（已停用，返回空字符串）
  getStockLogo(code) {
    return '';
  },

  // 根据缴费频率，将已过期的下次缴费日期自动推进到未来
  adjustNextPayDate(policy) {
    if (!policy.nextPayDate || !policy.freq) return policy.nextPayDate;
    var today = new Date(); today.setHours(0,0,0,0);
    // 用本地时间解析日期，避免 UTC 偏移问题
    var parts = policy.nextPayDate.split('-');
    var date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    if (isNaN(date.getTime())) return policy.nextPayDate;
    if (date >= today) return policy.nextPayDate; // 已为未来日期，无需调整

    var original = policy.nextPayDate;
    var maxIter = 50; // 防止死循环
    while (date < today && maxIter-- > 0) {
      if (policy.freq === 'yearly') date.setFullYear(date.getFullYear() + 1);
      else if (policy.freq === 'monthly') date.setMonth(date.getMonth() + 1);
      else if (policy.freq === 'quarterly') date.setMonth(date.getMonth() + 3);
      else date.setFullYear(date.getFullYear() + 1); // 默认每年
    }
    // 用本地时间格式化，避免 UTC 偏移
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    var adjusted = y + '-' + m + '-' + d;
    if (adjusted !== original) {
      console.log('[日期调整] ' + policy.product.substring(0,20) + ': ' + original + ' → ' + adjusted);
    }
    return adjusted;
  },

  init() {
    console.log('[App] === init 开始 ===');
    console.log('[App] Storage 是否存在:', typeof Storage !== 'undefined');
    console.log('[App] INSURANCE_POLICIES 是否存在:', typeof INSURANCE_POLICIES !== 'undefined');
    this.initVersionBadge();
    this.registerSW();
    this.requestNotificationPermission();
    this.setupNavigation();
    this.setupForms();
    this.loadExchangeRates();       // 先加载汇率（同步），确保 dashboard 使用正确汇率
    this.loadTransactions();        // 先初始化现金账户默认值，确保 dashboard 计算总资产时包含现金
    this.loadDashboard();
    this.setTodayDates();
    this.checkImportStatus();
    this.checkStockImportStatus();
    this.checkRsuImportStatus();
    this.checkFundImportStatus();
    this.checkLoanImportStatus();
    this.checkAnnuityImportStatus();
    this.autoRefreshStockPrices();   // 异步更新股价+汇率

    // 一次性事件委托：就地编辑触发器
    this.setupInlineEditDelegation();

    // 顶部"刷新"按钮：拉取最新股票 / 汇率 / 基金 / 房贷进度
    this.setupRefreshAllButton();

    // 设置与数据同步
    this.setupSettings();

    // CloudBase 云端同步
    this.setupCloudSync();
    this.initCloudBase();

    console.log('[App] === init 完成 ===');
  },

  // 根据当前引用的 app.js?v=X 自动设置右上角版本号
  initVersionBadge() {
    try {
      var script = document.querySelector('script[src*="app.js"]');
      var match = script && script.src.match(/[?&]v=(\d+)/);
      var version = match ? match[1] : '??';
      var badge = document.getElementById('versionBadge');
      if (badge) badge.innerText = 'v: ' + version;
      console.log('[App] 版本号:', version);
    } catch (e) {
      console.warn('[App] 版本号初始化失败:', e);
    }
  },

  // 初始化 CloudBase 云端同步
  async initCloudBase() {
    try {
      // CloudBase 环境配置
      const config = {
        env: 'wang-luo-finance-d6enmg07a198e20'
      };
      const initialized = await Storage.initCloudbase(config);
      if (!initialized) {
        console.warn('[App] CloudBase 未初始化:', Storage.cloudInitError || '未知原因');
        return;
      }
      console.log('[App] CloudBase 初始化完成，尝试恢复会话');
      const restoreResult = await Storage.restoreSession();
      console.log('[App] 会话恢复结果:', restoreResult);
      if (!restoreResult.success && restoreResult.reason === 'needs-login') {
        console.warn('[App] 上次为邮箱登录，请手动登录以启用同步');
      } else if (!restoreResult.success) {
        console.warn('[App] 会话未恢复:', restoreResult.reason);
      }
    } catch (e) {
      console.error('[App] CloudBase 初始化异常:', e);
    }
  },

  // 监听页面可见性变化，切回前台时同步
  setupVisibilitySync() {
    var self = this;
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden && Storage.cloudSyncEnabled && Storage.cloudUser) {
        console.log('[App] 页面回到前台，触发云端同步');
        Storage.syncWithCloud().then(function(result) {
          if (result && result.success) {
            self.refreshAllPages();
          }
        }).catch(function(e) {
          console.error('[App] 切回前台同步失败:', e);
        });
      }
    });
  },

  // CloudBase 同步相关 UI 与事件
  setupCloudSync() {
    var self = this;

    // 同步按钮点击手动同步
    var syncBtn = document.getElementById('syncBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', function() {
        if (Storage.cloudSyncing) return;
        Storage.syncWithCloud().then(function(result) {
          self._handleSyncResult(result);
        }).catch(function(e) {
          self.showToast('同步失败: ' + e.message, 'error');
        });
      });
    }

    // 监听同步状态变化，更新 UI
    Storage.onSyncStatusChange(function(status) {
      self.updateSyncUI(status);
    });

    // 设置面板中的 CloudBase 事件
    var loginBtn = document.getElementById('cloudLoginBtn');
    var registerBtn = document.getElementById('cloudRegisterBtn');
    var verifyBtn = document.getElementById('cloudVerifyBtn');
    var sendCodeBtn = document.getElementById('cloudSendCodeBtn');
    var anonymousBtn = document.getElementById('cloudAnonymousBtn');
    var syncNowBtn = document.getElementById('cloudSyncNowBtn');
    var logoutBtn = document.getElementById('cloudLogoutBtn');
    var verifyCodeGroup = document.getElementById('cloudVerifyCodeGroup');
    var verificationCodeInput = document.getElementById('cloudVerificationCode');

    function showVerificationUI(show) {
      if (verifyCodeGroup) verifyCodeGroup.style.display = show ? 'block' : 'none';
      if (verifyBtn) verifyBtn.style.display = show ? 'inline-flex' : 'none';
      if (registerBtn) registerBtn.style.display = show ? 'none' : 'inline-flex';
      if (loginBtn) loginBtn.style.display = show ? 'none' : 'inline-flex';
    }

    function getEmailPassword() {
      var email = document.getElementById('cloudEmail').value.trim();
      var password = document.getElementById('cloudPassword').value;
      return { email: email, password: password };
    }

    function validatePassword(password) {
      if (password.length < 8 || password.length > 32) {
        self.showToast('密码长度需为 8-32 位', 'error');
        return false;
      }
      if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        self.showToast('密码需同时包含字母和数字', 'error');
        return false;
      }
      return true;
    }

    if (loginBtn) {
      loginBtn.addEventListener('click', function() {
        var creds = getEmailPassword();
        if (!creds.email || !creds.password) {
          self.showToast('请输入邮箱和密码', 'error');
          return;
        }
        Storage.loginWithEmail(creds.email, creds.password).then(function() {
          self.refreshAllPages();
          self.showToast('登录成功，数据已同步');
        }).catch(function(e) {
          self.showToast('登录失败: ' + (e.message || ''), 'error');
        });
      });
    }

    if (registerBtn) {
      registerBtn.addEventListener('click', function() {
        var creds = getEmailPassword();
        if (!creds.email || !creds.password) {
          self.showToast('请输入邮箱和密码', 'error');
          return;
        }
        if (!validatePassword(creds.password)) return;
        self.showToast('正在发送验证码...');
        Storage.registerWithEmail(creds.email, creds.password).then(function(result) {
          if (result && result.needsVerification) {
            showVerificationUI(true);
            if (verificationCodeInput) verificationCodeInput.focus();
            self.showToast(result.message || '验证码已发送，请查收邮箱');
          } else {
            self.refreshAllPages();
            self.showToast('注册并登录成功，数据已同步');
          }
        }).catch(function(e) {
          self.showToast('注册失败: ' + (e.message || ''), 'error');
        });
      });
    }

    if (sendCodeBtn) {
      sendCodeBtn.addEventListener('click', function() {
        var creds = getEmailPassword();
        if (!creds.email || !creds.password) {
          self.showToast('请输入邮箱和密码', 'error');
          return;
        }
        if (!validatePassword(creds.password)) return;
        self.showToast('正在重新发送验证码...');
        Storage.registerWithEmail(creds.email, creds.password).then(function(result) {
          if (result && result.needsVerification) {
            self.showToast(result.message || '验证码已重新发送');
          }
        }).catch(function(e) {
          self.showToast('发送验证码失败: ' + (e.message || ''), 'error');
        });
      });
    }

    if (verifyBtn) {
      verifyBtn.addEventListener('click', function() {
        var code = verificationCodeInput ? verificationCodeInput.value.trim() : '';
        if (!code) {
          self.showToast('请输入验证码', 'error');
          return;
        }
        Storage.verifyEmailCode(code).then(function() {
          showVerificationUI(false);
          if (verificationCodeInput) verificationCodeInput.value = '';
          self.refreshAllPages();
          self.showToast('验证成功，数据已同步');
        }).catch(function(e) {
          self.showToast('验证失败: ' + (e.message || ''), 'error');
        });
      });
    }

    if (anonymousBtn) {
      anonymousBtn.addEventListener('click', function() {
        Storage.loginAnonymously().then(function() {
          self.refreshAllPages();
          self.showToast('匿名登录成功（仅限本设备）');
        }).catch(function(e) {
          self.showToast('登录失败: ' + (e.message || ''), 'error');
        });
      });
    }

    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', function() {
        if (Storage.cloudSyncing) return;
        Storage.syncWithCloud().then(function(result) {
          self._handleSyncResult(result);
        }).catch(function(e) {
          self.showToast('同步失败: ' + e.message, 'error');
        });
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        Storage.logout();
        self.showToast('已退出登录');
      });
    }

    // 页面可见性变化时同步
    this.setupVisibilitySync();
  },

  // 更新同步状态 UI
  updateSyncUI(status) {
    var syncBtn = document.getElementById('syncBtn');
    var syncIcon = document.getElementById('syncIcon');
    var syncDot = document.getElementById('syncDot');
    var statusBox = document.getElementById('cloudSyncStatus');
    var authSection = document.getElementById('cloudAuthSection');
    var diagBox = document.getElementById('cloudSyncDiag');
    var anonymousTip = document.getElementById('anonymousSyncTip');

    if (syncBtn) {
      syncBtn.classList.toggle('syncing', !!status.syncing);
    }
    if (syncIcon) {
      syncIcon.style.animation = status.syncing ? 'spin 1s linear infinite' : 'none';
    }
    if (syncDot) {
      syncDot.className = 'sync-dot';
      if (!status.enabled) syncDot.classList.add('sync-dot-offline');
      else if (status.syncing) syncDot.classList.add('sync-dot-syncing');
      else if (status.user) syncDot.classList.add('sync-dot-online');
      else syncDot.classList.add('sync-dot-offline');
    }

    var isAnonymous = !!(status.user && (status.user.is_anonymous || !status.user.email));
    if (anonymousTip) {
      anonymousTip.style.display = (status.user && isAnonymous) ? 'block' : 'none';
    }

    if (statusBox) {
      var text = '未初始化';
      if (!status.enabled) text = '云端同步未启用（SDK 未加载）';
      else if (status.syncing) text = '正在同步...';
      else if (status.user) {
        var uid = status.user.uid || status.user.openid || status.user.userId || '已登录';
        var time = status.lastSync ? new Date(status.lastSync).toLocaleString() : '尚未同步';
        text = '已登录: ' + uid + '<br>最后同步: ' + time;
      } else {
        text = '未登录，请在下方登录以启用同步';
      }
      if (status.lastError) {
        text += '<br><span class="sync-error-text">错误: ' + status.lastError + '</span>';
      }
      statusBox.innerHTML = '<span class="sync-status-text">' + text + '</span>';
    }

    if (diagBox && status.user) {
      var uid = status.user.uid || status.user.openid || status.user.userId || '-';
      var docId = status.docId || '-';
      var diagHtml = '用户 ID: ' + uid + '<br>云端文档 ID: ' + docId;
      if (status.lastSync) {
        diagHtml += '<br>最后同步: ' + new Date(status.lastSync).toLocaleString();
      }
      diagBox.innerHTML = diagHtml;
      diagBox.style.display = 'block';
    } else if (diagBox) {
      diagBox.style.display = 'none';
    }

    if (authSection) {
      authSection.style.display = (status.user) ? 'none' : 'block';
    }
  },

  // 统一处理同步结果并给出带诊断信息的提示
  _handleSyncResult(result) {
    if (result && result.success) {
      this.refreshAllPages();
      var diag = result.diag || {};
      var msg = '同步成功';
      if (diag.cloudCount !== undefined) {
        msg += '（云端 ' + diag.cloudCount + ' 条';
        if (diag.addedCashCount > 0) msg += '，新增 ' + diag.addedCashCount + ' 个现金账户';
        msg += '）';
      }
      this.showToast(msg);
    } else {
      var reason = (result && (result.reason || result.error)) || '未知原因';
      this.showToast('同步未成功: ' + reason, 'error');
    }
  },

  // 刷新所有页面数据（同步后调用）
  refreshAllPages() {
    try {
      this.loadDashboard();
      this.loadTransactions();
      this.loadInsuranceList();
      this.loadStockList();
      this.loadRsuList();
      this.loadFundList();
      this.loadLoanList();
      this.loadAnnuityList();
      this.loadAlertsPage();
    } catch (e) {
      console.error('[App] refreshAllPages 异常:', e);
    }
  },

  // 顶部刷新按钮：依次拉取最新数据
  setupRefreshAllButton() {
    var self = this;
    var btn = document.getElementById("refreshAllBtn");
    if (!btn) return;
    btn.addEventListener("click", function() {
      if (btn.disabled) return;
      self.refreshAllData(btn);
    });
  },

  // 设置与数据同步：导出/导入/清空
  setupSettings() {
    var self = this;
    var exportBtn = document.getElementById("exportDataBtn");
    var importFile = document.getElementById("importDataFile");
    var clearBtn = document.getElementById("clearLocalDataBtn");

    if (exportBtn) exportBtn.addEventListener("click", function() { self.exportDataToFile(); });

    if (importFile) importFile.addEventListener("change", function(e) {
      var file = e.target.files && e.target.files[0];
      if (file) self.importDataFromFile(file);
      importFile.value = "";
    });

    if (clearBtn) clearBtn.addEventListener("click", function() { self.clearAllLocalData(); });
  },

  openSettings() {
    this.navigateTo('settings');
  },

  closeSettings() {
    this.navigateTo('dashboard');
  },

  exportDataToFile() {
    try {
      var pkg = Storage.exportAllData();
      var blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      var dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = "家庭资产数据_" + dateStr + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function() {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      this.showToast("数据已导出");
    } catch (e) {
      console.error('[导出数据] 失败:', e);
      this.showToast("导出失败: " + e.message, "error");
    }
  },

  importDataFromFile(file) {
    var self = this;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var text = e.target.result;
        var pkg = JSON.parse(text);
        var mode = document.getElementById("importModeSelect");
        var modeValue = mode ? mode.value : "merge";

        if (!confirm(modeValue === "replace"
          ? "覆盖模式将清空当前设备所有数据，并用导入文件替换。是否继续？"
          : "合并模式将保留本地数据，并导入新条目/更新已有条目。是否继续？")) {
          return;
        }

        var summary = Storage.importAllData(pkg, modeValue);
        console.log('[导入数据] 结果:', summary);

        // 刷新所有页面
        self.loadDashboard();
        self.loadTransactions();
        self.loadStockList();
        self.renderStockCharts();
        self.loadFundList();
        self.loadInsuranceList();
        self.loadLoanList();
        self.loadAnnuityList();
        self.checkNotifications();

        self.closeSettings();
        self.showToast("导入成功 ✓");
      } catch (err) {
        console.error('[导入数据] 失败:', err);
        self.showToast("导入失败: " + err.message, "error");
      }
    };
    reader.onerror = function() {
      self.showToast("读取文件失败", "error");
    };
    reader.readAsText(file);
  },

  clearAllLocalData() {
    if (!confirm("确定清空所有本地数据？\n此操作不可恢复，建议先导出备份。")) return;
    Storage.clearAllData();
    this.loadDashboard();
    this.loadTransactions();
    this.loadStockList();
    this.renderStockCharts();
    this.loadFundList();
    this.loadInsuranceList();
    this.loadLoanList();
    this.loadAnnuityList();
    this.checkNotifications();
    this.closeSettings();
    this.showToast("本地数据已清空");
  },

  // 刷新全部数据：股票 / 汇率 / 基金 / 房贷还款进度
  refreshAllData(btn) {
    var self = this;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-loading");
    }
    self.showToast("正在刷新全部数据…");

    // 房贷是按 today 实时算的（calcLoanProgress 内部每次用 new Date()），
    // 唯一需要"刷新"的是把"今天是否已过 17 号"对齐——无需网络请求。
    // 所以这里只需：1) 本地 JSON 股价 2) 在线股价补充 3) 在线汇率 4) 基金净值
    var steps = [
      function(next) {
        console.log('[刷新全部] 1/4 拉取本地股价 JSON');
        self._loadPricesFromJson(function(ok) {
          console.log('[刷新全部] 本地股价 JSON ' + (ok ? 'OK' : '失败/跳过'));
          next();
        });
      },
      function(next) {
        console.log('[刷新全部] 2/4 在线股价补充');
        self._tryFetchLivePrices();
        // _tryFetchLivePrices 内部是异步 <script> 注入，3 秒后视为完成
        setTimeout(next, 3000);
      },
      function(next) {
        console.log('[刷新全部] 3/4 在线汇率');
        self._fetchLiveFxRates();
        setTimeout(next, 2000);
      },
      function(next) {
        console.log('[刷新全部] 4/4 房贷还款进度（实时按 today 算）');
        // 房贷进度是 calcLoanProgress 实时算的，触发 loadDashboard 即重算
        next();
      }
    ];

    function run(i) {
      if (i >= steps.length) {
        // 全部完成后：重算 dashboard + 资产曲线
        self.loadDashboard();
        // 强制重算资产曲线（重新走历史数据 + 补点）
        self.renderAssetTrend();
        if (btn) {
          btn.disabled = false;
          btn.classList.remove("is-loading");
        }
        self.showToast("刷新完成 ✓");
        return;
      }
      steps[i](function() { run(i + 1); });
    }
    run(0);
  },

  // 就地编辑事件委托（document 级别）
  setupInlineEditDelegation() {
    document.addEventListener('click', function(e) {
      var target = e.target.closest('.inline-editable');
      if (!target) return;
      // 防止与外层 outside-click 冲突
      e.stopPropagation();
      var type = target.getAttribute('data-type');
      var id = target.getAttribute('data-id');
      if (type && id) {
        App.startInlineEdit(type, id);
      }
    });
  },

  // 从 localStorage 加载汇率（同步，确保 dashboard 立即可用）
  loadExchangeRates() {
    var rates = this._getFxRates();
    if (!rates.USDCNY && !rates.HKDCNY) {
      // 无缓存则设置默认值
      this._saveFxRates({ USDCNY: 7.2, HKDCNY: 0.92 });
      console.log('[汇率] 使用默认汇率: USDCNY=7.2, HKDCNY=0.92');
    } else {
      console.log('[汇率] 已加载缓存: USDCNY=' + (rates.USDCNY||'?') + ', HKDCNY=' + (rates.HKDCNY||'?'));
    }
  },

  registerSW() {
    // file:// 协议下, Service Worker 不能工作
    if (location.protocol === "file:") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  },

  requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      setTimeout(() => Notification.requestPermission(), 3000);
    }
  },

  sendBrowserNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body: body, icon: "./assets/icons/icon-192.png" });
    }
  },

  checkImportStatus() {
    console.log('[App] checkImportStatus 开始...');
    try {
      const existing = Storage.get(Storage.keys.insurance);
      console.log('[App] 当前保单数量:', existing.length);
      if (existing.length === 0) {
        console.log('[App] 保单为空，触发自动导入');
        this.importInsuranceData(true);
      } else {
        // 检查是否有记录与数据源不一致
        var policies = (typeof INSURANCE_POLICIES !== 'undefined') ? INSURANCE_POLICIES : [];
        var needSync = existing.some(function(ex) {
          if (!ex.payPeriod) return true;
          var src = null;
          for (var i = 0; i < policies.length; i++) {
            if (policies[i].contractNo === ex.contractNo) { src = policies[i]; break; }
          }
          if (!src) return false;
          // 逐字段比对：payPeriod, expireDate, collectNote, nextPayDate
          if (ex.payPeriod !== src.payPeriod) return true;
          if (ex.expireDate !== src.expireDate) return true;
          if (ex.collectNote !== src.collectNote) return true;
          if (src.nextPayDate === null && ex.nextPayDate) return true;
          if (src.baseNextPayDate === null && ex.baseNextPayDate) return true;
          return false;
        });
        if (needSync) {
          console.log('[App] 检测到保单数据需要同步，触发合并更新');
          this.importInsuranceData(true);
        } else if (existing.length < 16) {
          console.log('[App] 保单不完整 (' + existing.length + ' < 16)，触发自动导入');
          this.importInsuranceData(true);
        } else {
          console.log('[App] 保单数据完整，跳过导入');
        }
      }
    } catch(e) {
      console.error('[App] checkImportStatus 异常:', e);
    }
    this.checkNotifications();
  },

  showImportBanner() {
    const banner = document.getElementById("notificationBanner");
    const text = document.getElementById("bannerText");
    if (!banner || !text) return;
    text.innerHTML = this.icon('clipboard', 'icon-info') + ' 检测到保险 Excel 数据，<strong>点击此处</strong>一键导入全部 ' + (typeof INSURANCE_POLICIES !== 'undefined' ? INSURANCE_POLICIES.length : 16) + ' 条保单';
    banner.style.display = "flex";
    banner.style.background = "linear-gradient(135deg, #dbeafe, #e0e7ff)";
    banner.style.borderColor = "#4a6cf7";
    banner.querySelector(".banner-icon").innerHTML = this.icon('clipboard');
    banner.onclick = () => this.importInsuranceData();
  },

  checkNotifications() {
    var insurance = Storage.get(Storage.keys.insurance);
    var self = this;
    // 先自动调整所有过期日期
    var needSave = false;
    insurance.forEach(function(item) {
      var oldDate = item.nextPayDate;
      var newDate = self.adjustNextPayDate(item);
      if (newDate !== oldDate) {
        item.nextPayDate = newDate;
        Storage.update(Storage.keys.insurance, item.id, { nextPayDate: newDate });
        needSave = true;
      }
    });
    if (needSave) {
      insurance = Storage.get(Storage.keys.insurance); // 重新获取
    }
    var now = new Date(); now.setHours(0,0,0,0);
    var notifications = [];
    insurance.forEach(function(item) {
      if (!item.nextPayDate) return;
      var parts = item.nextPayDate.split('-');
      var payDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      var diff = Math.ceil((payDate - now) / 86400000);
      if (diff >= 0 && diff <= 30) {
        notifications.push({ type:"pay", product:item.product, person:item.person, daysLeft:diff, date:item.nextPayDate, amount:item.premium });
      }
    });
    notifications.sort((a, b) => a.daysLeft - b.daysLeft);
    if (notifications.length > 0) {
      this.showNotificationBanner(notifications);
    }
    const urgent = notifications.filter(n => n.daysLeft <= 7 && n.type === "pay");
    if (urgent.length > 0) {
      const msg = urgent.map(n => n.product + "(" + n.person + "): " + (n.daysLeft===0?"今天":n.daysLeft+"天后") + "需缴费 ¥" + Number(n.amount).toLocaleString()).join("\n");
      this.sendBrowserNotification("保险缴费提醒", msg);
    }
  },

  showNotificationBanner(notifications) {
    const banner = document.getElementById("notificationBanner");
    const text = document.getElementById("bannerText");
    if (!banner || !text) return;
    const payItems = notifications.filter(n => n.type === "pay");
    const collectItems = notifications.filter(n => n.type === "collect");
    let html = "";
    if (payItems.length > 0) {
      html += "<strong>" + this.icon('notify', 'icon-warning') + " 缴费提醒（" + payItems.length + "条）</strong>";
      payItems.slice(0,3).forEach(n => {
        html += "<div style=\"font-size:13px;margin-top:4px;\">" + n.product + "(" + n.person + "): " + (n.daysLeft===0?"<strong>今天</strong>":n.daysLeft+"天后") + " 需缴费 ¥" + Number(n.amount).toLocaleString() + "</div>";
      });
    }
    text.innerHTML = html;
    banner.style.display = "flex";
    banner.style.background = "linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.05))";
    banner.style.borderColor = "rgba(251,191,36,0.3)";
    document.getElementById("closeBanner").onclick = (e) => { e.stopPropagation(); banner.style.display = "none"; };
  },

  importInsuranceData(silent) {
    console.log('[App] importInsuranceData 开始, silent=' + silent);
    if (!silent && !confirm("将导入 " + (INSURANCE_POLICIES ? INSURANCE_POLICIES.length : 16) + " 条保单数据，是否继续？\n已存在的保单不会重复导入。")) return;
    
    var policies = (typeof INSURANCE_POLICIES !== 'undefined') ? INSURANCE_POLICIES : [];
    console.log('[App] INSURANCE_POLICIES 可用:', (typeof INSURANCE_POLICIES !== 'undefined'), '长度:', policies.length);
    
    if (policies.length === 0) {
      console.error('[App] 保单数据为空，无法导入！');
      if (!silent) alert('保单数据加载失败，请刷新页面后重试。');
      return;
    }

    try {
      var existing = Storage.get(Storage.keys.insurance, true); // 包含已删除，便于修复旧 ID
      var existingContracts = new Set();
      var existingMap = {};
      existing.forEach(function(p) { if (p && p.contractNo) { existingContracts.add(p.contractNo); existingMap[p.contractNo] = p; } });
      console.log('[App] 已有合同号:', existingContracts.size, '个');
      
      var added = 0;
      var updated = 0;
      var idFixed = 0;
      var self = this;
      policies.forEach(function(p) {
        var stableId = p.contractNo;
        if (existingContracts.has(p.contractNo)) {
          // 已有记录：与数据源比对，更新变更的字段
          var ex = existingMap[p.contractNo];
          var merge = {};
          if (ex.payPeriod !== p.payPeriod) merge.payPeriod = p.payPeriod;
          if (!ex.collectDate && p.collectDate) merge.collectDate = p.collectDate;
          if (!ex.collectAmount && p.collectAmount) merge.collectAmount = p.collectAmount;
          if (ex.expireDate !== p.expireDate) merge.expireDate = p.expireDate;
          if (ex.collectNote !== p.collectNote) merge.collectNote = p.collectNote;
          // 当数据源明确标记为无下次缴费（nextPayDate=null）时，清除旧记录中的日期
          if (p.nextPayDate === null && ex.nextPayDate) merge.nextPayDate = null;
          if (p.baseNextPayDate === null && ex.baseNextPayDate) merge.baseNextPayDate = null;
          // 修复旧记录 ID 为稳定键（合同号），避免跨设备同步后出现双份
          if (ex.id !== stableId) {
            var all = Storage.get(Storage.keys.insurance, true);
            var idx = all.findIndex(function(x) { return x.id === ex.id; });
            if (idx !== -1) {
              all[idx].id = stableId;
              all[idx].updatedAt = new Date().toISOString();
              Storage.set(Storage.keys.insurance, all);
              idFixed++;
              console.log('[App] 修复保单 ID:', ex.id, '→', stableId);
            }
            ex.id = stableId;
            existingMap[p.contractNo] = ex;
          }
          if (Object.keys(merge).length > 0) {
            Storage.update(Storage.keys.insurance, stableId, merge);
            updated++;
            console.log('[App] 更新已存在保单字段:', p.contractNo, Object.keys(merge).join(','));
          }
          return;
        }
        // 新增：使用合同号作为稳定 ID
        p.id = stableId;
        // 自动调整下次缴费日期（将过期日期推进到未来）
        p.nextPayDate = self.adjustNextPayDate(p);
        Storage.add(Storage.keys.insurance, p);
        added++;
        console.log('[App] 添加保单:', p.product.substring(0,20), '|', p.person, '| 缴费日:', p.nextPayDate);
      });

      console.log('[App] 导入完成，新增:', added, '更新:', updated, '修复ID:', idFixed, '总保单数:', Storage.get(Storage.keys.insurance).length);
      localStorage.setItem("fm_insurance_imported", "true");
      
      if (!silent) {
        var msg = "操作完成！";
        if (added > 0) msg += " 新增 " + added + " 条保单。";
        if (updated > 0) msg += " 更新 " + updated + " 条保单字段。";
        if (idFixed > 0) msg += " 修复 " + idFixed + " 条保单 ID。";
        alert(msg);
      } else {
        if (added > 0) console.log('[App] 已自动导入 ' + added + ' 条保单');
        if (updated > 0) console.log('[App] 已自动更新 ' + updated + ' 条保单字段');
        if (idFixed > 0) console.log('[App] 已自动修复 ' + idFixed + ' 条保单 ID');
      }
      this.loadDashboard();
    } catch(e) {
      console.error('[App] importInsuranceData 异常:', e);
      if (!silent) alert('导入失败: ' + e.message);
    }
  },

  // === 股票数据导入与价格更新 ===

  checkStockImportStatus() {
    console.log('[App] checkStockImportStatus...');
    try {
      var existing = Storage.get(Storage.keys.stocks);
      console.log('[App] 当前股票数量:', existing.length);
      var holdings = (typeof STOCK_HOLDINGS !== 'undefined') ? STOCK_HOLDINGS : [];
      console.log('[App] STOCK_HOLDINGS 数量:', holdings.length);

      if (holdings.length === 0) {
        console.log('[App] 无股票数据源，跳过');
        return;
      }

      var needImport = false;
      if (existing.length === 0) {
        needImport = true;
        console.log('[App] 股票为空，触发导入');
      } else {
        // 检查数据源中的股票是否都已存在
        holdings.forEach(function(h) {
          var found = existing.some(function(ex) { return ex.code === h.code; });
          if (!found) {
            console.log('[App] 缺少股票 ' + h.code + ' ' + h.name + '，需导入');
            needImport = true;
          }
        });
        // 检查已有股票是否有缺失字段需要合并
        if (!needImport) {
          existing.forEach(function(ex) {
            var src = null;
            for (var i = 0; i < holdings.length; i++) {
              if (holdings[i].code === ex.code) { src = holdings[i]; break; }
            }
            if (src && (ex.cost !== src.cost || ex.shares !== src.shares || ex.broker !== src.broker ||
                // 源数据有有效价格时，才比较 price（避免用 0 覆盖已获取的实时价）
                (src.currentPrice && ex.currentPrice !== src.currentPrice))) {
              console.log('[App] 股票 ' + ex.code + ' 信息需更新，触发合并');
              needImport = true;
            }
          });
        }
      }

      if (needImport) {
        this.importStockData();
      } else {
        console.log('[App] 股票数据完整，跳过导入');
      }
    } catch(e) {
      console.error('[App] checkStockImportStatus 异常:', e);
    }
  },

  importStockData() {
    console.log('[App] importStockData 开始');
    var holdings = (typeof STOCK_HOLDINGS !== 'undefined') ? STOCK_HOLDINGS : [];
    if (holdings.length === 0) {
      console.log('[App] STOCK_HOLDINGS 为空，跳过');
      return;
    }
    try {
      var existing = Storage.get(Storage.keys.stocks, true); // 包含已删除，便于修复旧 ID
      console.log('[App] 导入前 stock 数量:', existing.length);
      var existingCodes = new Set();
      var existingMap = {};
      existing.forEach(function(s) { if (s && s.code) { existingCodes.add(s.code); existingMap[s.code] = s; } });
      console.log('[App] 已有代码:', Array.from(existingCodes).join(', '));
      var added = 0, merged = 0, idFixed = 0;

      holdings.forEach(function(h) {
        var stockData = {
          id: h.code,
          code: h.code,
          name: h.name,
          shares: h.shares,
          cost: h.cost,
          currentPrice: h.currentPrice || h.cost,
          currency: h.currency || "HKD",
          market: h.market || "HK",
          broker: h.broker || "",
          accountNo: h.accountNo || ""
        };

        if (existingCodes.has(h.code)) {
          // 已有：合并更新字段（保护已从网络获取的实时价格）
          var idx = existing.findIndex(function(s) { return s.code === h.code; });
          if (idx >= 0) {
            var exist = existing[idx];
            // 修复旧 ID 为稳定键（股票代码）
            if (exist.id !== h.code) {
              var all = Storage.get(Storage.keys.stocks, true);
              var aidx = all.findIndex(function(x) { return x.id === exist.id; });
              if (aidx !== -1) {
                all[aidx].id = h.code;
                all[aidx].updatedAt = new Date().toISOString();
                Storage.set(Storage.keys.stocks, all);
                idFixed++;
                console.log('[App] 修复股票 ID:', exist.id, '→', h.code);
              }
              exist.id = h.code;
            }
            // 如果源数据 currentPrice 为占位(0)，保留已获取的实时价格
            if (!stockData.currentPrice && exist.currentPrice) {
              stockData.currentPrice = exist.currentPrice;
              console.log('[App] 保护已获取价格:', h.code, '保持', exist.currentPrice);
            }
            Storage.update(Storage.keys.stocks, h.code, stockData);
            merged++;
            console.log('[App] 合并更新股票:', h.code, h.name, '| 现价:', stockData.currentPrice);
          }
        } else {
          // 新增
          Storage.add(Storage.keys.stocks, stockData);
          added++;
          console.log('[App] 新增股票:', h.code, h.name, '| 现价:', stockData.currentPrice);
        }
      });

      console.log('[App] 股票导入完成，新增:', added, '合并:', merged, '修复ID:', idFixed, '总数:', Storage.get(Storage.keys.stocks).length);
      if (added > 0 || merged > 0 || idFixed > 0) {
        this.loadStockList();
        this.loadDashboard();    // 刷新 Dashboard 总资产
        var msg = added > 0 ? ("已导入 " + added + " 只股票") : "";
        msg += merged > 0 ? (msg ? "，" : "") + "已更新 " + merged + " 只" : "";
        msg += idFixed > 0 ? (msg ? "，" : "") + "已修复 " + idFixed + " 只 ID" : "";
        this.showToast(msg);
      }
    } catch(e) {
      console.error('[App] importStockData 异常:', e);
      alert("股票导入失败：" + e.message);
    }
  },

  // ===== RSU 股权激励管理 =====

  // 检查是否需要导入/更新 RSU 数据
  checkRsuImportStatus() {
    console.log('[App] checkRsuImportStatus 开始');
    try {
      var grants = (typeof RSU_GRANTS !== 'undefined') ? RSU_GRANTS : [];
      if (grants.length === 0) {
        console.log('[App] 无 RSU 数据源，跳过');
        return;
      }
      var existing = Storage.get(Storage.keys.rsu);
      console.log('[App] RSU 本地数据:', existing.length, '条');
      if (existing.length === 0) {
        console.log('[App] RSU 为空，触发导入');
        this.importRsuData();
        return;
      }
      // 检查数据源是否有新增 grant
      var hasNew = false;
      grants.forEach(function(g) {
        var found = existing.some(function(ex) { return ex.code === g.code; });
        if (!found) { hasNew = true; }
      });
      if (hasNew) {
        console.log('[App] 有新 RSU grant，触发导入');
        this.importRsuData();
        return;
      }
      // 检查当前日期是否有新解禁（重新计算 vested）
      this._recalcRsuVested();
    } catch(e) {
      console.error('[App] checkRsuImportStatus 异常:', e);
    }
  },

  // 根据当前日期重新计算 RSU 已解禁份额
  _recalcRsuVested() {
    var rsuList = Storage.get(Storage.keys.rsu);
    if (rsuList.length === 0) return;
    var today = new Date(); today.setHours(0,0,0,0);
    var changed = false;

    rsuList.forEach(function(r) {
      var vested = 0;
      if (r.vesting && Array.isArray(r.vesting)) {
        r.vesting.forEach(function(v) {
          var parts = v.date.split('-');
          var vestDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
          if (vestDate <= today) vested += parseInt(v.shares) || 0;
        });
      }
      var totalShares = parseInt(r.totalShares) || 0;
      var locked = Math.max(0, totalShares - vested);
      if (vested !== (parseInt(r.vested) || 0) || locked !== (parseInt(r.locked) || 0)) {
        Storage.update(Storage.keys.rsu, r.id, { vested: vested, locked: locked });
        changed = true;
        console.log('[RSU] 重新计算解禁: ' + r.name + ' 已解禁=' + vested + ' 锁定=' + locked);
      }
    });

    if (changed && this.currentPage === "stocks") {
      this.loadRsuList();
    }
  },

  // 导入 RSU 数据
  importRsuData() {
    console.log('[App] importRsuData 开始');
    var grants = (typeof RSU_GRANTS !== 'undefined') ? RSU_GRANTS : [];
    if (grants.length === 0) return;

    try {
      var existing = Storage.get(Storage.keys.rsu, true); // 包含已删除，便于修复旧 ID
      var today = new Date(); today.setHours(0,0,0,0);

      grants.forEach(function(g) {
        // 计算已解禁份额
        var vested = 0;
        if (g.vesting && Array.isArray(g.vesting)) {
          g.vesting.forEach(function(v) {
            var parts = v.date.split('-');
            var vestDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            if (vestDate <= today) vested += parseInt(v.shares) || 0;
          });
        }
        var totalShares = parseInt(g.totalShares) || 0;
        var locked = Math.max(0, totalShares - vested);

        var rsuData = {
          id: g.code,
          code: g.code,
          name: g.name,
          totalShares: totalShares,
          vested: vested,
          locked: locked,
          grantPrice: g.grantPrice,
          currentPrice: g.currentPrice || g.grantPrice,
          vesting: g.vesting,
          currency: g.currency || "CNY",
          market: g.market || "CN",
          plan: g.plan || "",
          grantor: g.grantor || "",
          grantDate: g.grantDate,
          longCash: g.longCash || null
        };

        var idx = existing.findIndex(function(ex) { return ex.code === g.code; });
        if (idx >= 0) {
          var exist = existing[idx];
          if (exist.id !== g.code) {
            var all = Storage.get(Storage.keys.rsu, true);
            var aidx = all.findIndex(function(x) { return x.id === exist.id; });
            if (aidx !== -1) {
              all[aidx].id = g.code;
              all[aidx].updatedAt = new Date().toISOString();
              Storage.set(Storage.keys.rsu, all);
              console.log('[App] 修复 RSU ID:', exist.id, '→', g.code);
            }
            exist.id = g.code;
          }
          if (!rsuData.currentPrice && exist.currentPrice) {
            rsuData.currentPrice = exist.currentPrice;
          }
          Storage.update(Storage.keys.rsu, g.code, rsuData);
          console.log('[App] 合并更新 RSU:', g.code, g.name, '| 已解禁:', vested, '锁定:', locked);
        } else {
          Storage.add(Storage.keys.rsu, rsuData);
          console.log('[App] 新增 RSU:', g.code, g.name, '| 已解禁:', vested, '锁定:', locked);
        }
      });

      this.loadRsuList();
      this.loadDashboard();    // 刷新 Dashboard 总资产（RSU 已解禁部分计入资产）
      this.showToast("RSU 激励数据已更新");
    } catch(e) {
      console.error('[App] importRsuData 异常:', e);
      alert("RSU 导入失败：" + e.message);
    }
  },

  // 渲染 RSU 列表
  loadRsuList() {
    console.log('[App] loadRsuList 开始');
    try {
      var rsuList = Storage.get(Storage.keys.rsu);
      var container = document.getElementById("rsuList");
      var vestedValEl = document.getElementById("rsuVestedValue");
      var lockedValEl = document.getElementById("rsuLockedValue");

      if (!container) { console.log('[App] rsuList DOM 不存在'); return; }
      if (rsuList.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无股权激励记录</div>';
        if (vestedValEl) vestedValEl.textContent = '¥0.00';
        if (lockedValEl) lockedValEl.textContent = '¥0.00';
        return;
      }

      var totalVestedValue = 0, totalLockedValue = 0;
      var self = this;
      var html = "";

      rsuList.forEach(function(r) {
        var vested = parseInt(r.vested) || 0;
        var locked = parseInt(r.locked) || 0;
        var totalShares = parseInt(r.totalShares) || 0;
        var price = parseFloat(r.currentPrice) || parseFloat(r.grantPrice) || 0;
        var grantPrice = parseFloat(r.grantPrice) || 0;
        var vestedValue = vested * price;
        var lockedValue = Math.max(0, locked * (price - grantPrice));
        totalVestedValue += vestedValue;
        totalLockedValue += lockedValue;

        var progressPct = totalShares > 0 ? Math.round((vested / totalShares) * 100) : 0;

        var vestingHtml = "";
        if (r.vesting && Array.isArray(r.vesting)) {
          var today2 = new Date(); today2.setHours(0,0,0,0);
          vestingHtml = '<div style="margin-top:6px;font-size:11px;color:#94a3b8;">';
          r.vesting.forEach(function(v) {
            var parts = v.date.split('-');
            var vestDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            var isVested = vestDate <= today2;
            var icon = isVested ? self.icon('check', 'icon-accent') : self.icon('lock', 'icon-muted');
            vestingHtml += '<span style="display:inline-block;margin-right:12px;' + (isVested ? 'color:#4ade80;' : 'color:#f59e0b;') + '">'
              + icon + ' ' + v.date + ' ' + v.shares + '股</span>';
          });
          vestingHtml += '</div>';
        }

        var longCashHtml = "";
        if (r.longCash) {
          longCashHtml = '<div style="margin-top:4px;font-size:11px;color:#22d3ee;">'
            + '长期现金激励: ¥' + r.longCash.total.toLocaleString()
            + ' (' + r.longCash.perYear.toLocaleString() + '/年)</div>';
        }

        html += '<div class="record-item record-item-rsu">'
          + '<div class="record-info">'
            + '<div class="record-title">' + r.name + '（' + r.code + '）'
              + ' <span style="font-size:11px;color:#22d3ee;font-weight:normal;">RSU</span></div>'
            + '<div class="record-detail">'
              + '授予总数: ' + totalShares + ' 股'
              + ' · 授予价 ¥' + self.formatMoney(grantPrice)
              + ' · 现价 ¥' + self.formatMoney(price)
              + '</div>'
            + '<div class="record-detail">'
              + '已解禁: '
              + '<span class="inline-editable" data-type="rsu-vested" data-id="' + r.id + '">' + vested + '</span>'
              + ' 股 (¥' + self.formatMoney(vestedValue) + ')'
              + ' · 锁定: ' + locked + ' 股 (获利 ¥' + self.formatMoney(lockedValue) + ')'
              + '</div>'
            + '<div style="margin-top:6px;background:rgba(255,255,255,0.06);border-radius:4px;height:6px;overflow:hidden;">'
              + '<div style="height:100%;width:' + progressPct + '%;background:linear-gradient(90deg,#22d3ee,#67e8f9);border-radius:4px;"></div>'
            + '</div>'
            + '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">归属进度 ' + progressPct + '%'
              + (r.grantDate ? ' · 授予日 ' + r.grantDate : '')
              + (r.grantor ? ' · ' + r.grantor : '') + '</div>'
            + vestingHtml
            + longCashHtml
          + '</div>'
          + '<div class="stock-chart-inner" id="stockChartInner_' + r.code + '">'
            + '<div class="stock-chart-change-inline" id="stockChartCanvas_' + r.code + '_change"></div>'
            + '<div class="stock-chart-canvas-wrap">'
              + '<canvas id="stockChartCanvas_' + r.code + '"></canvas>'
              + '<div class="stock-chart-loading" id="stockChartCanvas_' + r.code + '_loading">加载中...</div>'
              + '<div class="stock-chart-error" id="stockChartCanvas_' + r.code + '_error" style="display:none;">暂无数据</div>'
            + '</div>'
          + '</div>'
        + '</div>';
      });

      container.innerHTML = html;
      if (vestedValEl) vestedValEl.textContent = self.formatMoney(totalVestedValue);
      if (lockedValEl) lockedValEl.textContent = self.formatMoney(totalLockedValue);
      console.log('[App] loadRsuList 完成: 已解禁价值=' + totalVestedValue + ' 锁定价值=' + totalLockedValue);

      // 渲染6个月走势图（在此处调用确保 stocks + RSU 的 DOM 均已就绪）
      self.renderStockCharts();
    } catch(e) {
      console.error('[App] loadRsuList 异常:', e);
      var container = document.getElementById("rsuList");
      if (container) container.innerHTML = '<div class="empty-tip" style="color:red;">加载出错: ' + e.message + '</div>';
    }
  },

  // 手动修改 RSU 当前价
  editRsuPrice(id) {
    var rsuList = Storage.get(Storage.keys.rsu);
    var item = rsuList.find(function(r) { return r.id === id; });
    if (!item) return;
    var newPrice = prompt("修改 " + item.name + " 当前股价 (¥)", item.currentPrice);
    if (newPrice !== null && !isNaN(parseFloat(newPrice)) && parseFloat(newPrice) >= 0) {
      Storage.update(Storage.keys.rsu, id, { currentPrice: parseFloat(newPrice) });
      this.loadRsuList();
      this.showToast(item.name + " 股价已更新");
    }
  },

  // ===== RSU END =====

  // ===== 就地编辑（内联编辑）通用方法 =====
  // 启动就地编辑（股票 shares / RSU vested）
  startInlineEdit(type, id) {
    var self = this;
    var trigger = document.querySelector('.inline-editable[data-type="' + type + '"][data-id="' + id + '"]');
    if (!trigger) return;
    // 防止重复进入
    if (trigger.parentNode && trigger.parentNode.classList && trigger.parentNode.classList.contains('inline-edit-active')) {
      return;
    }
    var currentValue = trigger.textContent.trim();
    var origHTML = trigger.outerHTML;
    var item = null;
    var minVal = 0, maxVal = Infinity, label = '股数', errorMsg = '';

    if (type === 'stock-shares') {
      var stockList = Storage.get(Storage.keys.stocks);
      item = stockList.find(function(s) { return s.id === id; });
      if (!item) return;
      label = item.name + ' 持有股数';
      maxVal = Infinity;
    } else if (type === 'rsu-vested') {
      var rsuList = Storage.get(Storage.keys.rsu);
      item = rsuList.find(function(r) { return r.id === id; });
      if (!item) return;
      label = item.name + ' 已解禁股数';
      var totalShares = parseInt(item.totalShares) || 0;
      maxVal = totalShares;
    }

    // 构建编辑态 DOM
    var wrap = document.createElement('span');
    wrap.className = 'inline-edit-active';
    wrap.dataset.origHtml = origHTML;
    wrap.innerHTML =
      '<input type="number" class="inline-edit-input" value="' + currentValue + '" min="' + minVal + '" max="' + (maxVal === Infinity ? '' : maxVal) + '" step="1" />' +
      '<span class="inline-edit-suffix">股</span>' +
      '<span class="inline-edit-actions">' +
        '<button type="button" class="inline-edit-btn btn-save" title="保存">' + self.icon('check') + '</button>' +
        '<button type="button" class="inline-edit-btn btn-cancel" title="取消">' + self.icon('close') + '</button>' +
      '</span>';

    // 替换触发器
    trigger.parentNode.replaceChild(wrap, trigger);
    var inputEl = wrap.querySelector('.inline-edit-input');
    var saveBtn = wrap.querySelector('.btn-save');
    var cancelBtn = wrap.querySelector('.btn-cancel');

    // 自动聚焦 + 选中文本
    setTimeout(function() {
      inputEl.focus();
      inputEl.select();
    }, 30);

    // 保存处理
    function doSave() {
      var raw = inputEl.value.trim();
      var newVal = parseInt(raw, 10);
      if (isNaN(newVal) || newVal < minVal) {
        inputEl.classList.add('invalid');
        self.showToast('请输入 ≥ ' + minVal + ' 的整数', 'error');
        inputEl.focus();
        return;
      }
      if (newVal > maxVal) {
        inputEl.classList.add('invalid');
        self.showToast(label + ' 不能超过 ' + maxVal + ' 股', 'error');
        inputEl.focus();
        return;
      }
      // 数据已无变化
      if (newVal === parseInt(currentValue, 10)) {
        doCancel();
        return;
      }
      self.saveInlineEdit(type, id, newVal, wrap, origHTML);
    }

    // 取消处理
    function doCancel() {
      if (wrap.parentNode) {
        var tmp = document.createElement('span');
        tmp.innerHTML = origHTML;
        wrap.parentNode.replaceChild(tmp.firstChild, wrap);
      }
    }

    // 事件绑定
    saveBtn.addEventListener('click', doSave);
    cancelBtn.addEventListener('click', doCancel);
    inputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
      else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    });
    inputEl.addEventListener('input', function() {
      inputEl.classList.remove('invalid');
    });
    // 点击其他区域自动取消
    var outsideClickHandler = function(e) {
      if (wrap && !wrap.contains(e.target) && !wrap.parentNode.contains(e.target)) {
        doCancel();
        document.removeEventListener('click', outsideClickHandler, true);
      }
    };
    setTimeout(function() {
      document.addEventListener('click', outsideClickHandler, true);
    }, 50);
  },

  // 保存就地编辑结果
  saveInlineEdit(type, id, newVal, wrapEl, origHTML) {
    var self = this;
    if (type === 'stock-shares') {
      var stockList = Storage.get(Storage.keys.stocks);
      var stock = stockList.find(function(s) { return s.id === id; });
      if (!stock) return;
      var oldShares = parseInt(stock.shares) || 0;
      Storage.update(Storage.keys.stocks, id, { shares: newVal });
      self.loadStockList();
      self.loadDashboard();
      self.showToast(stock.name + ' 持有股数: ' + oldShares + ' → ' + newVal + ' 股', 'success');
    } else if (type === 'rsu-vested') {
      var rsuList = Storage.get(Storage.keys.rsu);
      var rsu = rsuList.find(function(r) { return r.id === id; });
      if (!rsu) return;
      var totalShares = parseInt(rsu.totalShares) || 0;
      var oldVested = parseInt(rsu.vested) || 0;
      var newLocked = Math.max(0, totalShares - newVal);
      Storage.update(Storage.keys.rsu, id, { vested: newVal, locked: newLocked });
      self.loadRsuList();
      self.loadDashboard();
      self.showToast(rsu.name + ' 已解禁: ' + oldVested + ' → ' + newVal + ' 股 (锁定 ' + newLocked + ')', 'success');
    }
  },

  // ===== 就地编辑 END =====

  // ===== 基金管理 =====
  // 检查是否需要导入基金数据
  checkFundImportStatus() {
    console.log('[App] checkFundImportStatus...');
    try {
      var existing = Storage.get(Storage.keys.funds);
      var holdings = (typeof FUND_HOLDINGS !== 'undefined') ? FUND_HOLDINGS : [];
      if (holdings.length === 0) { console.log('[App] 无基金数据源，跳过'); return; }

      var needImport = false;
      if (existing.length === 0) {
        needImport = true; console.log('[App] 基金为空，触发导入');
      } else {
        holdings.forEach(function(h) {
          var found = existing.some(function(ex) { return ex.code === h.code; });
          if (!found) { console.log('[App] 缺少基金 ' + h.code + '，需导入'); needImport = true; }
        });
        // 检查是否需要更新
        if (!needImport) {
          existing.forEach(function(ex) {
            var src = null;
            for (var i = 0; i < holdings.length; i++) {
              if (holdings[i].code === ex.code) { src = holdings[i]; break; }
            }
            if (src && (ex.costValue !== src.costValue || ex.holdValue !== src.holdValue)) {
              console.log('[App] 基金 ' + ex.code + ' 信息需更新'); needImport = true;
            }
          });
        }
      }
      if (needImport) this.importFundData();
    } catch(e) { console.error('[App] checkFundImportStatus 异常:', e); }
  },

  importFundData() {
    var holdings = (typeof FUND_HOLDINGS !== 'undefined') ? FUND_HOLDINGS : [];
    if (holdings.length === 0) return;
    try {
      var existing = Storage.get(Storage.keys.funds, true); // 包含已删除，便于修复旧 ID
      var existingCodes = new Set();
      var existingMap = {};
      existing.forEach(function(f) { if (f && f.code) { existingCodes.add(f.code); existingMap[f.code] = f; } });
      var added = 0, merged = 0, idFixed = 0;

      holdings.forEach(function(h) {
        var fundData = {
          id: h.code,
          code: h.code, name: h.name,
          holdValue: h.holdValue || 0, costValue: h.costValue || 0,
          nav: h.nav || 0, shares: h.shares || 0,
          market: h.market || "CN", currency: h.currency || "CNY"
        };

        if (existingCodes.has(h.code)) {
          var idx = existing.findIndex(function(f) { return f.code === h.code; });
          if (idx >= 0) {
            var exist = existing[idx];
            // 修复旧 ID 为稳定键（基金代码）
            if (exist.id !== h.code) {
              var all = Storage.get(Storage.keys.funds, true);
              var aidx = all.findIndex(function(x) { return x.id === exist.id; });
              if (aidx !== -1) {
                all[aidx].id = h.code;
                all[aidx].updatedAt = new Date().toISOString();
                Storage.set(Storage.keys.funds, all);
                idFixed++;
                console.log('[App] 修复基金 ID:', exist.id, '→', h.code);
              }
              exist.id = h.code;
            }
            // 保护已有的净值
            if (!fundData.nav && exist.nav) { fundData.nav = exist.nav; fundData.shares = exist.shares; fundData.holdValue = exist.holdValue; }
            Storage.update(Storage.keys.funds, h.code, fundData);
            merged++;
          }
        } else {
          Storage.add(Storage.keys.funds, fundData);
          added++;
        }
      });

      if (added > 0 || merged > 0 || idFixed > 0) {
        this.loadFundList();
        this.loadDashboard();    // 刷新 Dashboard 总资产
        var msg = added > 0 ? ("已导入 " + added + " 只基金") : "";
        msg += merged > 0 ? (msg ? "，" : "") + "已更新 " + merged + " 只" : "";
        msg += idFixed > 0 ? (msg ? "，" : "") + "已修复 " + idFixed + " 只 ID" : "";
        this.showToast(msg);
      }
    } catch(e) { console.error('[App] importFundData 异常:', e); }
  },

  loadFundList() {
    try {
      var list = Storage.get(Storage.keys.funds);
      var container = document.getElementById("fundList");
      var totalValueEl = document.getElementById("fundTotalValue");
      var totalCostEl = document.getElementById("fundTotalCost");
      var profitLossEl = document.getElementById("fundProfitLoss");

      if (list.length === 0) {
        if (container) container.innerHTML = '<div class="empty-tip">暂无基金记录</div>';
        if (totalValueEl) totalValueEl.textContent = "¥0.00";
        if (totalCostEl) totalCostEl.textContent = "¥0.00";
        if (profitLossEl) profitLossEl.textContent = "¥0.00";
        return;
      }

      var totalHold = 0, totalCost = 0;
      var self = this;
      var html = "";

      list.forEach(function(f) {
        var holdValue = parseFloat(f.holdValue) || 0;
        var costValue = parseFloat(f.costValue) || 0;
        var profit = holdValue - costValue;
        var nav = parseFloat(f.nav) || 0;
        var shares = parseFloat(f.shares) || 0;
        totalHold += holdValue;
        totalCost += costValue;
        var profitClass = profit >= 0 ? "income" : "expense";

        html += '<div class="record-item">' +
          '<div class="record-info">' +
            '<div class="record-title">' + f.name + '（' + f.code + '）</div>' +
            '<div class="record-detail">持仓 ¥' + self._formatNum(holdValue) + ' · 本金 ¥' + self._formatNum(costValue) + '</div>' +
            (nav > 0
              ? '<div class="record-detail" style="font-size:12px;color:#94a3b8;">净值 ¥' + nav.toFixed(4) + ' · 份额 ' + self._formatNum(shares) + ' 份</div>'
              : '<div class="record-detail" style="font-size:12px;color:#f59e0b;">⚠ 净值待查询</div>') +
          '</div>' +
          '<div class="record-amount ' + profitClass + '">' + self.formatMoney(holdValue) +
            '<div style="font-size:12px;">' + (profit >= 0 ? "+" : "") + self.formatMoney(profit) + '</div>' +
          '</div>' +
          '<div class="record-actions">' +
            '<button onclick="App.deleteFund(\'' + f.id + '\')">' + self.icon('delete') + '</button>' +
          '</div>' +
        '</div>';
      });

      if (container) container.innerHTML = html;
      var totalProfit = totalHold - totalCost;
      if (totalValueEl) totalValueEl.textContent = self.formatMoney(totalHold);
      if (totalCostEl) totalCostEl.textContent = self.formatMoney(totalCost);
      if (profitLossEl) {
        profitLossEl.textContent = (totalProfit >= 0 ? "+" : "") + self.formatMoney(totalProfit);
        profitLossEl.style.color = totalProfit >= 0 ? "#22c55e" : "#ef4444";
      }

      // 渲染 6 个月基金市值曲线
      self.renderFundTrend();
    } catch(e) {
      console.error('[App] loadFundList 异常:', e);
      var container = document.getElementById("fundList");
      if (container) container.innerHTML = '<div class="empty-tip" style="color:red;">加载出错: ' + e.message + '</div>';
    }
  },

  saveFund() {
    var holdValue = parseFloat(document.getElementById("fundHoldValue").value) || 0;
    var costValue = parseFloat(document.getElementById("fundCostValue").value) || 0;
    var navInput = document.getElementById("fundNav").value;
    var nav = navInput ? parseFloat(navInput) : 0;
    var sharesInput = document.getElementById("fundShares").value;
    var shares = sharesInput ? parseFloat(sharesInput) : 0;
    // 自动计算：如果有净值和持仓金额，推算份额
    if (nav > 0 && shares <= 0 && holdValue > 0) {
      shares = holdValue / nav;
    }
    Storage.add(Storage.keys.funds, {
      id: document.getElementById("fundCode").value,
      code: document.getElementById("fundCode").value,
      name: document.getElementById("fundName").value,
      holdValue: holdValue,
      costValue: costValue,
      nav: nav,
      shares: parseFloat(shares.toFixed(2)),
      market: "CN",
      currency: "CNY"
    });
    document.getElementById("fundForm").reset();
    document.getElementById("fundFormModal").classList.remove("show");
    this.loadFundList(); this.showToast("基金已添加");
  },

  deleteFund(id) {
    if (!confirm("确定删除此基金？")) return;
    Storage.delete(Storage.keys.funds, id);
    this.loadFundList();
    this.loadDashboard();
    this.showToast("基金已删除");
  },

  editFundPrice(id) {
    var list = Storage.get(Storage.keys.funds);
    var fund = list.find(function(f) { return f.id === id; });
    if (!fund) return;
    var newNav = prompt("修改 " + fund.name + " 基金净值 (¥)", fund.nav);
    if (newNav !== null && !isNaN(parseFloat(newNav)) && parseFloat(newNav) > 0) {
      var nav = parseFloat(newNav);
      var shares = (parseFloat(fund.shares) > 0) ? parseFloat(fund.shares) : (parseFloat(fund.holdValue) / nav);
      var holdValue = shares * nav;
      Storage.update(Storage.keys.funds, id, {
        nav: nav,
        shares: parseFloat(shares.toFixed(2)),
        holdValue: parseFloat(holdValue.toFixed(2))
      });
      this.loadFundList();
      this.showToast(fund.name + " 净值已更新");
    }
  },
  // ===== 基金管理 END =====

  // 自动刷新股价（页面加载时）
  // 规则：距上次刷新超1小时 或 存在现价为0的股票 → 立即刷新
  autoRefreshStockPrices() {
    var lastRefresh = localStorage.getItem("fm_stock_price_last_refresh");
    var now = Date.now();
    var timeExpired = !lastRefresh || (now - parseInt(lastRefresh)) > 3600000;

    // 检查是否有现价为 0 的股票（新导入但未获取到实时价格）
    var hasZeroPrice = false;
    try {
      var stocks = Storage.get(Storage.keys.stocks);
      hasZeroPrice = stocks.some(function(s) {
        var p = parseFloat(s.currentPrice);
        return !p || p <= 0;
      });
      // 同时检查 RSU
      if (!hasZeroPrice) {
        var rsuList = Storage.get(Storage.keys.rsu);
        hasZeroPrice = rsuList.some(function(r) {
          var p = parseFloat(r.currentPrice);
          return !p || p <= 0;
        });
      }
      // 同时检查基金
      if (!hasZeroPrice) {
        var fundList = Storage.get(Storage.keys.funds);
        hasZeroPrice = fundList.some(function(f) {
          var n = parseFloat(f.nav);
          return !n || n <= 0;
        });
      }
    } catch(e) {}

    if (timeExpired) {
      console.log('[App] 距上次刷新超1小时，自动更新股价');
      this.fetchStockPrices();
    } else if (hasZeroPrice) {
      console.log('[App] 存在现价为0的股票，强制刷新股价');
      this.fetchStockPrices();
    } else {
      console.log('[App] 股价近期已更新且无零价股票，跳过');
    }
  },

  // 手动刷新股价按钮
  refreshStockPrices() {
    this.showToast("正在获取最新股价和汇率...");
    this.fetchStockPrices();
  },

  // 获取人民币汇率（优先从 localStorage 读取，否则用默认值）
  getFxRate(currency) {
    var rates = this._getFxRates();
    if (currency === "USD") return rates.USDCNY || 7.2;
    if (currency === "HKD") return rates.HKDCNY || 0.92;
    return 1; // CNY 或其他
  },

  // 将外币金额转换为人民币
  toCNY(amount, currency) {
    var rate = this.getFxRate(currency || "CNY");
    return (parseFloat(amount) || 0) * rate;
  },

  // 从 localStorage 读取汇率
  _getFxRates() {
    try {
      var raw = localStorage.getItem("fm_exchange_rates");
      var rates = raw ? JSON.parse(raw) : {};
      // 默认汇率兜底（避免 API 失败导致汇率为 0）
      if (!rates.USDCNY || rates.USDCNY < 6) rates.USDCNY = 7.2;
      if (!rates.HKDCNY || rates.HKDCNY < 0.5) rates.HKDCNY = 0.92;
      return rates;
    } catch(e) { return { USDCNY: 7.2, HKDCNY: 0.92 }; }
  },

  // 保存汇率到 localStorage
  _saveFxRates(rates) {
    try {
      localStorage.setItem("fm_exchange_rates", JSON.stringify(rates));
    } catch(e) { console.warn('[汇率] 保存失败:', e); }
  },

  // 从 data/stock-prices.json 获取最新股价和汇率（由 Python 脚本定期更新）
  fetchStockPrices() {
    var self = this;
    // 优先使用本地 JSON 文件（静态部署最可靠）
    // 同时尝试在线获取作为补充（不阻塞主流程）
    self._loadPricesFromJson(function() {
      // 本地文件加载成功后，尝试在线获取最新数据
      self._tryFetchLivePrices();
    });
  },

  // 尝试从腾讯财经 API 获取最新价格（<script> 标签方式，无需 CORS）
  _tryFetchLivePrices() {
    var self = this;
    var stocks = Storage.get(Storage.keys.stocks);
    var rsuList = Storage.get(Storage.keys.rsu);
    var fundList = Storage.get(Storage.keys.funds);

    // 收集所有需要获取的代码（转换为腾讯 API 格式）
    var tencentCodes = [];
    var codeMap = {};  // tencentCode → internal code
    stocks.forEach(function(s) {
      var tc = self._getTencentCode(s.code, s.market);
      tencentCodes.push(tc);
      codeMap[tc] = s.code;
    });
    rsuList.forEach(function(r) {
      var tc = self._getTencentCode(r.code, "CN");
      if (tencentCodes.indexOf(tc) === -1) {
        tencentCodes.push(tc);
        codeMap[tc] = r.code;
      }
    });

    if (tencentCodes.length === 0 && (!fundList || fundList.length === 0)) return;

    var results = { stocks: {}, funds: {} };

    // 腾讯 API 通过 <script> 标签加载后会设置全局变量 window.v_usNIO 等
    // 不支持 JSONP 回调，需要在 onload 里主动读取全局变量
    if (tencentCodes.length > 0) {
      var scriptId = "tencent_stock_script";
      var oldScript = document.getElementById(scriptId);
      if (oldScript) oldScript.remove();

      var script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://qt.gtimg.cn/q=" + tencentCodes.join(",");

      script.onload = function() {
        // 读取腾讯 API 设置的全局变量
        tencentCodes.forEach(function(tc) {
          var varName = "v_" + tc;  // 如 "v_usNIO", "v_hk00992"
          var dataStr = window[varName];
          if (!dataStr || typeof dataStr !== "string") return;
          var parts = dataStr.split("~");
          if (parts.length < 4) return;
          var price = parseFloat(parts[3]) || 0;
          if (price <= 0) return;
          var internalCode = codeMap[tc] || tc;
          results.stocks[internalCode] = { price: price, source: "tencent-live" };
          console.log("[股价] " + internalCode + " 在线价格: " + price);
        });

        // 继续处理基金
        if (fundList && fundList.length > 0) {
          self._fetchLiveFundPricesOnly(fundList, results);
        } else if (Object.keys(results.stocks).length > 0) {
          self._applyPriceData({ stocks: results.stocks, funds: results.funds, fetchTime: "在线获取" });
          self.showToast("已更新 " + Object.keys(results.stocks).length + " 项股价（在线）");
        }
      };

      script.onerror = function() {
        console.warn("[股价] 腾讯 API 脚本加载失败");
        // 继续尝试基金
        if (fundList && fundList.length > 0) {
          self._fetchLiveFundPricesOnly(fundList, results);
        }
      };

      document.head.appendChild(script);
    } else {
      self._fetchLiveFundPricesOnly(fundList, results);
    }
  },

  // 仅获取基金净值（逐个获取，避免 jsonpgz 回调冲突）
  _fetchLiveFundPricesOnly(fundList, results) {
    var self = this;
    results.funds = {};

    if (!fundList || fundList.length === 0) {
      self._applyLiveResults(results);
      return;
    }

    var index = 0;

    function fetchNext() {
      if (index >= fundList.length) {
        self._applyLiveResults(results);
        return;
      }

      var f = fundList[index];
      index++;

      // 天天基金 API 固定使用 jsonpgz 作为回调名
      window.jsonpgz = function(data) {
        var nav = parseFloat(data.dwjz) || 0;
        if (nav > 0) {
          results.funds[f.code] = { nav: nav, source: "tiantian-live" };
          console.log('[基金] ' + f.code + ' 在线净值: ' + nav);
        }
        delete window.jsonpgz;
        var script = document.getElementById("fund_script_" + f.code);
        if (script) script.remove();
        fetchNext(); // 继续下一个
      };

      var script = document.createElement("script");
      script.id = "fund_script_" + f.code;
      script.src = "https://fundgz.1234567.com.cn/js/" + f.code + ".js";
      script.onerror = function() {
        console.warn("[基金] script 加载失败: " + f.code);
        delete window.jsonpgz;
        fetchNext();
      };
      document.head.appendChild(script);
    }

    fetchNext();
  },

  // 应用在线获取的结果
  _applyLiveResults(results) {
    var hasStock = Object.keys(results.stocks).length > 0;
    var hasFund = Object.keys(results.funds).length > 0;
    if (hasStock || hasFund) {
      this._applyPriceData({ stocks: results.stocks, funds: results.funds, fetchTime: "在线获取" });
      var msg = "";
      if (hasStock) msg += Object.keys(results.stocks).length + " 项股价";
      if (hasStock && hasFund) msg += "，";
      if (hasFund) msg += Object.keys(results.funds).length + " 项基金净值";
      this.showToast("已更新 " + msg + "（在线）");
    }
  },

  // 从本地 JSON 文件加载价格（file:// 协议下会跳过）
  _loadPricesFromJson(callback) {
    var self = this;
    // Safari file:// 协议不支持 fetch，直接跳过
    if (window.location.protocol === "file:") {
      console.log('[股价] file:// 协议，跳过本地文件，仅使用在线价格');
      if (typeof callback === "function") callback(false);
      return;
    }
    fetch("./data/stock-prices.json?t=" + Date.now())
      .then(function(res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function(data) {
        self._applyPriceData(data);
        self._fetchLiveFxRates();
        if (typeof callback === "function") callback(true);
      })
      .catch(function(e) {
        console.warn('[股价] 本地价格文件不可用:', e.message);
        if (typeof callback === "function") callback(false);
        else self.showToast("价格文件不可用，请检查 data/stock-prices.json 是否存在", "error");
      });
  },

  // 将价格数据应用到 localStorage 并刷新 UI
  _applyPriceData(data) {
    var updated = 0;

    // 1. 更新汇率
    if (data.fxRates && data.fxRates.USDCNY) {
      var rates = {};
      if (data.fxRates.USDCNY && data.fxRates.USDCNY.rate) rates.USDCNY = data.fxRates.USDCNY.rate;
      if (data.fxRates.HKDCNY && data.fxRates.HKDCNY.rate) rates.HKDCNY = data.fxRates.HKDCNY.rate;
      if (Object.keys(rates).length > 0) {
        this._saveFxRates(rates);
        console.log('[汇率] 已更新:', JSON.stringify(rates));
      }
    }

    // 2. 更新股价（股票持仓）
    var stocks = Storage.get(Storage.keys.stocks);
    stocks.forEach(function(stock) {
      var info = data.stocks && data.stocks[stock.code];
      if (info && info.price && parseFloat(info.price).toFixed(2) !== parseFloat(stock.currentPrice).toFixed(2)) {
        Storage.update(Storage.keys.stocks, stock.id, { currentPrice: parseFloat(info.price) });
        updated++;
        console.log('[股价] ' + stock.name + ': ' + stock.currentPrice + ' → ' + info.price);
      }
    });

    // 3. 更新 RSU 股价
    var rsuList = Storage.get(Storage.keys.rsu);
    rsuList.forEach(function(r) {
      var info = data.stocks && data.stocks[r.code];
      if (info && info.price && parseFloat(info.price).toFixed(2) !== parseFloat(r.currentPrice).toFixed(2)) {
        Storage.update(Storage.keys.rsu, r.id, { currentPrice: parseFloat(info.price) });
        updated++;
        console.log('[RSU股价] ' + r.name + ': ' + r.currentPrice + ' → ' + info.price);
      }
    });

    // 4. 更新基金净值
    var fundList = Storage.get(Storage.keys.funds);
    fundList.forEach(function(f) {
      var info = data.funds && data.funds[f.code];
      if (info && info.nav && parseFloat(info.nav) !== parseFloat(f.nav)) {
        var newNav = parseFloat(info.nav);
        var newShares = (parseFloat(f.shares) > 0) ? parseFloat(f.shares) : (parseFloat(f.holdValue) / newNav);
        var newHoldValue = newShares * newNav;
        Storage.update(Storage.keys.funds, f.id, {
          nav: newNav,
          shares: parseFloat(newShares.toFixed(2)),
          holdValue: parseFloat(newHoldValue.toFixed(2))
        });
        updated++;
        console.log('[基金净值] ' + f.name + ': ' + f.nav + ' → ' + newNav);
      }
    });

    localStorage.setItem("fm_stock_price_last_refresh", Date.now().toString());
    // 刷新价格时清除历史K线缓存，确保获取最新走势数据
    this._clearHistoryCache();
    this.loadStockList();
    this.loadRsuList();
    this.loadFundList();
    this.loadDashboard();

    var fetchTime = data.fetchTime || "在线获取";
    if (updated > 0) {
      this.showToast("已更新 " + updated + " 项价格 (" + fetchTime + ")");
    } else {
      this.showToast("价格已是最新 (" + fetchTime + ")");
    }
  },

  // 将内部股票代码转换为腾讯 API 代码
  _getTencentCode(code, market) {
    if (!code) return "";
    if (market === "HK" || code.length === 5) return "hk" + code;
    if (market === "US") return "us" + code.toUpperCase();
    // A股
    if (code.startsWith("6")) return "sh" + code;
    return "sz" + code;
  },

  // 从免费 API 实时获取汇率（作为本地缓存的补充）
  _fetchLiveFxRates() {
    var self = this;
    // file: 协议下跳过在线获取（浏览器禁止 fetch）
    if (location.protocol === 'file:') {
      console.log('[汇率] file: 协议，跳过在线获取');
      return;
    }
    fetch("https://open.er-api.com/v6/latest/USD")
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var rates = data.rates || {};
        var cny = rates.CNY;
        var hkd = rates.HKD;
        if (cny && hkd) {
          var fx = {
            USDCNY: parseFloat(cny.toFixed(4)),
            HKDCNY: parseFloat((cny / hkd).toFixed(4))
          };
          self._saveFxRates(fx);
          console.log('[汇率] 实时汇率已更新:', JSON.stringify(fx));
          // 重新渲染股票列表和RSU列表以应用新汇率
          if (self.currentPage === "stocks") {
            self.loadStockList();
            self.loadRsuList();
          }
        }
      })
      .catch(function(e) {
        console.warn('[汇率] 实时API获取失败:', e.message);
      });
  },

  // ========== 汇率走势图（近6个月）==========
  // 获取近6个月历史汇率（USD/CNY 和 HKD/CNY）
  // 若 API 失败，用本地汇率生成兜底平线数据（确保图能出来）
  _fetchFxHistory(callback) {
    var self = this;
    var cacheKey = 'fm_fx_history';
    var now = new Date();
    var start = new Date(now);
    start.setMonth(start.getMonth() - 6);
    var fmt = function(d) {
      var mm = (d.getMonth() + 1).toString().padStart(2, '0');
      var dd = d.getDate().toString().padStart(2, '0');
      return d.getFullYear() + '-' + mm + '-' + dd;
    };
    var startStr = fmt(start);
    var endStr = fmt(now);

    // 生成兜底数据（用本地汇率，确保图能出来）
    var makeFallback = function() {
      var usdCny = self.getFxRate('USD') || 7.2;
      var hkdCny = self.getFxRate('HKD') || 0.92;
      var data = [];
      var d = new Date(now);
      for (var i = 0; i < 26; i++) {
        var ds = d.getFullYear() + '-' + (d.getMonth()+1).toString().padStart(2,'0') + '-' + d.getDate().toString().padStart(2,'0');
        data.push({ date: ds, rate: 0 });
        d.setDate(d.getDate() - 7);
      }
      data.reverse();
      return {
        usdCny: data.map(function(item) { return { date: item.date, rate: usdCny }; }),
        hkdCny: data.map(function(item) { return { date: item.date, rate: hkdCny }; }),
        isFallback: true
      };
    };

    // 带超时的 fetch 封装
    var fetchWithTimeout = function(url, timeoutMs) {
      return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() {
          reject(new Error('timeout ' + timeoutMs + 'ms'));
        }, timeoutMs);
        fetch(url)
          .then(function(res) {
            clearTimeout(timer);
            resolve(res);
          })
          .catch(function(err) {
            clearTimeout(timer);
            reject(err);
          });
      });
    };

    // 缓存1天内有效
    try {
      var cached = localStorage.getItem(cacheKey);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (parsed && parsed.endDate === endStr && parsed.data) {
          console.log('[汇率走势] 使用缓存, usd条数=' + parsed.data.usdCny.length);
          if (callback) callback(parsed.data);
          return;
        }
      }
    } catch(e) {}

    if (location.protocol === 'file:') {
      console.log('[汇率走势] file: 协议，使用兜底数据');
      if (callback) callback(makeFallback());
      return;
    }

    var url = 'https://api.frankfurter.dev/v1/' + startStr + '..' + endStr + '?from=USD&to=CNY,HKD';
    console.log('[汇率走势] 开始获取 ' + startStr + '..' + endStr);
    fetchWithTimeout(url, 8000)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (!data || !data.rates) {
          console.warn('[汇率走势] API 返回空，使用兜底数据');
          if (callback) callback(makeFallback());
          return;
        }
        var dates = Object.keys(data.rates).sort();
        var usdCny = [];
        var hkdCny = [];
        dates.forEach(function(date) {
          var r = data.rates[date];
          if (r && r.CNY > 0) {
            usdCny.push({ date: date, rate: parseFloat(r.CNY.toFixed(6)) });
            if (r.HKD > 0) {
              hkdCny.push({ date: date, rate: parseFloat((r.CNY / r.HKD).toFixed(6)) });
            }
          }
        });
        console.log('[汇率走势] API 获取成功, USD条数=' + usdCny.length + ', HKD条数=' + hkdCny.length);
        var result = { usdCny: usdCny, hkdCny: hkdCny };
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ endDate: endStr, data: result }));
        } catch(e) {}
        if (callback) callback(result);
      })
      .catch(function(e) {
        console.warn('[汇率走势] 获取失败 (' + e.message + ')，使用兜底数据');
        if (callback) callback(makeFallback());
      });
  },

  // 渲染汇率走势图主入口
  _renderFxTrendCharts() {
    var self = this;
    try {
      console.log('[汇率走势] _renderFxTrendCharts 开始');

      var card = document.getElementById('fxRateCard');
      if (!card) {
        console.warn('[汇率走势] fxRateCard 元素未找到');
        return;
      }

      // 始终显示卡片（避免 Mac 上因 API 失败而丢失卡片）
      card.style.display = 'block';

      // 立即用本地汇率填充（兜底，确保 Mac 上也能看到汇率）
      var usdCny = this.getFxRate('USD');   // USD/CNY
      var hkdCny = this.getFxRate('HKD');   // HKD/CNY
      console.log('[汇率走势] 本地汇率 USD/CNY=' + usdCny + ' HKD/CNY=' + hkdCny);

      var fxUsdCnyEl = document.getElementById('fxUsdCny');
      var fxHkdCnyEl = document.getElementById('fxHkdCny');
      console.log('[汇率走势] 元素 fxUsdCny=' + !!fxUsdCnyEl + ' fxHkdCny=' + !!fxHkdCnyEl);

      if (fxUsdCnyEl && usdCny > 0) fxUsdCnyEl.textContent = usdCny.toFixed(4);
      else console.warn('[汇率走势] 无法填充 USD/CNY: el=' + !!fxUsdCnyEl + ' rate=' + usdCny);
      if (fxHkdCnyEl && hkdCny > 0) fxHkdCnyEl.textContent = hkdCny.toFixed(4);
      else console.warn('[汇率走势] 无法填充 HKD/CNY: el=' + !!fxHkdCnyEl + ' rate=' + hkdCny);

      self._fetchFxHistory(function(history) {
        try {
          var isFallback = history && history.isFallback;
          console.log('[汇率走势] 历史数据回调, usdCny条数=' + (history && history.usdCny ? history.usdCny.length : 0) + ', hkdCny条数=' + (history && history.hkdCny ? history.hkdCny.length : 0) + ', isFallback=' + isFallback);

          // 即使数据不足也尝试渲染（使用纯兜底数据）
          if (!history || !history.usdCny || history.usdCny.length < 2) {
            console.warn('[汇率走势] 数据不足，生成兜底数据');
            // 生成兜底：26个周频点，约6个月
            var now2 = new Date();
            var fmt2 = function(d) { return d.getFullYear() + '-' + (d.getMonth()+1).toString().padStart(2,'0') + '-' + d.getDate().toString().padStart(2,'0'); };
            var fallbackRateU2 = self.getFxRate('USD') || 7.2;
            var fallbackRateH2 = self.getFxRate('HKD') || 0.92;
            var dArr = [];
            var d2 = new Date(now2);
            for (var fi = 0; fi < 26; fi++) {
              dArr.push(fmt2(d2));
              d2.setDate(d2.getDate() - 7);
            }
            dArr.reverse();
            history = {
              usdCny: dArr.map(function(dd) { return { date: dd, rate: fallbackRateU2 }; }),
              hkdCny: dArr.map(function(dd) { return { date: dd, rate: fallbackRateH2 }; }),
              isFallback: true
            };
            isFallback = true;
          }

          // 用历史数据最新值更新汇率（更精确）
          var latestUsd = history.usdCny[history.usdCny.length - 1];
          var latestHkd = history.hkdCny[history.hkdCny.length - 1];
          if (latestUsd && latestUsd.rate > 0) {
            var elU = document.getElementById('fxUsdCny');
            if (elU) elU.textContent = latestUsd.rate.toFixed(4);
          }
          if (latestHkd && latestHkd.rate > 0) {
            var elH = document.getElementById('fxHkdCny');
            if (elH) elH.textContent = latestHkd.rate.toFixed(4);
          }

          // 显示并绘制走势图
          var svg1 = document.getElementById('fxTrendUsdCnySvg');
          var svg2 = document.getElementById('fxTrendHkdCnySvg');
          if (svg1) svg1.style.display = '';
          if (svg2) svg2.style.display = '';
          self._drawFxTrendChart('fxTrendUsdCnySvg', history.usdCny, 'USD/CNY', isFallback);
          self._drawFxTrendChart('fxTrendHkdCnySvg', history.hkdCny, 'HKD/CNY', isFallback);

          // 在卡片底部显示数据来源说明
          var noteEl = document.getElementById('fxDataSourceNote');
          if (noteEl) {
            if (isFallback) {
              noteEl.textContent = '（汇率走势为模拟数据，基于当前汇率生成）';
              noteEl.style.color = 'var(--text-muted, #64748b)';
            } else {
              noteEl.textContent = '（数据来源：frankfurter.dev，近6个月）';
              noteEl.style.color = 'var(--text-muted, #64748b)';
            }
            noteEl.style.display = '';
          }

          console.log('[汇率走势] 渲染完成');
        } catch(innerErr) {
          console.error('[汇率走势] 回调内异常:', innerErr);
        }
      });
    } catch(err) {
      console.error('[汇率走势] _renderFxTrendCharts 异常:', err);
    }
  },

  // 绘制单个汇率 SVG 走势图
  // isFallback: 是否为模拟数据（会在图上加水印提示）
  _drawFxTrendChart(containerId, data, label, isFallback) {
    var container = document.getElementById(containerId);
    if (!container) return;
    if (!data || data.length < 2) {
      container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;font-size:12px;">数据不足</div>';
      return;
    }

    var W = 300, H = 120, PAD = { top: 10, right: 8, bottom: 22, left: 38 };
    var plotW = W - PAD.left - PAD.right;
    var plotH = H - PAD.top - PAD.bottom;

    var rates = data.map(function(d) { return d.rate; });
    var minR = Math.min.apply(null, rates);
    var maxR = Math.max.apply(null, rates);
    var range = maxR - minR || 0.001;
    var yMin = minR - range * 0.05;
    var yMax = maxR + range * 0.05;

    var xScale = function(i) { return PAD.left + (i / (data.length - 1)) * plotW; };
    var yScale = function(v) { return PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH; };

    var points = data.map(function(d, i) {
      return xScale(i) + ',' + yScale(d.rate);
    });
    var polyline = points.join(' ');

    var gradId = containerId + '_grad';
    var latest = data[data.length - 1].rate;
    var first = data[0].rate;
    var isUp = latest >= first;
    var lineColor = isUp ? '#ef4444' : '#22c55e';

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;">' +
      '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + (isUp ? 'rgba(239,68,68,0.18)' : 'rgba(34,197,94,0.18)') + '"/>' +
        '<stop offset="100%" stop-color="rgba(0,0,0,0)"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + PAD.left + ',' + (PAD.top + plotH) + ' ' + polyline + ' ' + (PAD.left + plotW) + ',' + (PAD.top + plotH) + '" fill="url(#' + gradId + ')"/>' +
      '<polyline points="' + polyline + '" fill="none" stroke="' + lineColor + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + xScale(data.length - 1) + '" cy="' + yScale(latest) + '" r="2.5" fill="' + lineColor + '"/>' +
      '<text x="' + (PAD.left - 3) + '" y="' + (yScale(yMax) + 3) + '" text-anchor="end" fill="#64748b" font-size="8">' + yMax.toFixed(4) + '</text>' +
      '<text x="' + (PAD.left - 3) + '" y="' + (yScale(yMin) + 3) + '" text-anchor="end" fill="#64748b" font-size="8">' + yMin.toFixed(4) + '</text>' +
      '<text x="' + (PAD.left - 3) + '" y="' + (yScale(latest) + 3) + '" text-anchor="end" fill="' + lineColor + '" font-size="8" font-weight="600">' + latest.toFixed(4) + '</text>' +
      '<text x="' + PAD.left + '" y="' + (H - 4) + '" text-anchor="start" fill="#64748b" font-size="8">' + data[0].date.slice(5) + '</text>' +
      '<text x="' + (PAD.left + plotW) + '" y="' + (H - 4) + '" text-anchor="end" fill="#64748b" font-size="8">' + data[data.length - 1].date.slice(5) + '</text>' +
      (isFallback ? '<text x="' + (PAD.left + plotW / 2) + '" y="' + (PAD.top + plotH / 2) + '" text-anchor="middle" fill="rgba(100,116,139,0.25)" font-size="10" font-weight="600" transform="rotate(-15 ' + (PAD.left + plotW / 2) + ' ' + (PAD.top + plotH / 2) + ')">模拟数据</text>' : '') +
    '</svg>';

    container.innerHTML = svg;
  },

  // ========== 股票走势图（6个月K线）==========

  // 清除历史K线缓存（刷新价格时调用，确保获取最新数据）
  _clearHistoryCache() {
    var self = this;
    try {
      var stocks = Storage.get(Storage.keys.stocks) || [];
      stocks.forEach(function(s) {
        localStorage.removeItem("fm_stock_hist_" + s.code);
      });
      console.log('[走势图] 已清除历史K线缓存');
    } catch(e) {}
  },


  // 从腾讯财经K线API获取历史数据（日线，约120个交易日≈6个月）
  // 数据源优先级: 内存缓存 > 在线API(腾讯) > window.STOCK_HISTORY_DATA(内联) > localStorage
  fetchStockHistoryData(code, market, callback) {
    var self = this;
    var tc = this._getTencentCode(code, market);
    if (!tc) { if (callback) callback(null); return; }

    // 内存缓存：同一会话内不重复请求同一股票的历史数据
    if (!this._stockHistoryCache) this._stockHistoryCache = {};
    var cacheKey = code + '_' + (market || '');
    if (this._stockHistoryCache[cacheKey]) {
      console.log('[走势图] ' + code + ' 命中内存缓存');
      if (callback) callback(this._stockHistoryCache[cacheKey]);
      return;
    }

    // 包装 callback，成功时自动写入缓存
    var origCallback = callback;
    callback = function(data) {
      if (data && data.length >= 5) {
        self._stockHistoryCache[cacheKey] = data;
      }
      if (origCallback) origCallback(data);
    };

    // 计算日期范围
    var now = new Date();
    var start = new Date(now);
    start.setMonth(start.getMonth() - 6);
    var fmtDate = function(d) {
      return d.getFullYear() + '-' +
        String(d.getMonth()+1).padStart(2,'0') + '-' +
        String(d.getDate()).padStart(2,'0');
    };

    // 腾讯K线API（支持CORS，返回JSON）
    var url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" +
      tc + ",day," + fmtDate(start) + "," + fmtDate(now) + ",120,qfq";

    console.log('[走势图] 请求腾讯API: ' + code);

    // fetch 超时保护（10秒），防止 PWA/SW 环境中请求挂起
    var controller = new AbortController();
    var fetchTimeoutId = setTimeout(function() { controller.abort(); }, 10000);

    fetch(url, { signal: controller.signal })
      .then(function(res) {
        clearTimeout(fetchTimeoutId);
        return res.json();
      })
      .then(function(data) {
        var klines = [];
        try {
          var stockData = data && data.data && data.data[tc];
          if (!stockData) { throw new Error("no data for " + tc); }
          var rawLines = stockData.qfqday || stockData.day || [];
          klines = rawLines.map(function(arr) {
            return {
              date: arr[0], open: parseFloat(arr[1]), close: parseFloat(arr[2]),
              high: parseFloat(arr[3]), low: parseFloat(arr[4]), volume: parseFloat(arr[5])
            };
          }).filter(function(k) { return !isNaN(k.close); });

          if (klines.length > 0) {
            try { localStorage.setItem("fm_stock_hist_" + code, JSON.stringify({ t: Date.now(), d: klines })); } catch(e) {}
          }
        } catch(e) { console.error('[走势图] 腾讯解析失败:', e.message); }
        console.log('[走势图] 腾讯 ' + code + ': ' + klines.length + ' 条');

        if (klines.length >= 5) {
          if (callback) callback(klines);
        } else {
          // 腾讯数据不足 → 优先使用内联历史数据(js/history-data.js)
          var inlineData = self._getInlineHistory(code);
          if (inlineData && inlineData.length >= 5) {
            console.log('[走势图] ' + code + ' 使用内联历史数据: ' + inlineData.length + '条');
            if (callback) callback(inlineData);
          } else {
            console.warn('[走势图] ' + code + ' 无任何历史数据可用');
            if (callback) callback(null);
          }
        }
      })
      .catch(function(err) {
        clearTimeout(fetchTimeoutId);
        console.warn('[走势图] 腾讯API请求失败(' + code + '):', err.message);
        // 网络错误 → 使用内联历史数据
        var inlineData = self._getInlineHistory(code);
        if (inlineData && inlineData.length >= 5) {
          console.log('[走势图] API失败, 使用 ' + code + ' 内联历史数据: ' + inlineData.length + '条');
          if (callback) callback(inlineData);
        } else {
          console.warn('[走势图] ' + code + ' 无任何历史数据可用');
          if (callback) callback(null);
        }
      });
  },

  // 从 window.STOCK_HISTORY_DATA 中按代码取数据（取代 fetch 静态文件）
  _getInlineHistory(code) {
    try {
      var data = window.STOCK_HISTORY_DATA;
      if (data && data[code] && data[code].length > 0) {
        return data[code];
      }
    } catch(e) {
      console.warn('[走势图] _getInlineHistory 异常:', e.message);
    }
    return null;
  },

  // 渲染所有股票的走势图（在每个股票卡片内）
  renderStockCharts() {
    var self = this;
    var stocks = Storage.get(Storage.keys.stocks) || [];

    // 合并 RSU 列表中的股票（按 code 去重）
    var rsuList = Storage.get(Storage.keys.rsu) || [];
    var codeMap = {};
    stocks.forEach(function(s) { if (s.code) codeMap[s.code] = s; });
    rsuList.forEach(function(r) {
      if (r.code && !codeMap[r.code]) {
        codeMap[r.code] = { code: r.code, name: r.name, currentPrice: r.currentPrice, currency: r.currency, market: r.market || "CN" };
      }
    });
    var allStocks = Object.values(codeMap);

    allStocks.forEach(function(item) {
      var canvasId = "stockChartCanvas_" + item.code;

      // 超时保护：12秒后强制隐藏 loading，防止 fetch 挂起导致永久"加载中"
      var timeoutId = setTimeout(function() {
        var loadingEl = document.getElementById(canvasId + "_loading");
        if (loadingEl) loadingEl.style.display = "none";
        var errEl = document.getElementById(canvasId + "_error");
        if (errEl) errEl.style.display = "block";
        console.warn('[走势图] ' + item.code + ' 数据加载超时(12s)');
      }, 12000);

      // 异步获取数据并绘图
      self.fetchStockHistoryData(item.code, item.market || "", function(data) {
        clearTimeout(timeoutId);
        var loadingEl = document.getElementById(canvasId + "_loading");
        if (loadingEl) loadingEl.style.display = "none";
        if (!data || data.length < 5) {
          var errEl = document.getElementById(canvasId + "_error");
          if (errEl) errEl.style.display = "block";
          return;
        }
        self._drawChart(canvasId, data, item.code, item.currency);
      });
    });
  },

  // 绘制单只股票的面积曲线图（Canvas 2D）
  _drawChart(canvasId, data, code, currency) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    // 数据不足时不绘制
    if (!data || data.length < 2) {
      console.warn('[图表] 数据不足，跳过绘制');
      return;
    }

    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    var W = rect.width;
    var H = rect.height || 200;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    var padLeft = 8, padRight = 50, padTop = 12, padBottom = 24;
    var chartW = W - padLeft - padRight;
    var chartH = H - padTop - padBottom;

    if (chartW <= 0 || chartH <= 0) return;

    // 计算价格范围
    var prices = data.map(function(d) { return d.close; });
    var minP = Math.min.apply(null, prices.concat(data.map(function(d){return d.low;})));
    var maxP = Math.max.apply(null, prices.concat(data.map(function(d){return d.high;})));
    var range = maxP - minP || 1;
    minP -= range * 0.08;
    maxP += range * 0.08;
    range = maxP - minP;

    // 涨跌幅
    var firstPrice = data[0].close;
    var lastPrice = data[data.length - 1].close;
    var changePct = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
    var isUp = lastPrice >= firstPrice;

    // 更新涨跌幅文字
    var changeEl = document.getElementById(canvasId + "_change");
    if (changeEl) {
      changeEl.textContent = (isUp ? "+" : "") + changePct + "%";
      changeEl.className = "stock-chart-change-inline " + (isUp ? "up" : "down");
    }

    // 颜色：中国股市惯例——涨红跌绿
    var lineColor = isUp ? "#ef4444" : "#22c55e";
    var fillTop = isUp ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)";
    var fillBottom = isUp ? "rgba(239,68,68,0.02)" : "rgba(34,197,94,0.02)";

    // 清空画布
    ctx.clearRect(0, 0, W, H);

    // 绘制网格线（水平）
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    var gridLines = 4;
    for (var i = 0; i <= gridLines; i++) {
      var y = padTop + (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(W - padRight, y);
      ctx.stroke();
    }

    // 绘制Y轴价格标签
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var j = 0; j <= gridLines; j++) {
      var py = padTop + (chartH / gridLines) * j;
      var pVal = maxP - (range / gridLines) * j;
      var label = pVal >= 100 ? pVal.toFixed(0) : (pVal >= 10 ? pVal.toFixed(1) : pVal.toFixed(2));
      ctx.fillText(label, W - 6, py);
    }

    // 绘制X轴日期标签（避免右下角重叠）
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // 根据图表宽度动态计算标签数量，保证每个标签至少 50px 间距
    var minLabelGap = 50;
    var xLabelCount = Math.max(3, Math.min(6, Math.floor(chartW / minLabelGap)));
    xLabelCount = Math.min(xLabelCount, data.length);
    var xStep = data.length > 1 ? Math.floor((data.length - 1) / (xLabelCount - 1)) : 1;
    for (var k = 0; k < xLabelCount; k++) {
      var idx = (k === xLabelCount - 1) ? (data.length - 1) : Math.min(k * xStep, data.length - 1);
      var px = padLeft + (idx / (data.length - 1)) * chartW;
      // 确保最右侧标签不溢出绘图区域
      if (px > W - padRight - 20) px = W - padRight - 20;
      var dateStr = data[idx].date;
      var monthStr = dateStr.substring(5);  // MM-dd
      ctx.fillText(monthStr, px, H - padBottom + 6);
    }

    // 构建路径点
    var points = [];
    for (var n = 0; n < data.length; n++) {
      var cx = padLeft + (n / (data.length - 1)) * chartW;
      var cy = padTop + ((maxP - data[n].close) / range) * chartH;
      points.push({ x: cx, y: cy });
    }

    // 绘制面积填充
    ctx.beginPath();
    ctx.moveTo(points[0].x, padTop + chartH);
    for (var a = 0; a < points.length; a++) {
      ctx.lineTo(points[a].x, points[a].y);
    }
    ctx.lineTo(points[points.length - 1].x, padTop + chartH);
    ctx.closePath();

    var gradient = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    gradient.addColorStop(0, fillTop);
    gradient.addColorStop(1, fillBottom);
    ctx.fillStyle = gradient;
    ctx.fill();

    // 绘制折线
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var b = 1; b < points.length; b++) {
      ctx.lineTo(points[b].x, points[b].y);
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // 绘制最后一个点的高亮点
    var lastPt = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  },

  // HTML转义
  _escHtml(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },

  setupNavigation() {
    try {
      document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => { this.navigateTo(item.dataset.page); this.closeSidebar(); });
      });
      document.querySelectorAll(".bottom-nav-item").forEach(item => {
        item.addEventListener("click", () => this.navigateTo(item.dataset.page));
      });
      var menuBtn = document.getElementById("menuBtn"); if (menuBtn) menuBtn.addEventListener("click", () => this.openSidebar());
      var overlay = document.getElementById("sidebarOverlay"); if (overlay) overlay.addEventListener("click", () => this.closeSidebar());
      // 返回按钮：回到 Dashboard
      var homeBtn = document.getElementById("homeBtn"); if (homeBtn) homeBtn.addEventListener("click", () => this.navigateTo("dashboard"));
      // 侧边栏固定/取消固定
      var pinBtn = document.getElementById("sidebarPinBtn");
      if (pinBtn) {
        pinBtn.addEventListener("click", () => this.toggleSidebarPin());
        // 初始化：默认不固定（移动端体验更好）
        this._sidebarPinned = false;
        this._updatePinBtnStyle();
      }
      console.log('[App] setupNavigation 完成');
    } catch(e) {
      console.error('[App] setupNavigation 异常:', e);
    }
  },

  openSidebar() {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebarOverlay").classList.add("show");
  },

  closeSidebar() {
    // 固定模式下不关闭
    if (this._sidebarPinned) return;
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarOverlay").classList.remove("show");
  },

  toggleSidebarPin() {
    this._sidebarPinned = !this._sidebarPinned;
    var sidebar = document.getElementById("sidebar");
    var overlay = document.getElementById("sidebarOverlay");
    if (this._sidebarPinned) {
      sidebar.classList.add("pinned", "open");
      overlay.classList.remove("show");
    } else {
      sidebar.classList.remove("pinned", "open");
    }
    this._updatePinBtnStyle();
  },

  _updatePinBtnStyle() {
    var pinBtn = document.getElementById("sidebarPinBtn");
    if (!pinBtn) return;
    if (this._sidebarPinned) {
      pinBtn.style.color = "var(--accent)";
      pinBtn.title = "取消固定侧边栏";
    } else {
      pinBtn.style.color = "";
      pinBtn.title = "固定侧边栏";
    }
  },

  navigateTo(page) {
    this.currentPage = page;
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const target = document.getElementById("page-" + page);
    if (target) target.classList.add("active");
    document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.page === page));
    document.querySelectorAll(".bottom-nav-item").forEach(item => item.classList.toggle("active", item.dataset.page === page));
    const titles = { dashboard:"家庭资产管理", transactions:"现金资产", insurance:"保险管理", stocks:"股票管理", funds:"基金管理", loan:"房贷追踪", annuity:"年金管理", retirement:"退休计算", alerts:"通知管理", settings:"设置与数据同步" };
    document.getElementById("headerTitle").textContent = titles[page] || "家庭资产管理";
    // 非 Dashboard 页面显示返回按钮
    var homeBtn = document.getElementById("homeBtn");
    if (homeBtn) homeBtn.style.display = page === "dashboard" ? "none" : "flex";
    this.loadPageData(page);
  },

  loadPageData(page) {
    const f = { dashboard:()=>this.loadDashboard(), transactions:()=>this.loadTransactions(), insurance:()=>{ this.autoRefreshDates(); this.loadInsuranceList(); }, stocks:()=>{ this.loadStockList(); this.loadRsuList(); }, funds:()=>this.loadFundList(), loan:()=>this.loadLoanList(), annuity:()=>this.loadAnnuityList(), retirement:()=>this.loadRetirementPage(), alerts:()=>this.loadAlertsPage(), settings:()=>this.onSettingsPageShow() };
    if (f[page]) f[page]();
  },

  onSettingsPageShow() {
    // 如果之前没有待验证的注册流程，重置验证码输入框状态
    if (!Storage._pendingVerifyOtp) {
      var verifyCodeGroup = document.getElementById('cloudVerifyCodeGroup');
      var verifyBtn = document.getElementById('cloudVerifyBtn');
      var registerBtn = document.getElementById('cloudRegisterBtn');
      var loginBtn = document.getElementById('cloudLoginBtn');
      var verificationCodeInput = document.getElementById('cloudVerificationCode');
      if (verifyCodeGroup) verifyCodeGroup.style.display = 'none';
      if (verifyBtn) verifyBtn.style.display = 'none';
      if (registerBtn) registerBtn.style.display = 'inline-flex';
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (verificationCodeInput) verificationCodeInput.value = '';
    }
  },

  // 静默自动刷新过期缴费日期
  autoRefreshDates() {
    var list = Storage.get(Storage.keys.insurance);
    if (list.length === 0) return;
    var self = this;
    var updated = 0;
    list.forEach(function(item) {
      var newDate = self.adjustNextPayDate(item);
      if (newDate !== item.nextPayDate) {
        Storage.update(Storage.keys.insurance, item.id, { nextPayDate: newDate });
        updated++;
      }
    });
    if (updated > 0) console.log('[日期刷新] 自动调整了 ' + updated + ' 条保单的缴费日期');
  },

  setupTransactionTabs() {
    var self = this;
    var tabs = document.querySelectorAll(".tx-tab");
    tabs.forEach(function(tab) {
      tab.addEventListener("click", function() {
        tabs.forEach(function(t) { t.classList.remove("active"); t.style.background = "transparent"; t.style.color = "var(--text-secondary)"; });
        tab.classList.add("active");
        tab.style.background = "var(--accent)";
        tab.style.color = "var(--text-inverse)";
        var tabType = tab.getAttribute("data-tab");
        var container = document.getElementById("transactionList");
        if (container) container.setAttribute("data-tab", tabType);
        self.loadTransactions();
      });
    });
    // 初始化第一个 tab 样式
    var firstTab = document.querySelector(".tx-tab.active");
    if (firstTab) { firstTab.style.background = "var(--accent)"; firstTab.style.color = "var(--text-inverse)"; }
  },

  setupForms() {
    try {
      var el;
      el = document.getElementById("addIncomeBtn"); if (el) el.addEventListener("click", () => document.getElementById("incomeFormModal").classList.add("show"));
      el = document.getElementById("cancelIncomeBtn"); if (el) el.addEventListener("click", () => document.getElementById("incomeFormModal").classList.remove("show"));
      el = document.getElementById("incomeForm"); if (el) el.addEventListener("submit", e => { e.preventDefault(); this.saveIncome(); });
      el = document.getElementById("addExpenseBtn"); if (el) el.addEventListener("click", () => document.getElementById("expenseFormModal").classList.add("show"));
      el = document.getElementById("cancelExpenseBtn"); if (el) el.addEventListener("click", () => document.getElementById("expenseFormModal").classList.remove("show"));
      el = document.getElementById("expenseForm"); if (el) el.addEventListener("submit", e => { e.preventDefault(); this.saveExpense(); });

      // 收支记录 Tab 切换
      this.setupTransactionTabs();

      el = document.getElementById("addInsuranceBtn"); if (el) el.addEventListener("click", () => document.getElementById("insuranceFormModal").classList.add("show"));
      el = document.getElementById("cancelInsuranceBtn"); if (el) el.addEventListener("click", () => document.getElementById("insuranceFormModal").classList.remove("show"));
      el = document.getElementById("insuranceForm"); if (el) el.addEventListener("submit", e => { e.preventDefault(); this.saveInsurance(); });
      el = document.getElementById("refreshInsuranceBtn"); if (el) el.addEventListener("click", () => this.refreshInsuranceDates());
      el = document.getElementById("addStockBtn"); if (el) el.addEventListener("click", () => document.getElementById("stockFormModal").classList.add("show"));
      el = document.getElementById("cancelStockBtn"); if (el) el.addEventListener("click", () => document.getElementById("stockFormModal").classList.remove("show"));
      el = document.getElementById("stockForm"); if (el) el.addEventListener("submit", e => { e.preventDefault(); this.saveStock(); });
      el = document.getElementById("refreshStockPriceBtn"); if (el) el.addEventListener("click", () => this.refreshStockPrices());
      // 基金管理
      el = document.getElementById("addFundBtn"); if (el) el.addEventListener("click", () => document.getElementById("fundFormModal").classList.add("show"));
      el = document.getElementById("cancelFundBtn"); if (el) el.addEventListener("click", () => document.getElementById("fundFormModal").classList.remove("show"));
      el = document.getElementById("fundForm"); if (el) el.addEventListener("submit", e => { e.preventDefault(); this.saveFund(); });
      el = document.getElementById("refreshFundPriceBtn"); if (el) el.addEventListener("click", () => this.refreshStockPrices());
      el = document.getElementById("addLoanBtn"); if (el) el.addEventListener("click", () => document.getElementById("loanFormModal").classList.add("show"));
      el = document.getElementById("cancelLoanBtn"); if (el) el.addEventListener("click", () => document.getElementById("loanFormModal").classList.remove("show"));
      el = document.getElementById("loanForm"); if (el) el.addEventListener("submit", e => { e.preventDefault(); this.saveLoan(); });
      // 年金管理
      console.log('[App] setupForms 完成');
    } catch(e) {
      console.error('[App] setupForms 异常:', e);
    }

    // 余额编辑弹窗事件
    this.setupEditBalance();

    // 添加现金账户弹窗事件
    this.setupAddCashAccount();

    // CSV 导入（独立于 try-catch，避免影响其他表单）
    this.setupCSVImport();
  },

  setTodayDates() {
    const today = new Date().toISOString().split("T")[0];
    ["incomeDate","expenseDate","insuranceNextPay","loanStartDate"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = today;
    });
  },

  loadDashboard() {
    try {
      // 确保现金账户已初始化，避免首次加载时总资产计算缺少现金
      var cashAccounts = Storage.get(Storage.keys.cashAccounts);
      if (!cashAccounts || cashAccounts.length === 0) {
        this.initDefaultCashAccounts();
      }

      var totalAsset = Storage.calcTotalAssets();
      var totalDebt = Storage.calcTotalDebts();
      var netWorth = Storage.calcNetWorth();
      var el;
      el = document.getElementById("totalAsset"); if (el) el.textContent = this.formatMoney(totalAsset);
      el = document.getElementById("totalDebt"); if (el) el.textContent = this.formatMoney(totalDebt);
      el = document.getElementById("netWorth"); if (el) el.textContent = this.formatMoney(netWorth);
      el = document.getElementById("updateTime"); if (el) el.textContent = "更新于 " + new Date().toLocaleTimeString("zh-CN");

      // 保险三栏：资产沉淀 / 或有赔付 / 未来保费
      var insSettled = Storage.calcInsuranceSettledValue();
      var insContAsset = Storage.calcInsuranceContingentAsset();
      var insContLiab = Storage.calcInsuranceContingentLiability();
      el = document.getElementById("insuranceSettled"); if (el) el.textContent = this.formatMoney(insSettled);
      el = document.getElementById("insuranceContingentAsset"); if (el) el.textContent = this.formatMoney(insContAsset);
      el = document.getElementById("insuranceFuturePremium"); if (el) el.textContent = this.formatMoney(insContLiab);

      this.renderDashboardGrid();
      this.checkNotifications();
      this.renderAssetTrend();   // 6 个月净资产变化曲线（异步加载历史价）
      this._saveDailySnapshot();  // 每天第一次打开时保存快照
      this.renderDailyChangeBrief(); // 净资产简报（基于快照）
    } catch(e) {
      console.error('[App] loadDashboard 异常:', e);
    }
  },

  // 子项汇总卡片 — 点击可跳转
  renderDashboardGrid() {
    var self = this;
    var grid = document.getElementById("dashboardGrid");
    if (!grid) return;

    // 股票
    var stocks = Storage.get(Storage.keys.stocks);
    var stockValue = 0, stockCount = stocks.length;
    stocks.forEach(function(s) {
      var shares = parseInt(s.shares) || 0;
      var price = parseFloat(s.currentPrice) || parseFloat(s.cost) || 0;
      stockValue += self.toCNY(shares * price, s.currency || "CNY");
    });

    // 基金
    var funds = Storage.get(Storage.keys.funds);
    var fundValue = 0, fundCount = funds.length;
    funds.forEach(function(f) { fundValue += parseFloat(f.holdValue) || 0; });

    // 保险（累计已缴总额，与"保险缴费进度图"汇总条同口径）
    var insurance = Storage.get(Storage.keys.insurance);
    var insurCount = insurance.length;
    var insurAnnual = this.calcInsurancePaidTotal();

    // 房贷
    var loans = Storage.get(Storage.keys.loans);
    var loanBalance = 0, loanCount = loans.length;
    loans.forEach(function(l) {
      var b = parseFloat(l.balance);
      if (b >= 0) { loanBalance += b; }
      else { loanBalance += Math.max(0, (parseFloat(l.total)||0)-(parseFloat(l.paid)||0)); }
    });

    // 年金
    var annuityList = Storage.get(Storage.keys.annuities);
    var annuityTotal = 0, annuityCount = annuityList.length;
    annuityList.forEach(function(a) { annuityTotal += parseFloat(a.balance) || 0; });

    // 现金资产
    var cashAccounts = Storage.get(Storage.keys.cashAccounts);
    var cashTotal = Storage.calcCashTotal();
    var cashAccountCount = cashAccounts.length;

    var cards = [
      { id:"dash-cash", icon:"transactions", label:"现金资产", value:cashTotal, sub:cashAccountCount + " 个账户", target:"transactions", cls:"dash-card-cash" },
      { id:"dash-stocks", icon:"stocks", label:"股票持仓", value:stockValue, sub:stockCount + " 只", target:"stocks", cls:"dash-card-stocks" },
      { id:"dash-funds", icon:"funds", label:"基金理财", value:fundValue, sub:fundCount + " 只", target:"funds", cls:"dash-card-funds" },
      { id:"dash-insurance", icon:"insurance", label:"保险保障", value:insurAnnual, sub:insurCount + " 份 · 已缴", target:"insurance", cls:"dash-card-insurance" },
      { id:"dash-loan", icon:"loan", label:"房贷负债", value:loanBalance, sub:loanCount + " 笔 · 剩余", target:"loan", cls:"dash-card-loan" },
      { id:"dash-annuity", icon:"annuity", label:"企业年金", value:annuityTotal, sub:annuityCount + " 个组合", target:"annuity", cls:"dash-card-annuity" }
    ];

    var html = "";
    cards.forEach(function(c) {
      html += '<div class="dash-card ' + c.cls + '" onclick="App.navigateTo(\'' + c.target + '\')">' +
        '<div class="dash-card-icon">' + self.icon(c.icon, '') + '</div>' +
        '<div class="dash-card-body">' +
          '<div class="dash-card-label">' + c.label + '</div>' +
          '<div class="dash-card-value">' + self.formatMoney(c.value) + '</div>' +
          '<div class="dash-card-sub">' + c.sub + '</div>' +
        '</div>' +
        '<div class="dash-card-arrow"><svg class="icon icon-muted"><use href="#icon-chevron-right"/></svg></div>' +
      '</div>';
    });
    grid.innerHTML = html;
  },

  // ===== 6 个月资产变化曲线（净资产）=====
  // 算法：
  //   - 每周五一个数据点 + 今天（共 27 个点）
  //   - 每个点: 算法推算"该日"的总资产/总负债 → 与今天的差值
  //   - 净资产 = 今天真实净资产 + (历史总资产 - 今天总资产) - (历史总负债 - 今天总负债)
  //   - 这样曲线锚定在今天的真实净资产上，反映历史相对变化
  renderAssetTrend() {
    var self = this;
    var section = document.getElementById("assetTrendSection");
    var chartEl = document.getElementById("assetTrendChart");
    var rangeEl = document.getElementById("assetTrendRange");
    if (!section || !chartEl) return;

    // 今天真实净资产
    var todayNetWorth = Storage.calcNetWorth();
    var todayAssets = Storage.calcTotalAssets();
    var todayDebts  = Storage.calcTotalDebts();

    // 计算锚定日期（6 个月前），取今天的 6 个月前
    var today = new Date();
    var sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // 收集每周五 + 今天
    var points = this._collectFridayPoints(sixMonthsAgo, today);
    points.push(new Date(today));
    // 去重
    var seen = {};
    var uniquePoints = [];
    points.forEach(function(d) {
      var key = d.toISOString().slice(0, 10);
      if (!seen[key]) { seen[key] = true; uniquePoints.push(d); }
    });
    points = uniquePoints;

    // 加载历史数据
    this._loadAllHistoryData(function(historyData) {
      // 今天的日期串（YYYY-MM-DD）
      var todayKey = new Date().toISOString().slice(0, 10);
      // 计算每个点的净资产
      var data = points.map(function(d) {
        var targetKey = d.toISOString().slice(0, 10);
        var assets, debts, netWorth;
        if (targetKey === todayKey) {
          // 今天那一点：直接用真实净资产（与卡片 100% 一致）
          netWorth = todayNetWorth;
        } else {
          // 历史点：今天真实值 + 历史相对今天的差额
          assets = self._estimateAssetsAt(d, historyData);
          debts  = self._estimateDebtsAt(d);
          netWorth = todayNetWorth + (assets - todayAssets) - (debts - todayDebts);
        }
        return { date: d, netWorth: netWorth };
      });

      // 渲染
      self._drawAssetTrendChart(chartEl, rangeEl, data, todayNetWorth);
    });
  },

  // ===== 每日快照 =====
  // 每天第一次打开应用时保存资产快照（北京时间当天首次）
  // 快照存在 localStorage.fm_snapshots，格式：{ "YYYY-MM-DD": { timestamp, netWorth, categories: {...} } }
  _saveDailySnapshot() {
    var self = this;
    var now = new Date();
    // 北京时间 = UTC+8
    var bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
    var bjDateStr = bjNow.getUTCFullYear() + '-' + String(bjNow.getUTCMonth()+1).padStart(2,'0') + '-' + String(bjNow.getUTCDate()).padStart(2,'0');

    var snapshots = {};
    try { snapshots = JSON.parse(localStorage.getItem('fm_snapshots')) || {}; } catch(e) {}

    // 今天已保存过则跳过
    if (snapshots[bjDateStr]) return;

    // 计算当前各分类价值
    var categories = { stocks: 0, funds: 0, rsu: 0, annuity: 0, insurance: 0, cash: 0 };

    var stocks = Storage.get(Storage.keys.stocks) || [];
    stocks.forEach(function(s) {
      var shares = parseInt(s.shares) || 0;
      var price = parseFloat(s.currentPrice) || parseFloat(s.cost) || 0;
      categories.stocks += self.toCNY(shares * price, s.currency || "CNY");
    });

    var funds = Storage.get(Storage.keys.funds) || [];
    funds.forEach(function(f) { categories.funds += parseFloat(f.holdValue) || 0; });

    var rsuList = Storage.get(Storage.keys.rsu) || [];
    rsuList.forEach(function(r) {
      var vested = parseInt(r.vested) || 0;
      var price = parseFloat(r.currentPrice) || parseFloat(r.grantPrice) || 0;
      categories.rsu += vested * price;
    });

    var annuities = Storage.get(Storage.keys.annuities) || [];
    annuities.forEach(function(a) { categories.annuity += parseFloat(a.balance) || 0; });

    categories.insurance = Storage.calcInsuranceSettledValue();
    categories.cash = Storage.calcCashTotal();

    var totalAssets = Storage.calcTotalAssets();
    var totalDebts = Storage.calcTotalDebts();
    var netWorth = totalAssets - totalDebts;

    snapshots[bjDateStr] = {
      timestamp: now.getTime(),
      bjDateStr: bjDateStr,
      totalAssets: totalAssets,
      totalDebts: totalDebts,
      netWorth: netWorth,
      categories: categories
    };

    // 只保留最近 90 天快照
    var keys = Object.keys(snapshots).sort();
    if (keys.length > 90) {
      delete snapshots[keys[0]];
    }

    try { localStorage.setItem('fm_snapshots', JSON.stringify(snapshots)); } catch(e) {}
    console.log('[快照] 已保存 ' + bjDateStr + ' 净资产 ' + netWorth);
  },

  // 查找距离 targetDate 最近的一个历史收盘价
  _findClosestClose(arr, targetDate) {
    if (!arr || arr.length === 0) return 0;
    var targetStr = targetDate.toISOString().slice(0, 10);
    // 精确匹配
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].date === targetStr) return arr[i].close;
    }
    // 找最近的一条（向前找）
    var closest = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].date <= targetStr) {
        closest = arr[i];
      } else {
        break;
      }
    }
    return closest ? closest.close : (arr.length > 0 ? arr[arr.length-1].close : 0);
  },

  // ===== 净资产简报 =====
  // 找到上一个有资产变化意义的日期（默认昨天；若昨天是周末则回退到上周五）
  _getPreviousAssetDate() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    // 跳过周末（周六=6, 周日=0），因为股票/基金价格在周末无变化
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    return d;
  },

  // 估算指定日期各资产分类的价值（用于上一日变化简报）
  // 返回 { stocks, funds, rsu, annuity, insurance, cash, totalAssets, totalDebts }
  _estimateCategoryValuesAt(targetDate, historyData) {
    var self = this;
    var result = { stocks: 0, funds: 0, rsu: 0, annuity: 0, insurance: 0, cash: 0, totalAssets: 0, totalDebts: 0 };

    // 1. 股票
    var stocks = Storage.get(Storage.keys.stocks) || [];
    stocks.forEach(function(s) {
      var shares = parseInt(s.shares) || 0;
      if (shares <= 0) return;
      var currency = s.currency || "CNY";
      var price = 0;
      if (historyData && historyData[s.code]) {
        price = self._findClosestClose(historyData[s.code], targetDate);
      }
      if (!price) price = parseFloat(s.currentPrice) || parseFloat(s.cost) || 0;
      result.stocks += self.toCNY(shares * price, currency);
    });

    // 2. RSU：已解禁部分
    var rsuList = Storage.get(Storage.keys.rsu) || [];
    rsuList.forEach(function(r) {
      var vested = parseInt(r.vested) || 0;
      if (vested > 0) {
        var price = 0;
        if (historyData && historyData[r.code]) {
          price = self._findClosestClose(historyData[r.code], targetDate);
        }
        if (!price) price = parseFloat(r.currentPrice) || parseFloat(r.grantPrice) || 0;
        result.rsu += vested * price;
      }
    });

    // 3. 基金（复用母基金映射逻辑）
    var parentMap = { "013126": "515170", "001513": "510500" };
    var funds = Storage.get(Storage.keys.funds) || [];
    funds.forEach(function(f) {
      var priceCode = f.parentCode || parentMap[f.code] || f.code;
      var currentNav = parseFloat(f.nav) || 0;
      var shares = parseFloat(f.shares) || 0;
      if (historyData && historyData[priceCode] && shares > 0 && currentNav > 0) {
        var etfArr = historyData[priceCode];
        var currentEtf = etfArr.length > 0 ? etfArr[etfArr.length - 1].close : 0;
        var histEtf = self._findClosestClose(etfArr, targetDate) || currentEtf;
        if (currentEtf > 0) {
          var estNav = currentNav * (histEtf / currentEtf);
          result.funds += shares * estNav;
        } else {
          result.funds += parseFloat(f.holdValue) || 0;
        }
      } else {
        result.funds += parseFloat(f.holdValue) || 0;
      }
    });

    // 4. 年金（按当前值常量）
    var annuities = Storage.get(Storage.keys.annuities) || [];
    annuities.forEach(function(a) { result.annuity += parseFloat(a.balance) || 0; });

    // 5. 保险沉淀资产
    result.insurance = Storage.calcInsuranceSettledValueAt(targetDate);

    // 6. 现金资产（快照，无历史波动）
    var cashAccounts = Storage.get(Storage.keys.cashAccounts) || [];
    cashAccounts.forEach(function(a) { result.cash += parseFloat(a.balance) || 0; });

    // 7. 总负债
    result.totalDebts = self._estimateDebtsAt(targetDate);

    result.totalAssets = result.stocks + result.funds + result.rsu + result.annuity + result.insurance + result.cash;
    return result;
  },

  // 渲染净资产简报（基于每日快照，对比间隔≥24小时的两个快照）
  renderDailyChangeBrief() {
    var self = this;
    var section = document.getElementById("dailyChangeSection");
    var summaryEl = document.getElementById("dailyChangeSummary");
    var listEl = document.getElementById("dailyChangeList");
    var dateEl = document.getElementById("dailyChangeDate");
    if (!section || !summaryEl || !listEl) return;

    // 确保今天快照已保存（幂等，已保存则跳过）
    this._saveDailySnapshot();

    // 读取所有快照
    var snapshots = {};
    try { snapshots = JSON.parse(localStorage.getItem('fm_snapshots')) || {}; } catch(e) {}
    var snapshotKeys = Object.keys(snapshots).sort(); // 按日期升序

    if (snapshotKeys.length === 0) {
      listEl.innerHTML = '<div class="daily-change-empty">暂无快照数据，请明天再来查看简报</div>';
      summaryEl.innerHTML = '';
      if (dateEl) dateEl.textContent = '';
      return;
    }

    // 找到今天（北京时间）的快照
    var now = new Date();
    var bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
    var todayStr = bjNow.getUTCFullYear() + '-' + String(bjNow.getUTCMonth()+1).padStart(2,'0') + '-' + String(bjNow.getUTCDate()).padStart(2,'0');
    var todaySnap = snapshots[todayStr] || null;

    // 如果没有今天的快照（极端情况），用最新快照代替
    if (!todaySnap && snapshotKeys.length > 0) {
      todaySnap = snapshots[snapshotKeys[snapshotKeys.length - 1]];
    }

    // 找间隔≥24小时的最近一个快照
    var prevSnap = null;
    var twentyFourHours = 24 * 3600 * 1000;
    for (var i = snapshotKeys.length - 2; i >= 0; i--) {
      var key = snapshotKeys[i];
      var snap = snapshots[key];
      if (snap && todaySnap && (todaySnap.timestamp - snap.timestamp >= twentyFourHours)) {
        prevSnap = snap;
        break;
      }
    }

    if (!prevSnap) {
      listEl.innerHTML = '<div class="daily-change-empty">暂无超过24小时的快照数据<br>请超过24小时后再查看简报</div>';
      summaryEl.innerHTML = '';
      if (dateEl) dateEl.textContent = '';
      return;
    }

    // 计算间隔天数
    var daysDiff = Math.round((todaySnap.timestamp - prevSnap.timestamp) / (24 * 3600 * 1000));
    var daysLabel = daysDiff <= 1 ? '1天' : daysDiff + '天';

    var todayNet = todaySnap.netWorth;
    var prevNet = prevSnap.netWorth;
    var netChange = todayNet - prevNet;

    // 汇总区
    var netClass = netChange >= 0 ? "trend-up" : "trend-down";
    var netSign = netChange >= 0 ? "+" : "";
    summaryEl.innerHTML =
      '<div class="daily-change-total">' +
        '<div class="daily-change-total-label">' + daysLabel + '净资产变化</div>' +
        '<div class="daily-change-total-value ' + netClass + '">' + netSign + this.formatMoney(netChange) + '</div>' +
      '</div>' +
      '<div class="daily-change-sub">' +
        '<span>当前净资产 <b>' + this.formatMoney(todayNet) + '</b></span>' +
        '<span>' + daysLabel + '前 <b>' + this.formatMoney(prevNet) + '</b></span>' +
      '</div>';

    if (dateEl) {
      dateEl.textContent = todaySnap.bjDateStr + ' vs ' + prevSnap.bjDateStr;
    }

    // 明细条目
    var cats = ['stocks', 'funds', 'rsu', 'cash', 'insurance', 'annuity', 'debt'];
    var labels = { stocks: '股票持仓', funds: '基金理财', rsu: 'RSU 已解禁', cash: '现金资产', insurance: '保险沉淀', annuity: '企业年金', debt: '剩余房贷' };
    var icons = { stocks: 'stocks', funds: 'funds', rsu: 'trophy', cash: 'transactions', insurance: 'insurance', annuity: 'annuity', debt: 'loan' };

    var html = '';
    cats.forEach(function(key) {
      var todayVal = (todaySnap.categories && todaySnap.categories[key]) || 0;
      var prevVal = (prevSnap.categories && prevSnap.categories[key]) || 0;
      var change = key === 'debt' ? (prevVal - todayVal) : (todayVal - prevVal);
      var absChange = Math.abs(change);
      if (absChange < 0.01) return;

      var pct = prevVal > 0 ? (change / prevVal * 100) : 0;
      var changeClass = change >= 0 ? "trend-up" : "trend-down";
      var sign = change > 0 ? "+" : "";

      html += '<div class="daily-change-item">' +
        '<div class="daily-change-item-left">' +
          '<div class="daily-change-icon">' + self.icon(icons[key]) + '</div>' +
          '<div class="daily-change-info">' +
            '<div class="daily-change-name">' + labels[key] + '</div>' +
            '<div class="daily-change-sub">' + self.formatMoney(todayVal) + ' / ' + daysLabel + '前 ' + self.formatMoney(prevVal) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="daily-change-item-right">' +
          '<div class="daily-change-value ' + changeClass + '">' + sign + self.formatMoney(change) + '</div>' +
          '<div class="daily-change-pct ' + changeClass + '">(' + sign + pct.toFixed(2) + '%)</div>' +
        '</div>' +
      '</div>';
    });

    if (!html) {
      html = '<div class="daily-change-empty">各分类均无变化</div>';
    }

    listEl.innerHTML = html;
  },

  // 收集 start 到 end 之间的所有周五
  _collectFridayPoints(start, end) {
    var points = [];
    var d = new Date(start);
    // 找第一个 >= start 的周五
    while (d.getDay() !== 5) {
      d.setDate(d.getDate() + 1);
    }
    while (d <= end) {
      points.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }
    return points;
  },

  // 加载所有历史价（股票 + 基金母基金）
  // 返回 { code: [{date,close}, ...] }
  // 行为：不使用 localStorage 缓存, 每次都从 stock-history.json 拉取
  //       拉取后调用 _appendTodayIfMissing 补今天一条
  _loadAllHistoryData(callback) {
    var self = this;
    // 动态获取股票代码：从 localStorage 读取，兜底使用默认列表
    var stocks = Storage.get(Storage.keys.stocks);
    var codes = stocks.length > 0 ? stocks.map(function(s) { return s.code; }) : ['NIO', '00992', '515170'];
    // 同时纳入 RSU 代码
    var rsu = Storage.get(Storage.keys.rsu);
    rsu.forEach(function(r) { if (r.code && codes.indexOf(r.code) < 0) codes.push(r.code); });
    var historyData = {};

    fetch("data/stock-history.json")
      .then(function(res) { return res.json(); })
      .then(function(data) {
        codes.forEach(function(code) {
          if (data[code] && data[code].length > 0) {
            historyData[code] = data[code];
          }
        });
        // 诊断日志
        codes.forEach(function(code) {
          var arr = historyData[code];
          if (arr && arr.length > 0) {
            console.log('[资产曲线] ' + code + ' 数据 ' + arr.length + ' 条, 首 ' + arr[0].date + ' 末 ' + arr[arr.length-1].date);
          } else {
            console.warn('[资产曲线] ' + code + ' 无历史数据');
          }
        });
        self._appendTodayIfMissing(historyData);
        callback(historyData);
      })
      .catch(function(err) {
        console.warn('[资产曲线] 加载历史数据失败:', err.message);
        callback(historyData);
      });
  },

  // 每日自动补点：用 localStorage.stocks 里的最新股价，给 historyData 各 code 追加今天一条
  // - NIO/00992：直接用 localStorage.stocks[i].currentPrice
  // - 515170：复用 last known close（同日估值，误差 < 1%）
  // - 幂等：最后一条 date 已是今天则跳过
  _appendTodayIfMissing(historyData) {
    if (!historyData) return;
    var now = new Date();
    // 用本地时区拼出今天 YYYY-MM-DD
    var ty = now.getFullYear();
    var tm = String(now.getMonth() + 1).padStart(2, '0');
    var td = String(now.getDate()).padStart(2, '0');
    var todayKey = ty + '-' + tm + '-' + td;

    // 1. 股票：NIO、00992
    var stocks = Storage.get(Storage.keys.stocks) || [];
    stocks.forEach(function(s) {
      var code = s.code;
      if (!historyData[code]) return; // 不在曲线 3 标的里，跳过
      var arr = historyData[code];
      var last = arr[arr.length - 1];
      var lastDate = last ? last.date : '';
      if (lastDate === todayKey) return; // 已补过，幂等
      var price = parseFloat(s.currentPrice);
      if (!price || price <= 0) return;
      // 用本地日期拼一条
      arr.push({
        date: todayKey,
        open: price,
        close: price,
        high: price,
        low: price,
        volume: 0
      });
      // 已禁用 localStorage 持久化（用户要求完全不用缓存, 每次都 fetch 最新 json）
      // try {
      //   localStorage.setItem("fm_stock_hist_" + code, JSON.stringify({ t: Date.now(), d: arr }));
      // } catch(e) {}
      console.log('[资产曲线] 已自动追加 ' + code + ' ' + todayKey + ' close=' + price);
    });

    // 2. 母基金 515170：复用上一交易日 close
    var code = '515170';
    if (historyData[code]) {
      var arr = historyData[code];
      var last = arr[arr.length - 1];
      var lastDate = last ? last.date : '';
      if (lastDate !== todayKey) {
        var lastClose = last ? parseFloat(last.close) : 0;
        if (lastClose > 0) {
          arr.push({
            date: todayKey,
            open: lastClose,
            close: lastClose,
            high: lastClose,
            low: lastClose,
            volume: 0
          });
          // 已禁用 localStorage 持久化
          // try {
          //   localStorage.setItem("fm_stock_hist_" + code, JSON.stringify({ t: Date.now(), d: arr }));
          // } catch(e) {}
          console.log('[资产曲线] 已自动追加 515170 ' + todayKey + ' close=' + lastClose + ' (复用 last close)');
        }
      }
    }
  },

  // 估算某日的总资产（用历史价 + 当前持仓）
  _estimateAssetsAt(targetDate, historyData) {
    var self = this;
    var total = 0;

    // 1. 股票
    var stocks = Storage.get(Storage.keys.stocks) || [];
    stocks.forEach(function(s) {
      var shares = parseInt(s.shares) || 0;
      if (shares <= 0) return;
      var currency = s.currency || "CNY";
      var price = 0;
      // 找历史价
      if (historyData[s.code]) {
        price = self._findClosestClose(historyData[s.code], targetDate);
      }
      // 缺历史价 → 用当前价（保持常量）
      if (!price) price = parseFloat(s.currentPrice) || parseFloat(s.cost) || 0;
      total += self.toCNY(shares * price, currency);
    });

    // 2. RSU：已解禁部分计入
    var rsuList = Storage.get(Storage.keys.rsu) || [];
    rsuList.forEach(function(r) {
      var vested = parseInt(r.vested) || 0;
      if (vested > 0) {
        var price = parseFloat(r.currentPrice) || parseFloat(r.grantPrice) || 0;
        total += vested * price;
      }
    });

    // 3. 基金
    // 联接基金 → 母基金映射（用于历史价折算）
    var parentMap = {
      "013126": "515170",  // 华夏中证细分食品饮料产业主题ETF联接C → 食品饮料ETF华夏
      "001513": "510500",  // 示例：南方中证500ETF联接 → 中证500ETF（备用）
    };
    var funds = Storage.get(Storage.keys.funds) || [];
    funds.forEach(function(f) {
      // 优先用 parentCode（ETF 联接基金对应的母基金），否则用 code 自己
      var priceCode = f.parentCode || parentMap[f.code] || f.code;
      if (historyData[priceCode]) {
        // 用母基金价格折算联接基金 NAV
        var etfArr = historyData[priceCode];
        var currentNav = parseFloat(f.nav) || 0;
        var currentEtf = etfArr.length > 0 ? etfArr[etfArr.length - 1].close : 0;
        var histEtf = self._findClosestClose(etfArr, targetDate) || currentEtf;
        if (currentEtf > 0 && currentNav > 0) {
          var estNav = currentNav * (histEtf / currentEtf);
          var shares = parseFloat(f.shares) || 0;
          total += shares * estNav;
        } else {
          total += parseFloat(f.holdValue) || 0;
        }
      } else {
        // 无历史价 → 用当前 holdValue（保持常量）
        total += parseFloat(f.holdValue) || 0;
      }
    });

    // 4. 年金（按当前值常量）
    var annuities = Storage.get(Storage.keys.annuities) || [];
    annuities.forEach(function(a) { total += parseFloat(a.balance) || 0; });

    // 5. 保险沉淀资产（按 targetDate 累计已缴保费, 跟 nextPayDate 对齐）
    // 例如: nextPayDate=2026-XX, 则 2025 之前的点只累计到 2025 那一年的"已缴年数"
    total += Storage.calcInsuranceSettledValueAt(targetDate);

    // 6. 现金资产：作为稳定基底全额计入所有历史点
    //    现金余额是手动录入的快照，没有每日价格波动，
    //    全额计入可避免曲线因"今天才录入"而突然跳升
    var cashAccounts = Storage.get(Storage.keys.cashAccounts) || [];
    cashAccounts.forEach(function(a) {
      total += parseFloat(a.balance) || 0;
    });

    return total;
  },

  // 估算某日的总负债（房贷剩余本金之和）
  _estimateDebtsAt(targetDate) {
    var self = this;
    var loans = Storage.get(Storage.keys.loans) || [];
    var totalDebt = 0;
    // 取今天的日期串（按本地时区，YYYY-MM-DD）
    var todayKey = new Date().toISOString().slice(0, 10);
    var targetKey = (targetDate instanceof Date)
      ? targetDate.toISOString().slice(0, 10)
      : new Date(targetDate).toISOString().slice(0, 10);
    var isToday = (targetKey === todayKey);
    loans.forEach(function(l) {
      if (isToday) {
        // 今天：用用户手动维护的真实余额（与净资产卡片一致）
        totalDebt += parseFloat(l.balance) || 0;
      } else {
        // 历史点：用 calcLoanProgress 推算的剩余本金
        var prog = self.calcLoanProgress(l, new Date(targetDate));
        totalDebt += prog.remainingPrincipal || 0;
      }
    });
    return totalDebt;
  },

  // 在历史数组中找到 target_date 当天或之前最近一条
  _findClosestClose(arr, targetDate) {
    if (!arr || arr.length === 0) return 0;
    var target = targetDate.getFullYear() + '-' + String(targetDate.getMonth()+1).padStart(2,'0') + '-' + String(targetDate.getDate()).padStart(2,'0');
    var last = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].date <= target) last = arr[i];
      else break;
    }
    return last ? last.close : 0;
  },

  // 渲染折线图
  _drawAssetTrendChart(chartEl, rangeEl, data, todayNetWorth) {
    if (data.length === 0) {
      chartEl.innerHTML = '<div class="empty-tip">暂无数据</div>';
      if (rangeEl) rangeEl.textContent = "";
      return;
    }

    // 涨跌幅（与起点相比）— 现在挪到右上角
    var firstV = data[0].netWorth;
    var lastPt = data[data.length - 1];
    var change = lastPt.netWorth - firstV;
    var changePct = firstV > 0 ? (change / firstV * 100) : 0;
    var changeClass = change >= 0 ? "trend-up" : "trend-down";
    var changeSign = change >= 0 ? "+" : "";
    var changeText = changeSign + this.formatMoney(change) +
      ' (' + changeSign + changePct.toFixed(2) + '%)';
    if (rangeEl) rangeEl.textContent = changeText;
    if (rangeEl) rangeEl.className = 'asset-trend-change ' + changeClass;

    // 计算 Y 轴范围
    var values = data.map(function(d) { return d.netWorth; });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    var pad = (maxV - minV) * 0.15 || maxV * 0.05;
    minV -= pad;
    maxV += pad;
    if (maxV === minV) { maxV += 1; minV -= 1; }

    // SVG 尺寸
    var W = 680, H = 200;
    var padL = 56, padR = 16, padT = 16, padB = 28;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    // 缩放
    var xScale = function(i) { return padL + (i / (data.length - 1 || 1)) * plotW; };
    var yScale = function(v) { return padT + plotH - ((v - minV) / (maxV - minV)) * plotH; };

    // 构建 path
    var pathD = data.map(function(d, i) {
      return (i === 0 ? "M" : "L") + xScale(i).toFixed(1) + " " + yScale(d.netWorth).toFixed(1);
    }).join(" ");

    // 渐变区域
    var areaD = pathD +
      " L" + xScale(data.length - 1).toFixed(1) + " " + (padT + plotH).toFixed(1) +
      " L" + xScale(0).toFixed(1) + " " + (padT + plotH).toFixed(1) + " Z";

    // X 轴标签（每 4 个点显示一个）
    var xLabels = "";
    var step = Math.max(1, Math.floor(data.length / 6));
    data.forEach(function(d, i) {
      if (i % step === 0 || i === data.length - 1) {
        xLabels += '<text x="' + xScale(i).toFixed(1) + '" y="' + (padT + plotH + 18) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + d.date.toISOString().slice(5, 10) + '</text>';
      }
    });

    // Y 轴标签（4 个刻度）
    var yLabels = "";
    for (var k = 0; k <= 4; k++) {
      var v = minV + (k / 4) * (maxV - minV);
      var y = yScale(v);
      yLabels += '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + this._shortMoney(v) + '</text>';
      yLabels += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + y.toFixed(1) + '" stroke="#334155" stroke-width="0.5" stroke-dasharray="2,3" opacity="0.5"/>';
    }

    // 最后一个点（今天）高亮
    var lastX = xScale(data.length - 1);
    var lastY = yScale(lastPt.netWorth);
    var marker = '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="4.5" fill="#22c55e" stroke="#0f172a" stroke-width="2"/>';

    // 涨跌幅（与起点相比）：正值=涨=红（中国习惯），负值=跌=绿
    var firstV = data[0].netWorth;
    var change = lastPt.netWorth - firstV;
    var changePct = firstV > 0 ? (change / firstV * 100) : 0;
    var changeClass = change >= 0 ? "trend-up" : "trend-down";
    var changeSign = change >= 0 ? "+" : "";
    var changeHTML = '<div class="asset-trend-change ' + changeClass + '">' +
      changeSign + this.formatMoney(change) +
      ' <span class="asset-trend-change-pct">(' + changeSign + changePct.toFixed(2) + '%)</span>' +
      '</div>';

    // 把涨跌幅注入 header meta 位置（右上角）
    if (rangeEl) {
      rangeEl.innerHTML = changeHTML;
    }

    // 6 个月前值 / 最高 / 最低 / 当前（保留在 chart 容器底部）
    var stats = '<div class="asset-trend-stats">' +
      '<div class="stat-item"><span class="stat-label">6个月前</span><span class="stat-value">' + this.formatMoney(firstV) + '</span></div>' +
      '<div class="stat-item"><span class="stat-label">区间最高</span><span class="stat-value">' + this.formatMoney(Math.max.apply(null, values)) + '</span></div>' +
      '<div class="stat-item"><span class="stat-label">区间最低</span><span class="stat-value">' + this.formatMoney(Math.min.apply(null, values)) + '</span></div>' +
      '<div class="stat-item"><span class="stat-label">当前</span><span class="stat-value text-cyan">' + this.formatMoney(lastPt.netWorth) + '</span></div>' +
      '</div>';

    var svg =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="asset-trend-svg">' +
        '<defs>' +
          '<linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#22c55e" stop-opacity="0.35"/>' +
            '<stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>' +
          '</linearGradient>' +
        '</defs>' +
        yLabels +
        '<path d="' + areaD + '" fill="url(#trendGradient)"/>' +
        '<path d="' + pathD + '" fill="none" stroke="#22c55e" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        marker +
        xLabels +
      '</svg>';

    chartEl.innerHTML = svg + stats;
  },

  // ========== 6 个月基金市值曲线 ==========
  // 思路:
  //   - 数据源: 母基金 (如 515170) 的日线 ETF 价格
  //   - 联接基金 (如 013126) NAV 用母基金当日收盘价按"现 NAV × 当日 ETF 价 / 最新 ETF 价"折算
  //   - 每周五一个点 + 今天, 共 27 点
  //   - 渲染: 复用 _drawAssetTrendChart 风格的 SVG
  renderFundTrend() {
    var self = this;
    var section = document.getElementById("fundTrendSection");
    var chartEl = document.getElementById("fundTrendChart");
    var rangeEl = document.getElementById("fundTrendRange");
    if (!section || !chartEl) return;

    var funds = Storage.get(Storage.keys.funds) || [];
    if (funds.length === 0) {
      chartEl.innerHTML = '<div class="empty-tip">暂无基金记录</div>';
      if (rangeEl) rangeEl.textContent = "";
      return;
    }

    // 联接基金 → 母基金映射
    var parentMap = {
      "013126": "515170",
      "001513": "510500",
    };

    // 检查每只基金是否需要历史价, 收集需要的母基金 codes
    var neededCodes = [];
    funds.forEach(function(f) {
      var priceCode = f.parentCode || parentMap[f.code] || f.code;
      if (neededCodes.indexOf(priceCode) < 0) neededCodes.push(priceCode);
    });
    console.log('[基金曲线] 持仓: ' + funds.length + ' 只, 需要的母基金 codes: ' + JSON.stringify(neededCodes));
    console.log('[基金曲线] 持仓详情: ' + JSON.stringify(funds.map(function(f){return {code:f.code,name:f.name,nav:f.nav,shares:f.shares,holdValue:f.holdValue,parentCode:f.parentCode};})));

    // 6 个月窗口 (使用本地时区的日期字符串, 避免 toISOString 的 UTC 偏移问题)
    var today = new Date();
    var todayDateStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    var sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    var sixMonthsAgoStr = sixMonthsAgo.getFullYear() + '-' +
      String(sixMonthsAgo.getMonth() + 1).padStart(2, '0') + '-' +
      String(sixMonthsAgo.getDate()).padStart(2, '0');

    // 加载历史价 (复用 _loadAllHistoryData 的逻辑, 但允许指定 codes)
    this._loadFundHistoryData(neededCodes, function(historyData) {
      // 每周五 + 今天 (用本地时区构造 Date 字符串, 不依赖 toISOString)
      var pointDates = self._collectFridayDateStrings(sixMonthsAgo, today);
      if (pointDates.indexOf(todayDateStr) < 0) pointDates.push(todayDateStr);

      // 计算每个点的总基金市值
      var data = pointDates.map(function(dateStr) {
        var totalValue = 0;
        funds.forEach(function(f) {
          var priceCode = f.parentCode || parentMap[f.code] || f.code;
          var currentNav = parseFloat(f.nav) || 0;
          var shares = parseFloat(f.shares) || 0;
          if (shares <= 0 || currentNav <= 0) {
            totalValue += parseFloat(f.holdValue) || 0;
            return;
          }
          var histArr = historyData[priceCode];
          if (histArr && histArr.length > 0) {
            var currentEtf = histArr[histArr.length - 1].close;
            var histEtf = self._findClosestCloseByDate(histArr, dateStr) || currentEtf;
            if (currentEtf > 0) {
              var estNav = currentNav * (histEtf / currentEtf);
              totalValue += shares * estNav;
            } else {
              totalValue += parseFloat(f.holdValue) || 0;
            }
          } else {
            totalValue += parseFloat(f.holdValue) || 0;
          }
        });
        return { dateStr: dateStr, value: totalValue };
      });

      // 今日真实值 (锚定) - 用 sum(f.holdValue) 当常量的今天值
      var todayRealValue = 0;
      funds.forEach(function(f) { todayRealValue += parseFloat(f.holdValue) || 0; });
      // 把今天那一点的 value 覆盖为 todayRealValue, 确保与卡片显示一致
      for (var i = 0; i < data.length; i++) {
        if (data[i].dateStr === todayDateStr) {
          data[i].value = todayRealValue;
        }
      }

      console.log('[基金曲线] 共 ' + data.length + ' 个点, 范围 ' + data[0].dateStr + ' ~ ' + data[data.length-1].dateStr +
        ', 首值=' + data[0].value.toFixed(0) + ', 末值=' + data[data.length-1].value.toFixed(0));
      self._drawFundTrendChart(chartEl, rangeEl, data, todayRealValue);
    });
  },

  // 收集每周五的本地日期字符串 (YYYY-MM-DD)
  _collectFridayDateStrings(start, end) {
    var dates = [];
    var d = new Date(start);
    while (d.getDay() !== 5) {
      d.setDate(d.getDate() + 1);
    }
    while (d <= end) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      dates.push(y + '-' + m + '-' + day);
      d.setDate(d.getDate() + 7);
    }
    return dates;
  },

  // 按日期字符串找最近的历史价 (字符串字典序对 YYYY-MM-DD 格式等同时间顺序)
  _findClosestCloseByDate(arr, dateStr) {
    var last = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].date <= dateStr) last = arr[i].close;
      else break;
    }
    return last;
  },

  // 加载指定 codes 的历史价
  // 数据源: window.STOCK_HISTORY_DATA（js/history-data.js, 内联）
  _loadFundHistoryData(codes, callback) {
    var self = this;
    var historyData = {};
    // file: 协议下跳过 fetch，直接使用内联数据
    if (location.protocol === 'file:') {
      callback((typeof window !== 'undefined') ? window.STOCK_HISTORY_DATA : null);
      return;
    }

    var data = (typeof window !== 'undefined') ? window.STOCK_HISTORY_DATA : null;

    if (data) {
      codes.forEach(function(code) {
        if (data[code] && data[code].length > 0) {
          // 复制一份避免污染全局
          historyData[code] = data[code].slice();
        }
      });
    } else {
      console.warn('[基金曲线] window.STOCK_HISTORY_DATA 不存在, 曲线将 fallback 到 holdValue');
    }

    // 诊断日志
    codes.forEach(function(code) {
      var arr = historyData[code];
      if (arr && arr.length > 0) {
        console.log('[基金曲线] ' + code + ' 数据 ' + arr.length + ' 条, 首 ' + arr[0].date + ' 末 ' + arr[arr.length-1].date);
      } else {
        console.warn('[基金曲线] ' + code + ' 无历史数据, 该基金将 fallback 到 holdValue');
      }
    });
    self._appendTodayIfMissing(historyData);
    console.log('[基金曲线] 加载完成, historyData keys: ' + JSON.stringify(Object.keys(historyData)) + ', 长度: ' + JSON.stringify(Object.keys(historyData).map(function(k){return [k, (historyData[k]||[]).length];})));
    callback(historyData);
  },

  // 绘制基金曲线 SVG (类似资产曲线的样式, 但只用基金值)
  _drawFundTrendChart(chartEl, rangeEl, data, todayValue) {
    if (data.length === 0) {
      chartEl.innerHTML = '<div class="empty-tip">暂无数据</div>';
      if (rangeEl) rangeEl.textContent = "";
      return;
    }

    var firstV = data[0].value;
    var lastPt = data[data.length - 1];
    var change = lastPt.value - firstV;
    var changePct = firstV > 0 ? (change / firstV * 100) : 0;
    var changeClass = change >= 0 ? "trend-up" : "trend-down";
    var changeSign = change >= 0 ? "+" : "";
    var changeText = changeSign + this.formatMoney(change) +
      ' (' + changeSign + changePct.toFixed(2) + '%)';
    if (rangeEl) {
      rangeEl.textContent = changeText;
      rangeEl.className = 'asset-trend-change ' + changeClass;
    }

    var values = data.map(function(d) { return d.value; });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    var pad = (maxV - minV) * 0.15 || maxV * 0.05;
    minV -= pad;
    maxV += pad;
    if (maxV === minV) { maxV += 1; minV -= 1; }

    var W = 680, H = 200;
    var padL = 56, padR = 16, padT = 16, padB = 28;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var xScale = function(i) { return padL + (i / (data.length - 1 || 1)) * plotW; };
    var yScale = function(v) { return padT + plotH - ((v - minV) / (maxV - minV)) * plotH; };

    var pathD = data.map(function(d, i) {
      return (i === 0 ? "M" : "L") + xScale(i).toFixed(1) + " " + yScale(d.value).toFixed(1);
    }).join(" ");

    var areaD = pathD +
      " L" + xScale(data.length - 1).toFixed(1) + " " + (padT + plotH).toFixed(1) +
      " L" + xScale(0).toFixed(1) + " " + (padT + plotH).toFixed(1) + " Z";

    // X 轴标签：动态计算数量，避免重叠
    var xLabels = "";
    var minLabelGap = 50;
    var xLabelCount = Math.max(3, Math.min(6, Math.floor(plotW / minLabelGap)));
    xLabelCount = Math.min(xLabelCount, data.length);
    var xStep = data.length > 1 ? Math.floor((data.length - 1) / (xLabelCount - 1)) : 1;
    for (var k = 0; k < xLabelCount; k++) {
      var idx = (k === xLabelCount - 1) ? (data.length - 1) : Math.min(k * xStep, data.length - 1);
      var px = padL + (idx / (data.length - 1)) * plotW;
      if (px > W - padR - 20) px = W - padR - 20;
      var dateLabel = data[idx].dateStr || '';
      xLabels += '<text x="' + px.toFixed(1) + '" y="' + (padT + plotH + 18) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + dateLabel + '</text>';
    }

    var yLabels = "";
    for (var k = 0; k <= 4; k++) {
      var v = minV + (k / 4) * (maxV - minV);
      var y = yScale(v);
      yLabels += '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + this._shortMoney(v) + '</text>';
      yLabels += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + y.toFixed(1) + '" stroke="#334155" stroke-width="0.5" stroke-dasharray="2,3" opacity="0.5"/>';
    }

    var lastX = xScale(data.length - 1);
    var lastY = yScale(lastPt.value);
    var marker = '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="4.5" fill="#22c55e" stroke="#0f172a" stroke-width="2"/>';

    // 中国习惯: 涨红跌绿
    var lineColor = change >= 0 ? "#ef4444" : "#22c55e";
    var fillTop = change >= 0 ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)";

    var stats = '<div class="asset-trend-stats">' +
      '<div class="stat-item"><span class="stat-label">6个月前</span><span class="stat-value">' + this.formatMoney(firstV) + '</span></div>' +
      '<div class="stat-item"><span class="stat-label">区间最高</span><span class="stat-value">' + this.formatMoney(Math.max.apply(null, values)) + '</span></div>' +
      '<div class="stat-item"><span class="stat-label">区间最低</span><span class="stat-value">' + this.formatMoney(Math.min.apply(null, values)) + '</span></div>' +
      '<div class="stat-item"><span class="stat-label">当前</span><span class="stat-value text-cyan">' + this.formatMoney(lastPt.value) + '</span></div>' +
      '</div>';

    var svg =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="asset-trend-svg">' +
        '<defs>' +
          '<linearGradient id="fundTrendGradient" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + (change >= 0 ? "#ef4444" : "#22c55e") + '" stop-opacity="0.35"/>' +
            '<stop offset="100%" stop-color="' + (change >= 0 ? "#ef4444" : "#22c55e") + '" stop-opacity="0"/>' +
          '</linearGradient>' +
        '</defs>' +
        yLabels +
        '<path d="' + areaD + '" fill="url(#fundTrendGradient)"/>' +
        '<path d="' + pathD + '" fill="none" stroke="' + lineColor + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        marker +
        xLabels +
      '</svg>';

    chartEl.innerHTML = svg + stats;
  },

  // 短金额格式（万 / 亿）
  _shortMoney(v) {
    var abs = Math.abs(v);
    if (abs >= 1e8) return (v / 1e8).toFixed(2) + "亿";
    if (abs >= 1e4) return (v / 1e4).toFixed(1) + "万";
    return v.toFixed(0);
  },

  // ===== 现金资产 =====
  loadTransactions() {
    var self = this;

    // ---- 1. 读取账户余额 ----
    var cashAccounts = Storage.get(Storage.keys.cashAccounts);

    // 如果没有账户数据，初始化预设数据
    if (!cashAccounts || cashAccounts.length === 0) {
      cashAccounts = this.initDefaultCashAccounts();
    }

    // 渲染账户余额卡片
    this.renderCashAccounts(cashAccounts);
  },

  // 初始化预设账户（首次使用时）
  initDefaultCashAccounts() {
    var today = new Date().toISOString().split("T")[0];
    var now = new Date().toISOString();
    var accounts = [
      { id: "cmb_8150", name: "招商银行", icon: "bank", label: "招商银行（尾号8150）", balance: 58529.59, updated: today, createdAt: now, updatedAt: now, note: "活期 53,663.41 + 朝朝宝 4,866.18" },
      { id: "yuebao", name: "余额宝", icon: "yuebao", label: "余额宝", balance: 1498946.04, updated: today, createdAt: now, updatedAt: now, note: "天弘余额宝货币" }
    ];
    Storage.set(Storage.keys.cashAccounts, accounts);
    return accounts;
  },

  // 渲染现金账户余额卡片
  renderCashAccounts(accounts) {
    var container = document.getElementById("cashAccounts");
    if (!container) return;

    var totalCash = 0;
    accounts.forEach(function(a) { totalCash += parseFloat(a.balance) || 0; });

    var html = "";

    // 总余额条
    if (accounts.length > 0) {
      html += '<div class="cash-total-bar">';
      html += '<span class="cash-total-label"><svg class="icon" style="width:18px;height:18px;color:var(--accent);"><use href="#icon-cash"/></svg> 现金总余额</span>';
      html += '<span class="cash-total-value">' + this.formatMoney(totalCash) + '</span>';
      html += '</div>';
    }

    // 各账户卡片
    accounts.forEach(function(a, idx) {
      var logoSvg = this._getAccountLogoSvg(a.icon || a.id);
      html += '<div class="cash-account-card">';
      html += '<div class="cash-account-icon ' + (a.icon || 'bank') + '">' + logoSvg + '</div>';
      html += '<div class="cash-account-body">';
      html += '<div class="cash-account-name editable-label" onclick="App.editCashLabel(\'' + a.id + '\')" title="点击修改名称">' + this.escapeHtml(a.label) + '</div>';
      html += '<div class="cash-account-detail">' + this.escapeHtml(a.note || "") + ' · 更新于 ' + this.escapeHtml(a.updated || "未知") + '</div>';
      html += '</div>';
      html += '<div class="cash-account-amount editable" onclick="App.openEditBalance(\'' + a.id + '\')" title="点击编辑余额">' + this.formatMoney(a.balance) + '</div>';
      html += '<div class="cash-account-actions">';
      html += '<button onclick="App.deleteCashAccount(\'' + a.id + '\')" title="删除">' + this.icon('delete') + '</button>';
      html += '</div>';
      html += '</div>';
    }.bind(this));

    // 饼图
    if (accounts.length > 0) {
      html += '<div class="cash-pie-section" id="cashPieSection">';
      html += this.renderCashPieChart(accounts, totalCash);
      html += '</div>';
    }

    if (!html) {
      html = '<div class="empty-tip" style="padding:24px;text-align:center;">暂无账户数据，请添加现金账户</div>';
    }

    container.innerHTML = html;
  },

  // 获取账户 logo SVG
  _getAccountLogoSvg(icon) {
    if (icon === "yuebao") {
      // 余额宝：用天弘基金风格图标（橙色圆形 + ¥）
      return '<svg viewBox="0 0 40 40" width="28" height="28"><circle cx="20" cy="20" r="18" fill="#FF6A00" opacity="0.2"/><circle cx="20" cy="20" r="18" fill="none" stroke="#FF6A00" stroke-width="2"/><text x="20" y="27" text-anchor="middle" font-size="18" font-weight="800" fill="#FF6A00" font-family="sans-serif">¥</text></svg>';
    }
    if (icon === "bank") {
      // 招商银行/银行：红色菱形 + 行标
      return '<svg viewBox="0 0 40 40" width="28" height="28"><rect x="6" y="10" width="28" height="22" rx="3" fill="#C41230" opacity="0.15" stroke="#C41230" stroke-width="1.5"/><rect x="12" y="16" width="16" height="2" rx="1" fill="#C41230"/><rect x="12" y="21" width="12" height="2" rx="1" fill="#C41230"/><rect x="12" y="26" width="8" height="2" rx="1" fill="#C41230"/></svg>';
    }
    if (icon === "alipay") {
      return '<svg viewBox="0 0 40 40" width="28" height="28"><circle cx="20" cy="20" r="18" fill="#1677FF" opacity="0.15" stroke="#1677FF" stroke-width="1.5"/><text x="20" y="27" text-anchor="middle" font-size="18" font-weight="800" fill="#1677FF" font-family="sans-serif">支</text></svg>';
    }
    if (icon === "wechat") {
      return '<svg viewBox="0 0 40 40" width="28" height="28"><circle cx="20" cy="20" r="18" fill="#07C160" opacity="0.15" stroke="#07C160" stroke-width="1.5"/><text x="20" y="27" text-anchor="middle" font-size="18" font-weight="800" fill="#07C160" font-family="sans-serif">微</text></svg>';
    }
    if (icon === "savings") {
      return '<svg viewBox="0 0 40 40" width="28" height="28"><circle cx="20" cy="20" r="18" fill="#8B5CF6" opacity="0.15" stroke="#8B5CF6" stroke-width="1.5"/><text x="20" y="27" text-anchor="middle" font-size="16" font-weight="800" fill="#8B5CF6" font-family="sans-serif">储</text></svg>';
    }
    return '<svg viewBox="0 0 40 40" width="28" height="28"><circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/><text x="20" y="27" text-anchor="middle" font-size="18" font-weight="700" fill="currentColor" opacity="0.5" font-family="sans-serif">¥</text></svg>';
  },

  // 渲染现金资产饼图
  renderCashPieChart(accounts, totalCash) {
    var colors = ["#4ade80", "#22d3ee", "#a78bfa", "#fbbf24", "#f87171", "#60a5fa", "#fb923c", "#94a3b8"];
    var pieData = accounts.map(function(a, i) {
      return {
        label: a.label,
        balance: parseFloat(a.balance) || 0,
        color: colors[i % colors.length]
      };
    });

    // SVG 饼图参数
    var cx = 90, cy = 90, r = 70;
    var totalAngle = 0;

    var slicesSvg = "";
    var legendHtml = "";
    var total = totalCash || 1;

    pieData.forEach(function(slice) {
      if (slice.balance <= 0) return;
      var angle = (slice.balance / total) * Math.PI * 2;
      var x1 = cx + r * Math.sin(totalAngle);
      var y1 = cy - r * Math.cos(totalAngle);
      var largeArc = angle > Math.PI ? 1 : 0;
      totalAngle += angle;
      var x2 = cx + r * Math.sin(totalAngle);
      var y2 = cy - r * Math.cos(totalAngle);

      slicesSvg += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ',' + y2 + ' Z" fill="' + slice.color + '" opacity="0.85" stroke="var(--bg-body)" stroke-width="2"/>';

      var pct = ((slice.balance / total) * 100).toFixed(1);
      legendHtml += '<div class="pie-legend-item">';
      legendHtml += '<span class="pie-legend-dot" style="background:' + slice.color + ';"></span>';
      legendHtml += '<span class="pie-legend-label">' + slice.label + ' <span class="pie-legend-pct">' + pct + '%</span></span>';
      legendHtml += '</div>';
    });

    var svg = '<svg viewBox="0 0 180 180" class="cash-pie-chart">' + slicesSvg + '</svg>';

    return '<div class="cash-pie-wrap">' +
      '<div class="cash-pie-title">资产分布</div>' +
      '<div class="cash-pie-body">' + svg +
      '<div class="pie-legend">' + legendHtml + '</div>' +
      '</div></div>';
  },

  // 打开余额编辑弹窗
  openEditBalance(accountId) {
    var accounts = Storage.get(Storage.keys.cashAccounts);
    var account = null;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i].id === accountId) { account = accounts[i]; break; }
    }
    if (!account) return;

    this._editingAccountId = accountId;
    document.getElementById("editBalanceTitle").textContent = "编辑 " + account.label;
    document.getElementById("editBalanceInput").value = account.balance;
    document.getElementById("editBalanceOverlay").style.display = "flex";
    document.getElementById("editBalanceInput").focus();
  },

  // 关闭余额编辑弹窗
  closeEditBalance() {
    document.getElementById("editBalanceOverlay").style.display = "none";
    this._editingAccountId = null;
  },

  // 确认编辑余额
  confirmEditBalance() {
    var newBalance = parseFloat(document.getElementById("editBalanceInput").value);
    if (isNaN(newBalance) || newBalance < 0) {
      this.showToast("请输入有效的金额", "error");
      return;
    }

    var today = new Date().toISOString().split("T")[0];
    Storage.update(Storage.keys.cashAccounts, this._editingAccountId, {
      balance: newBalance,
      updated: today
    });

    this.closeEditBalance();
    this.loadTransactions();
    this.loadDashboard();
    this.showToast("余额已更新");
  },

  // ===== 添加现金账户 =====
  openAddCashAccount() {
    document.getElementById("addCashOverlay").style.display = "flex";
    document.getElementById("addCashLabel").value = "";
    document.getElementById("addCashBalance").value = "";
    document.getElementById("addCashNote").value = "";
    // 重置图标选择为默认 bank
    var opts = document.querySelectorAll("#cashIconPicker .cash-icon-option");
    opts.forEach(function(o) { o.classList.remove("selected"); });
    var defaultOpt = document.querySelector('#cashIconPicker .cash-icon-option[data-icon="bank"]');
    if (defaultOpt) defaultOpt.classList.add("selected");
    this._selectedCashIcon = "bank";
    setTimeout(function() { document.getElementById("addCashLabel").focus(); }, 100);
  },

  closeAddCashAccount() {
    document.getElementById("addCashOverlay").style.display = "none";
  },

  confirmAddCashAccount() {
    var label = document.getElementById("addCashLabel").value.trim();
    var balance = parseFloat(document.getElementById("addCashBalance").value);
    var note = document.getElementById("addCashNote").value.trim();

    if (!label) {
      this.showToast("请输入资产归属", "error");
      return;
    }
    if (isNaN(balance) || balance < 0) {
      this.showToast("请输入有效的金额", "error");
      return;
    }

    var today = new Date().toISOString().split("T")[0];
    var newAccount = {
      name: label,
      label: label,
      icon: this._selectedCashIcon || "bank",
      balance: balance,
      updated: today,
      note: note || "手动添加"
    };
    Storage.add(Storage.keys.cashAccounts, newAccount);

    this.closeAddCashAccount();
    this.loadTransactions();
    this.loadDashboard();
    this.showToast("现金账户已添加");
  },

  // ===== 就地编辑现金账户名称 =====
  editCashLabel(id) {
    var accounts = Storage.get(Storage.keys.cashAccounts);
    var account = accounts.find(function(a) { return a.id === id; });
    if (!account) return;

    // 找到显示名称的 DOM 元素
    var cards = document.querySelectorAll('#cashAccounts .cash-account-card');
    var targetCard = null;
    cards.forEach(function(card) {
      var nameEl = card.querySelector('.cash-account-name');
      if (nameEl && nameEl.getAttribute('onclick') && nameEl.getAttribute('onclick').indexOf(id) !== -1) {
        targetCard = card;
      }
    });
    if (!targetCard) return;

    var nameEl = targetCard.querySelector('.cash-account-name');
    var oldLabel = account.label || account.name || '';

    // 创建 input 替换
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'cash-label-input';
    input.value = oldLabel;
    input.maxLength = 30;

    nameEl.innerHTML = '';
    nameEl.appendChild(input);
    nameEl.removeAttribute('onclick');
    input.focus();
    input.select();

    var self = this;
    var saveEdit = function() {
      var newLabel = input.value.trim();
      if (newLabel && newLabel !== oldLabel) {
        Storage.update(Storage.keys.cashAccounts, id, { label: newLabel, name: newLabel, updated: new Date().toISOString().split('T')[0] });
        self.showToast('名称已更新');
        self.loadTransactions();
        self.loadDashboard();
      } else {
        // 恢复显示
        self.loadTransactions();
      }
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { self.loadTransactions(); }
    });
  },

  deleteCashAccount(id) {
    if (!confirm("确定删除此现金账户？")) return;
    Storage.delete(Storage.keys.cashAccounts, id);
    this.loadTransactions();
    this.loadDashboard();
    this.showToast("现金账户已删除");
  },

  deleteTransaction(type, id) {
    if (!confirm("确定删除此记录？")) return;
    var key = type === "income" ? Storage.keys.income : Storage.keys.expense;
    Storage.delete(key, id);
    this.loadTransactions();
    this.showToast("记录已删除");
  },

  loadIncomeList() {
    this.loadTransactions();
  },

  loadExpenseList() {
    this.loadTransactions();
  },

  saveIncome() {
    Storage.add(Storage.keys.income, { type:document.getElementById("incomeType").value, amount:document.getElementById("incomeAmount").value, source:document.getElementById("incomeSource").value, date:document.getElementById("incomeDate").value });
    document.getElementById("incomeForm").reset(); this.setTodayDates();
    document.getElementById("incomeFormModal").classList.remove("show");
    this.loadTransactions(); this.showToast("收入记录已保存");
  },

  saveExpense() {
    Storage.add(Storage.keys.expense, { category:document.getElementById("expenseCategory").value, amount:document.getElementById("expenseAmount").value, method:document.getElementById("expenseMethod").value, note:document.getElementById("expenseNote").value, date:document.getElementById("expenseDate").value });
    document.getElementById("expenseForm").reset(); this.setTodayDates();
    document.getElementById("expenseFormModal").classList.remove("show");
    this.loadTransactions(); this.showToast("支出记录已保存");
  },

  getIncomeTypeLabel(type) {
    return { salary:"工资薪金", bonus:"奖金", investment:"投资收益", rent:"租金收入", other:"其他收入" }[type] || "其他收入";
  },

  getExpenseCategoryLabel(c) {
    return { food:"餐饮美食", shopping:"购物消费", housing:"住房物业", transport:"交通出行", education:"教育培训", medical:"医疗健康", entertainment:"休闲娱乐", other:"其他支出" }[c] || "其他支出";
  },


  loadInsuranceList() {
    try {
      var list = Storage.get(Storage.keys.insurance);
      console.log('[App] loadInsuranceList: 保单数量=' + list.length);
      var container = document.getElementById("insuranceList");
      // 提醒区
      var reminders = Storage.getInsuranceReminders();
      var rc = document.getElementById("insuranceReminders");
      if (rc) {
        if (reminders.length > 0) {
          var rhtml = "";
          var today = new Date(); today.setHours(0,0,0,0);
          reminders.forEach(function(item) {
            var parts = item.nextPayDate.split('-');
            var nextDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            var daysLeft = Math.ceil((nextDate - today) / 86400000);
            var daysText = daysLeft === 0 ? "今天" : (daysLeft + "天后");
            var urgencyClass = daysLeft <= 7 ? " style=\"color:#ef4444;font-weight:bold;\"" : "";
            rhtml += "<div class=\"reminder-item\"><div><strong>" + self.escapeHtml(item.product) + "</strong>（" + self.escapeHtml(item.person) + "）<div style=\"font-size:12px;color:#94a3b8;\">下次缴费: " + self.escapeHtml(item.nextPayDate) + " · ¥" + Number(item.premium).toLocaleString() + "</div></div><div class=\"reminder-days\"" + urgencyClass + ">" + daysText + "</div></div>";
          });
          rc.innerHTML = rhtml;
        } else {
          rc.innerHTML = "<div style=\"color:#94a3b8;font-size:14px;padding:8px 0;\">暂无即将到期的缴费提醒</div>";
        }
      }
      // 保单列表
      if (container) {
        if (list.length === 0) { container.innerHTML = "<div class=\"empty-tip\">暂无保单记录</div>"; return; }
        var html = "";
        var self = this;
        var today = new Date(); today.setHours(0,0,0,0);
        list.forEach(function(item) {
          var extra = "";
          if (item.nextPayDate) {
            var parts = item.nextPayDate.split('-');
            var nextDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            var daysLeft = Math.ceil((nextDate - today) / 86400000);
            var daysLabel = daysLeft >= 0 ? (daysLeft === 0 ? "今天" : daysLeft + "天后") : "已过期";
            var daysColor = daysLeft < 0 ? "#ef4444" : (daysLeft <= 30 ? "#f59e0b" : "#22c55e");
            extra += "<div class=\"record-detail\">下次缴费: " + item.nextPayDate + " <span style=\"color:" + daysColor + ";font-weight:bold;\">（" + daysLabel + "）</span></div>";
          }
          if (item.collectNote) extra += "<div class=\"collect-tag\">" + self.escapeHtml(item.collectNote) + "</div>";
          html += "<div class=\"record-item\"><div class=\"record-info\"><div class=\"record-title\">" + self.escapeHtml(item.product) + "</div><div class=\"record-detail\">被保险人: " + self.escapeHtml(item.person) + " · " + self.escapeHtml(item.company) + "</div><div class=\"record-detail\">年缴: " + self.formatMoney(item.premium) + " · 区间: " + self.escapeHtml(item.payPeriod || "—") + "</div>" + extra + "</div><div class=\"record-actions\"><button onclick=\"App.editInsurance('" + item.id + "')\">" + self.icon('edit') + "</button><button onclick=\"App.deleteInsurance('" + item.id + "')\">" + self.icon('delete') + "</button></div></div>";
        });
        container.innerHTML = html;
      }
      // 渲染缴费进度图
      this.renderInsuranceProgress();
    } catch(e) {
      console.error('[App] loadInsuranceList 异常:', e);
    }
  },

  // ===================== 保险缴费进度图 =====================
  renderInsuranceProgress() {
    var today = new Date();
    today.setHours(0,0,0,0);
    var container = document.getElementById("insuranceProgress");
    if (!container) return;

    var list = Storage.get(Storage.keys.insurance);
    if (list.length === 0) { container.innerHTML = ""; return; }

    var breakdown = this.calcInsuranceYearlyBreakdown();
    var yearly = breakdown.yearly;
    var noPeriodList = []; // 仅用于底部提示，不影响计算

    // 收集 noPeriodList（仅用于 UI 提示，不影响 yearly 计算）
    list.forEach(function(p) {
      var match = (p.payPeriod || "").match(/(\d{4})\s*-\s*(\d{4})/);
      if (!match) noPeriodList.push(p);
    });

    var years = Object.keys(yearly).sort(function(a, b) { return parseInt(a) - parseInt(b); });
    if (years.length === 0) {
      container.innerHTML = "<div style=\"padding:12px;color:#94a3b8;text-align:center;font-size:13px;\">暂无有明确缴费周期的保单，无法生成进度图</div>";
      return;
    }

    // 计算累计值
    var totalPaid = breakdown.totalPaid, totalAll = breakdown.totalAll;
    var cumPaid = 0, cumAll = 0;
    var cumPoints = [], maxYearly = 0, maxCum = 0;
    years.forEach(function(y) {
      var d = yearly[y];
      cumPaid += d.paid;
      cumAll += d.paid + d.remaining;
      cumPoints.push({ year: y, cumPaid: cumPaid, cumAll: cumAll, yearlyPaid: d.paid, yearlyRemaining: d.remaining, yearlyTotal: d.paid + d.remaining });
      if (d.paid + d.remaining > maxYearly) maxYearly = d.paid + d.remaining;
      if (cumAll > maxCum) maxCum = cumAll;
    });

    var pct = totalAll > 0 ? (totalPaid / totalAll * 100) : 0;

    // SVG 尺寸
    var W = 680, H = 380;
    var ml = 65, mr = 20, mt = 15, mb = 55;
    var cw = W - ml - mr, ch = H - mt - mb;
    var minYear = parseInt(years[0]), maxYear = parseInt(years[years.length - 1]);
    var n = years.length;

    // Y轴刻度
    var yMax = Math.ceil(maxCum / 50000) * 50000;
    if (yMax < maxCum) yMax += 50000;
    var yTicks = [];
    var yStep = Math.ceil(yMax / 4 / 10000) * 10000;
    for (var t = 0; t <= yMax; t += yStep) {
      if (t <= yMax) yTicks.push(t);
    }
    // 追加纵轴标记
    [1560000, 2000000].forEach(function(mark) {
      if (mark <= yMax && mark % yStep !== 0) {
        yTicks.push(mark);
      }
    });
    yTicks.sort(function(a, b) { return a - b; });

    function xPos(yearIdx) { return ml + (yearIdx / (n - 1)) * cw; }
    function yPos(val) { return mt + ch - (val / yMax) * ch; }

    // 今日位置
    var todayYear = today.getFullYear();
    var todayFrac = todayYear + (today.getMonth() + today.getDate() / 31) / 12;
    var todayIdx = (todayFrac - minYear) / (maxYear - minYear);
    var todayX = ml + todayIdx * cw;

    var self = this;
    function fmtW(v) { return "¥" + (v / 10000).toFixed(1) + "万"; }
    function fmtFull(v) { return "¥" + self.formatMoney(v); }

    // 构建颜色
    var green = "#4ade80", greenLight = "#166534", grayLight = "#1a1a2e", grayMed = "rgba(255,255,255,0.08)";
    var accent = "#4ade80", accentLight = "#14532d";

    var svg = [];
    svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="font-family:-apple-system,PingFang SC,sans-serif;font-size:12px;">');

    // 背景
    svg.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#13132a" rx="8"/>');

    // 标题
    svg.push('<text x="' + (W/2) + '" y="' + (mt + 18) + '" text-anchor="middle" font-size="16" font-weight="700" fill="#f1f5f9">缴费进度总览</text>');

    // Y轴标签
    yTicks.forEach(function(t) {
      var y = yPos(t);
      svg.push('<line x1="' + ml + '" y1="' + y + '" x2="' + (W - mr) + '" y2="' + y + '" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>');
      svg.push('<text x="' + (ml - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + fmtW(t) + '</text>');
    });

    // 累计面积：已缴（绿色填充）
    var areaPath = "";
    cumPoints.forEach(function(p, i) {
      var x = xPos(i), y = yPos(p.cumPaid);
      areaPath += (i === 0 ? "M" : "L") + x + "," + y + " ";
    });
    // 补回底部形成闭合区域
    var lastX = xPos(cumPoints.length - 1);
    areaPath += "L" + lastX + "," + (mt + ch) + " L" + xPos(0) + "," + (mt + ch) + " Z";
    svg.push('<path d="' + areaPath + '" fill="url(#paidGrad)" opacity="0.3"/>');

    // 剩余面积（浅灰）
    var restPath = "";
    cumPoints.forEach(function(p, i) {
      var x = xPos(i);
      restPath += (i === 0 ? "M" : "L") + x + "," + yPos(p.cumPaid) + " ";
    });
    for (var i = cumPoints.length - 1; i >= 0; i--) {
      restPath += "L" + xPos(i) + "," + yPos(cumPoints[i].cumAll) + " ";
    }
    restPath += "Z";
    svg.push('<path d="' + restPath + '" fill="' + grayLight + '" opacity="0.7"/>');

    // 累计已缴线
    var paidLine = "";
    cumPoints.forEach(function(p, i) {
      paidLine += (i === 0 ? "M" : "L") + xPos(i) + "," + yPos(p.cumPaid) + " ";
    });
    svg.push('<path d="' + paidLine + '" fill="none" stroke="' + green + '" stroke-width="2.5" stroke-linejoin="round"/>');

    // 累计总线（虚线参考）
    var totalLine = "";
    cumPoints.forEach(function(p, i) {
      totalLine += (i === 0 ? "M" : "L") + xPos(i) + "," + yPos(p.cumAll) + " ";
    });
    svg.push('<path d="' + totalLine + '" fill="none" stroke="' + grayMed + '" stroke-width="1.5" stroke-dasharray="6,3"/>');

    // 已缴线端点圆
    cumPoints.forEach(function(p, i) {
      svg.push('<circle cx="' + xPos(i) + '" cy="' + yPos(p.cumPaid) + '" r="3.5" fill="' + green + '" stroke="#1a1a2e" stroke-width="1.5"/>');
    });

    // 今日竖线
    if (todayX >= ml - 2 && todayX <= W - mr + 2) {
      svg.push('<line x1="' + todayX + '" y1="' + mt + '" x2="' + todayX + '" y2="' + (mt + ch) + '" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,4" opacity="0.7"/>');
      svg.push('<rect x="' + (todayX - 30) + '" y="' + (mt + 2) + '" width="60" height="18" rx="9" fill="#ef4444"/>');
      svg.push('<text x="' + todayX + '" y="' + (mt + 14) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#0a0a14">今日</text>');
    }

    // 今日在已缴线上的大圆点
    if (todayIdx >= 0 && todayIdx <= cumPoints.length - 1) {
      var ti = Math.min(Math.floor(todayIdx), cumPoints.length - 2);
      var frac = todayIdx - ti;
      var cyPaid = yPos(cumPoints[ti].cumPaid + frac * (cumPoints[ti+1].cumPaid - cumPoints[ti].cumPaid));
      svg.push('<circle cx="' + todayX + '" cy="' + cyPaid + '" r="6" fill="#ef4444" stroke="#0a0a14" stroke-width="2.5"/>');
    }

    // X轴标签（每2-3年）
    years.forEach(function(y, i) {
      var show = (i === 0 || i === n - 1 || (parseInt(y) % 5 === 0) || (parseInt(y) === todayYear));
      if (show) {
        var x = xPos(i);
        var bold = (parseInt(y) === todayYear) ? ' font-weight="700" fill="#ef4444"' : ' fill="#94a3b8"';
        svg.push('<text x="' + x + '" y="' + (mt + ch + 16) + '" text-anchor="middle" font-size="11"' + bold + '>' + y + '</text>');
        svg.push('<line x1="' + x + '" y1="' + (mt + ch) + '" x2="' + x + '" y2="' + (mt + ch + 4) + '" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>');
      }
    });

    // 今日在X轴上的标记
    if (todayIdx >= 0 && todayIdx <= n - 1) {
      svg.push('<text x="' + todayX + '" y="' + (mt + ch + 33) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#ef4444">2026.06</text>');
    }

    // 渐变定义
    svg.push('<defs><linearGradient id="paidGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + green + '"/><stop offset="100%" stop-color="' + greenLight + '"/></linearGradient></defs>');

    svg.push('</svg>');

    // 汇总条
    var summaryHtml = '<div style="margin-top:4px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">' +
        '<span style="font-size:14px;font-weight:600;color:#f1f5f9;">已缴 ' + fmtFull(totalPaid) + ' / 总计 ' + fmtFull(totalAll) + '</span>' +
        '<span style="font-size:24px;font-weight:800;color:' + green + ';">' + pct.toFixed(1) + '%</span>' +
      '</div>' +
      '<div style="height:12px;background:#1e1e38;border-radius:6px;overflow:hidden;">' +
        '<div style="height:100%;width:' + Math.min(pct, 100) + '%;background:linear-gradient(90deg,' + green + ',' + greenLight + ');border-radius:6px;transition:width 0.5s ease;"></div>' +
      '</div>';

    // 年度详情
    if (noPeriodList.length > 0) {
      summaryHtml += '<div style="margin-top:8px;font-size:11px;color:#94a3b8;">' +
        '注：' + noPeriodList.length + ' 份"每年单独购买"保单未纳入进度计算（无固定缴费周期）</div>';
    }

    summaryHtml += '</div>';

    container.innerHTML = summaryHtml + svg.join('');
  },
  // ===================== 保险缴费进度图 结束 =====================

  // 刷新所有保单的下次缴费日期（根据频率自动推进过期日期）
  refreshInsuranceDates() {
    var list = Storage.get(Storage.keys.insurance);
    if (list.length === 0) { this.showToast('暂无保单数据', 'error'); return; }
    var self = this;
    var updated = 0;
    list.forEach(function(item) {
      var oldDate = item.nextPayDate;
      var newDate = self.adjustNextPayDate(item);
      if (newDate !== oldDate) {
        item.nextPayDate = newDate;
        Storage.update(Storage.keys.insurance, item.id, { nextPayDate: newDate });
        updated++;
      }
    });
    if (updated > 0) {
      this.loadInsuranceList();
      this.showToast('已刷新 ' + updated + ' 条保单的缴费日期');
    } else {
      this.showToast('所有缴费日期均已为最新');
    }
  },

  getFreqLabel(freq) {
    return { yearly:"每年", monthly:"每月", quarterly:"每季度" }[freq] || "每年";
  },

  // ===================== 保险累计已缴总额 =====================
  // 与 renderInsuranceProgress 共用同样的口径：
  //   payPeriod="2020-2025" → 6 年区间
  //   nextPayDate="2026-12-01" → paidUntil=2025（≤ nextPayDate 的年-1）
  //   每年的 premium 计入 paid（在 paidUntil 之前）/ remaining（之后）
  // 返回 { yearly, totalPaid, totalAll, noPeriodCount }
  //   yearly: { "2020": {paid, remaining}, "2021": {...} }
  calcInsuranceYearlyBreakdown() {
    var list = Storage.get(Storage.keys.insurance);
    var yearly = {};
    var noPeriodCount = 0;
    list.forEach(function(p) {
      var m = (p.payPeriod || "").match(/(\d{4})\s*-\s*(\d{4})/);
      if (!m) { noPeriodCount++; return; }
      var startY = parseInt(m[1]), endY = parseInt(m[2]);
      var premium = parseFloat(p.premium) || 0;
      var paidUntil = p.nextPayDate ? parseInt(p.nextPayDate.split('-')[0]) - 1 : startY - 1;
      for (var y = startY; y <= endY; y++) {
        if (!yearly[y]) yearly[y] = { paid: 0, remaining: 0 };
        if (y <= paidUntil) yearly[y].paid += premium;
        else yearly[y].remaining += premium;
      }
    });
    var totalPaid = 0, totalAll = 0;
    Object.keys(yearly).forEach(function(y) {
      totalPaid += yearly[y].paid;
      totalAll += yearly[y].paid + yearly[y].remaining;
    });
    return { yearly: yearly, totalPaid: totalPaid, totalAll: totalAll, noPeriodCount: noPeriodCount };
  },

  // 卡片用：仅返回 totalPaid
  calcInsurancePaidTotal() {
    return this.calcInsuranceYearlyBreakdown().totalPaid;
  },

  saveInsurance() {
    var policy = { company:document.getElementById("insuranceCompany").value, product:document.getElementById("insuranceProduct").value, person:document.getElementById("insurancePerson").value, premium:document.getElementById("insurancePremium").value, freq:document.getElementById("insuranceFreq").value, nextPayDate:document.getElementById("insuranceNextPay").value, expireDate:document.getElementById("insuranceExpire").value };
    // 自动调整日期
    policy.nextPayDate = this.adjustNextPayDate(policy);
    Storage.add(Storage.keys.insurance, policy);
    document.getElementById("insuranceForm").reset(); this.setTodayDates();
    document.getElementById("insuranceFormModal").classList.remove("show");
    this.loadInsuranceList(); this.loadDashboard(); this.showToast("保单已保存");
  },

  editInsurance(id) {
    const list = Storage.get(Storage.keys.insurance);
    const item = list.find(i => i.id === id);
    if (!item) return;
    const newDate = prompt("修改「" + item.product + "」下次缴费日期:", item.nextPayDate || "");
    if (newDate !== null) { Storage.update(Storage.keys.insurance, id, { nextPayDate:newDate }); this.loadInsuranceList(); this.showToast("缴费日期已更新"); }
  },

  deleteInsurance(id) {
    if (!confirm("确定删除此保单？")) return;
    Storage.delete(Storage.keys.insurance, id);
    this.loadInsuranceList(); this.loadDashboard(); this.showToast("保单已删除");
  },

  loadStockList() {
    console.log('[App] loadStockList 开始');
    try {
      var list = Storage.get(Storage.keys.stocks);
      console.log('[App] 股票数据条数:', list.length);
      var container = document.getElementById("stockList");
      var totalValueEl = document.getElementById("stockTotalValue");
      var totalCostEl = document.getElementById("stockTotalCost");
      var profitLossEl = document.getElementById("stockProfitLoss");

      console.log('[App] DOM元素: stockList=' + !!container + ' totalValue=' + !!totalValueEl + ' totalCost=' + !!totalCostEl + ' profitLoss=' + !!profitLossEl);

      var totalValueCNY = 0, totalCostCNY = 0;
      if (list.length === 0) {
        if (container) container.innerHTML = "<div class=\"empty-tip\">暂无股票记录</div>";
        if (totalValueEl) totalValueEl.textContent = "¥0.00";
        if (totalCostEl) totalCostEl.textContent = "¥0.00";
        if (profitLossEl) profitLossEl.textContent = "¥0.00";
        console.log('[App] loadStockList: 无数据');
        return;
      }

      var self = this;
      var html = "";
      list.forEach(function(item) {
        var shares = parseInt(item.shares) || 0;
        var cost = parseFloat(item.cost) || 0;
        var price = parseFloat(item.currentPrice) || cost;
        var currency = item.currency || "CNY";
        var value = shares * price;                     // 原币种市值
        var costTotal = shares * cost;                   // 原币种成本
        var profit = value - costTotal;                  // 原币种盈亏
        var valueCNY = self.toCNY(value, currency);      // 人民币市值
        var costCNY = self.toCNY(costTotal, currency);   // 人民币成本
        var profitCNY = valueCNY - costCNY;              // 人民币盈亏
        totalValueCNY += valueCNY;
        totalCostCNY += costCNY;
        var colorClass = profit >= 0 ? "income" : "expense";

        console.log('[App] 渲染股票:', item.code, item.name, 'shares=' + shares, 'cost=' + cost, 'price=' + price, 'value=' + value, 'currency=' + currency, 'rate=' + self.getFxRate(currency));

        // 原币种显示的格式符号
        var currencySymbol = currency === "USD" ? "$" : (currency === "HKD" ? "HK$" : "¥");

        html += "<div class=\"record-item\">" +
          "<div class=\"record-info\">" +
            "<div class=\"record-title\">" + item.name + "（" + item.code + "）</div>" +
            "<div class=\"record-detail\">" +
              "持有 " +
              "<span class=\"inline-editable\" data-type=\"stock-shares\" data-id=\"" + item.id + "\">" + shares + "</span>" +
              " 股 · 成本 " + currencySymbol + self._formatNum(cost) + " · 现价 " + currencySymbol + self._formatNum(price) +
            "</div>" +
            "<div class=\"record-detail\" style=\"font-size:12px;color:#94a3b8;\">" +
              "券商: " + (item.broker || "—") + (item.accountNo ? " · " + item.accountNo : "") +
              " · " + currency +
              " · 汇率: " + self.getFxRate(currency).toFixed(4) +
            "</div>" +
          "</div>" +
          "<div class=\"record-amount " + colorClass + "\">" + self.formatMoney(valueCNY) +
            "<div style=\"font-size:12px;\">" + (profitCNY >= 0 ? "+" : "") + self.formatMoney(profitCNY) + "</div>" +
          "</div>" +
          "<div class=\"record-actions\">" +
            "<button onclick=\"App.deleteStock('" + item.id + "')\" title=\"删除\">" + self.icon('delete') + "</button>" +
          "</div>" +
          "<div class=\"stock-chart-inner\" id=\"stockChartInner_" + item.code + "\">" +
            "<div class=\"stock-chart-change-inline\" id=\"stockChartCanvas_" + item.code + "_change\"></div>" +
            "<div class=\"stock-chart-canvas-wrap\">" +
              "<canvas id=\"stockChartCanvas_" + item.code + "\"></canvas>" +
              "<div class=\"stock-chart-loading\" id=\"stockChartCanvas_" + item.code + "_loading\">加载中...</div>" +
              "<div class=\"stock-chart-error\" id=\"stockChartCanvas_" + item.code + "_error\" style=\"display:none;\">暂无数据</div>" +
            "</div>" +
          "</div>" +
        "</div>";
      });

      if (container) container.innerHTML = html;
      var totalProfitCNY = totalValueCNY - totalCostCNY;
      if (totalValueEl) totalValueEl.textContent = self.formatMoney(totalValueCNY);
      if (totalCostEl) totalCostEl.textContent = self.formatMoney(totalCostCNY);
      if (profitLossEl) {
        profitLossEl.textContent = (totalProfitCNY >= 0 ? "+" : "") + self.formatMoney(totalProfitCNY);
        // 浮动盈亏卡片始终用 text-white 类显示白色（不随盈亏变色）
      }
      // 渲染汇率走势卡片（含实时汇率）
      self._renderFxTrendCharts();
      console.log('[App] loadStockList 完成: 总市值(CNY)=' + totalValueCNY + ' 总成本(CNY)=' + totalCostCNY + ' 盈亏(CNY)=' + totalProfitCNY);
      // 注意：renderStockCharts() 已移至 loadRsuList() 末尾，确保 RSU DOM 已就绪
    } catch(e) {
      console.error('[App] loadStockList 异常:', e);
      var container = document.getElementById("stockList");
      if (container) container.innerHTML = "<div class=\"empty-tip\" style=\"color:red;\">加载出错: " + e.message + "</div>";
    }
  },

  saveStock() {
    var market = document.getElementById("stockMarket").value || "CN";
    var currencyMap = { CN: "CNY", HK: "HKD", US: "USD" };
    var currency = currencyMap[market] || "CNY";
    const currentPrice = document.getElementById("stockCurrentPrice").value || document.getElementById("stockCost").value;
    Storage.add(Storage.keys.stocks, {
      id: document.getElementById("stockCode").value,
      code: document.getElementById("stockCode").value,
      name: document.getElementById("stockName").value,
      shares: document.getElementById("stockShares").value,
      cost: document.getElementById("stockCost").value,
      currentPrice: currentPrice,
      currency: currency,
      market: market,
      broker: document.getElementById("stockBroker").value || "",
      accountNo: ""
    });
    document.getElementById("stockForm").reset();
    document.getElementById("stockFormModal").classList.remove("show");
    this.loadStockList(); this.showToast("股票已添加");
  },

  deleteStock(id) {
    if (!confirm("确定删除此股票？")) return;
    Storage.delete(Storage.keys.stocks, id);
    this.loadStockList();
    this.loadDashboard();
    // 直接渲染图表（使用内存缓存，已缓存的股票瞬间完成）
    var self = this;
    setTimeout(function() { self.renderStockCharts(); }, 50);
    this.showToast("股票已删除");
  },

  editStockPrice(id) {
    const list = Storage.get(Storage.keys.stocks);
    const stock = list.find(s => s.id === id);
    if (!stock) return;
    const newPrice = prompt("修改 " + stock.name + " 的当前价格:", stock.currentPrice || stock.cost);
    if (newPrice && !isNaN(parseFloat(newPrice))) { Storage.update(Storage.keys.stocks, id, { currentPrice:parseFloat(newPrice) }); this.loadStockList(); this.showToast("价格已更新"); }
  },

  // ===== 房贷导入 =====
  checkLoanImportStatus() {
    if (typeof LOAN_HOLDINGS === "undefined") return;
    var stored = Storage.get(Storage.keys.loans);
    if (stored.length === 0) {
      console.log('[房贷] localStorage 为空，执行全量导入');
      this.importLoanData();
      return;
    }
    // 比较：如果 LOAN_HOLDINGS 中有新数据则合并
    var changed = false;
    LOAN_HOLDINGS.forEach(function(src) {
      var found = stored.find(function(s) {
        return s.contractNo === src.contractNo || s.accountNo === src.accountNo;
      });
      if (!found) changed = true;
    });
    if (changed) {
      console.log('[房贷] 检测到新数据，合并导入');
      this.importLoanData();
    }
  },

  importLoanData() {
    if (typeof LOAN_HOLDINGS === "undefined") return;
    var stored = Storage.get(Storage.keys.loans, true); // 包含已删除，便于修复旧 ID
    var merged = [].concat(stored);
    var added = 0, idFixed = 0;
    LOAN_HOLDINGS.forEach(function(src) {
      var stableId = src.contractNo;
      var found = merged.find(function(s) {
        return s.contractNo === src.contractNo || s.accountNo === src.accountNo;
      });
      if (!found) {
        src.id = stableId;
        src.createdAt = new Date().toISOString();
        merged.push(src);
        added++;
        console.log('[房贷] 新增: ' + src.bank);
      } else if (found.id !== stableId) {
        // 修复已有记录 ID 为合同号
        var idx = merged.findIndex(function(s) { return s.id === found.id; });
        if (idx !== -1) {
          merged[idx].id = stableId;
          merged[idx].updatedAt = new Date().toISOString();
          idFixed++;
          console.log('[房贷] 修复 ID:', found.id, '→', stableId);
        }
      }
    });
    Storage.set(Storage.keys.loans, merged);
    this.loadLoanList();
    if (added > 0 || idFixed > 0) {
      this.loadDashboard();
      var msg = added > 0 ? ("已导入 " + added + " 笔房贷") : "";
      msg += idFixed > 0 ? (msg ? "，" : "") + "已修复 " + idFixed + " 笔 ID" : "";
      this.showToast(msg);
    }
  },

  // 等额本息月供计算
  calcMonthlyPayment(total, annualRate, months) {
    if (!total || !annualRate || !months || months <= 0) return 0;
    var mr = annualRate / 100 / 12; // 月利率
    if (mr === 0) return total / months;
    var factor = Math.pow(1 + mr, months);
    return (total * mr * factor) / (factor - 1);
  },

  // ===== 房贷自动进度计算 =====
  // 输入: loan 对象 { total, rate, term, startDate, payDay, mode }
  // 输出: {
  //   elapsed: 已还期数,
  //   total: 总期数,
  //   paidPrincipal: 已还本金,
  //   remainingPrincipal: 剩余本金（按原还款计划推算）,
  //   percent: 还款进度百分比,
  //   monthlyPayment: 当前月供（基于剩余本金与剩余期数重新计算）,
  //   nextPayDate: 下次还款日,
  //   monthsRemaining: 剩余期数,
  //   totalInterest: 已还累计利息,
  //   remainingInterest: 剩余应还利息,
  //   isFinished: 是否已还清,
  //   basis: 计算依据描述字符串
  // }
  calcLoanProgress(loan, today) {
    today = today ? new Date(today) : new Date();
    today.setHours(0, 0, 0, 0);

    var total = parseFloat(loan.total) || 0;
    var rate = parseFloat(loan.rate) || 0;
    var term = parseInt(loan.term) || 0;       // 年
    var months = term * 12;                     // 总期数
    var mode = loan.mode || 'equal-payment';   // equal-payment | equal-principal
    var payDay = parseInt(loan.payDay) || 17;   // 每月还款日（默认 17 号）
    var startStr = loan.startDate;

    // 解析起始日
    function parseDate(d) {
      if (!d) return null;
      var p = d.split('-');
      return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
    }
    var startDate = parseDate(startStr);

    // 月份差（d2 - d1）
    function monthDiff(d1, d2) {
      return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    }

    // 计算下个月还款日
    function getNextPayDate(start, payDay, today) {
      var elapsed = monthDiff(start, today);
      // 第 elapsed+1 期还款日
      var next = new Date(start.getFullYear(), start.getMonth() + elapsed + 1, payDay);
      // 如果 today 还在第 elapsed+1 期之前（即本期还没到还款日），应该返回本期
      var cur = new Date(start.getFullYear(), start.getMonth() + elapsed, payDay);
      if (today < cur) return cur;
      return next;
    }

    if (months <= 0 || total <= 0) {
      return {
        elapsed: 0, total: 0, paidPrincipal: 0, remainingPrincipal: total,
        percent: 0, monthlyPayment: 0, nextPayDate: null, monthsRemaining: 0,
        totalInterest: 0, remainingInterest: 0, isFinished: false, basis: '数据不完整'
      };
    }

    var mr = rate / 100 / 12;
    var principalPerMonth = total / months;

    // 已还期数（基于日期推算）
    var elapsed = 0;
    if (startDate) {
      if (today < startDate) {
        elapsed = 0;
      } else {
        elapsed = monthDiff(startDate, today);
        // 如果本月还款日还没到，elapsed 减 1（本期还没还）
        var thisMonthPayDate = new Date(today.getFullYear(), today.getMonth(), payDay);
        if (today < thisMonthPayDate) elapsed -= 1;
        if (elapsed < 0) elapsed = 0;
        if (elapsed > months) elapsed = months;
      }
    }

    var isFinished = elapsed >= months;
    var paidPrincipal = 0;
    var totalInterest = 0;
    var remainingPrincipal = 0;

    if (mode === 'equal-principal') {
      // 等额本金：每月本金固定
      paidPrincipal = principalPerMonth * elapsed;
      if (isFinished) paidPrincipal = total;
      // 已还累计利息 = mr * Σ(总-(i-1)*principalPerMonth)
      var sumRemaining = 0;
      for (var i = 0; i < elapsed; i++) {
        sumRemaining += (total - i * principalPerMonth);
      }
      totalInterest = mr * sumRemaining;
      remainingPrincipal = Math.max(0, total - paidPrincipal);
    } else {
      // 等额本息：用原始月供逐期推算剩余本金
      var origMonthly = this.calcMonthlyPayment(total, rate, months);
      var balance = total;
      for (var j = 0; j < elapsed; j++) {
        var interest = balance * mr;
        var principalPart = origMonthly - interest;
        balance -= principalPart;
        if (balance < 0.01) balance = 0;
        paidPrincipal += principalPart;
        totalInterest += interest;
      }
      if (isFinished) paidPrincipal = total;
      remainingPrincipal = Math.max(0, balance);
    }

    var percent = total > 0 ? (paidPrincipal / total * 100) : 0;
    var nextPayDate = startDate ? getNextPayDate(startDate, payDay, today) : null;
    var monthsRemaining = Math.max(0, months - elapsed);

    // 基于剩余本金与剩余期数重新计算当前月供 / 剩余利息
    var monthlyPayment = 0;
    var remainingInterest = 0;
    if (monthsRemaining > 0) {
      if (mode === 'equal-principal') {
        // 等额本金：当前月还款 = 固定本金 + 当前剩余本金产生的利息（逐月递减）
        monthlyPayment = principalPerMonth + remainingPrincipal * mr;
        // 剩余利息 = mr * Σ(remainingPrincipal - k*principalPerMonth), k=0..monthsRemaining-1
        remainingInterest = mr * (monthsRemaining * remainingPrincipal -
          principalPerMonth * monthsRemaining * (monthsRemaining - 1) / 2);
      } else {
        // 等额本息：用剩余本金和剩余期数重新计算月供
        monthlyPayment = this.calcMonthlyPayment(remainingPrincipal, rate, monthsRemaining);
        remainingInterest = monthlyPayment * monthsRemaining - remainingPrincipal;
      }
    }
    if (remainingInterest < 0) remainingInterest = 0;

    var basis = term + '年' + (mode === 'equal-principal' ? '等额本金' : '等额本息') +
                ' · 利率 ' + rate.toFixed(2) + '%' +
                ' · ' + startStr + ' 起 · 每月 ' + payDay + '号';

    return {
      elapsed: elapsed,
      total: months,
      paidPrincipal: paidPrincipal,
      remainingPrincipal: remainingPrincipal,
      percent: percent,
      monthlyPayment: monthlyPayment,
      nextPayDate: nextPayDate,
      monthsRemaining: monthsRemaining,
      totalInterest: totalInterest,
      remainingInterest: remainingInterest,
      isFinished: isFinished,
      basis: basis
    };
  },

  loadLoanList() {
    const loans = Storage.get(Storage.keys.loans);
    const pc = document.getElementById("loanProgressList");
    if (loans.length === 0) {
      pc.innerHTML = "<div class=\"empty-tip\">暂无房贷记录</div>";
      return;
    }

    var self = this;
    var today = new Date(); today.setHours(0, 0, 0, 0);

    function totalSafe(v) { return parseFloat(v) || 0; }
    function formatDate(d) {
      if (!d) return "—";
      return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, '0') + "-" +
        String(d.getDate()).padStart(2, '0');
    }

    let pHtml = "";
    loans.forEach(loan => {
      // 兼容旧数据：补齐 mode/payDay/autoProgress
      if (!loan.mode) loan.mode = 'equal-payment';
      if (!loan.payDay) loan.payDay = 17;
      if (typeof loan.autoProgress === 'undefined') loan.autoProgress = true;

      var prog = self.calcLoanProgress(loan, new Date(today));
      // 取最终显示的"已还本金"
      var displayPaid = loan.autoProgress ? prog.paidPrincipal : (parseFloat(loan.paid) || 0);
      var displayPct = totalSafe(loan.total) > 0 ? (displayPaid / totalSafe(loan.total) * 100) : 0;
      var displayRest = Math.max(0, totalSafe(loan.total) - displayPaid);

      var isAuto = loan.autoProgress;

      pHtml += '<div class="loan-card" data-loan-id="' + loan.id + '">';
      // 标题行
      pHtml += '<div class="loan-card-head">';
      pHtml += '<div class="loan-card-title">';
      pHtml += '<strong>' + self.escapeHtml(loan.bank) + '</strong>';
      pHtml += '<span class="loan-mode-badge">' + (loan.mode === 'equal-principal' ? '等额本金' : '等额本息') + '</span>';
      pHtml += '</div>';
      pHtml += '<div class="loan-card-actions">';
      // 自动/手动 toggle
      pHtml += '<button class="loan-auto-toggle ' + (isAuto ? 'on' : 'off') + '" onclick="App.toggleLoanProgress(\'' + loan.id + '\')" title="' + (isAuto ? '当前: 自动计算 (点击切换为手动)' : '当前: 手动输入 (点击切换为自动)') + '">';
      pHtml += '<span class="loan-auto-dot"></span>';
      pHtml += '<span class="loan-auto-text">' + (isAuto ? '自动' : '手动') + '</span>';
      pHtml += '</button>';
      // 进度百分比
      pHtml += '<span class="loan-pct">' + displayPct.toFixed(1) + '% 已还</span>';
      // 删除
      pHtml += '<button class="loan-card-delete" onclick="App.deleteLoan(\'' + loan.id + '\')" title="删除">' + self.icon('delete') + '</button>';
      pHtml += '</div>';
      pHtml += '</div>';

      // 进度条
      pHtml += '<div class="progress-bar" style="margin-bottom:12px;"><div class="progress-fill" style="width:' + displayPct + '%;background:linear-gradient(90deg,#4ade80,#86efac);"></div></div>';

      // 详情 grid
      pHtml += '<div class="loan-card-grid">';
      pHtml += '<div>贷款总额: <b>' + self.formatMoney(totalSafe(loan.total)) + '</b></div>';
      // 已还本金: 自动模式显示数字；手动模式显示可编辑 input
      if (isAuto) {
        pHtml += '<div>已还本金: <b>' + self.formatMoney(displayPaid) + '</b></div>';
      } else {
        pHtml += '<div>已还本金: <input type="number" class="loan-paid-input" data-loan-id="' + loan.id + '" value="' + displayPaid.toFixed(2) + '" step="0.01" min="0" max="' + totalSafe(loan.total) + '"></div>';
      }
      pHtml += '<div>剩余本金: <b class="text-danger">' + self.formatMoney(displayRest) + '</b></div>';
      pHtml += '<div>利率: <b>' + totalSafe(loan.rate).toFixed(2) + '%</b>' + (loan.rateType ? " (" + loan.rateType + ")" : "") + '</div>';
      pHtml += '<div>月供: <b>' + self.formatMoney(prog.monthlyPayment) + '</b></div>';
      pHtml += '<div>剩余期数: <b>' + prog.monthsRemaining + '月</b> / ' + prog.total + '月</div>';
      pHtml += '<div>剩余利息: <b class="text-warning">' + self.formatMoney(prog.remainingInterest) + '</b></div>';
      pHtml += '<div>期限: ' + (loan.startDate || "—") + ' → ' + (loan.endDate || "—") + '</div>';
      if (prog.nextPayDate) {
        pHtml += '<div>下次还款: ' + formatDate(prog.nextPayDate) + '</div>';
      }
      pHtml += '</div>';

      // 计算依据
      pHtml += '<div class="loan-card-basis">';
      if (isAuto) {
        pHtml += '<span class="basis-icon">⚙️</span> 自动推算: ' + prog.basis + ' · 已还 ' + prog.elapsed + ' 期 · 剩余利息 ' + self.formatMoney(prog.remainingInterest).replace('¥', '') + ' 元';
      } else {
        pHtml += '<span class="basis-icon">✋</span> 手动输入: 数据未参与自动推算';
        // 显示保存按钮（仅手动模式）
        pHtml += '<button class="loan-save-paid" onclick="App._saveLoanManualPaid(this)">保存</button>';
      }
      pHtml += '</div>';

      pHtml += '</div>'; // .loan-card
    });
    pc.innerHTML = pHtml;
  },

  // 从事件源 input 取值保存（onclick 写在 HTML 里取不到 this.value，所以用辅助方法）
  _saveLoanManualPaid(btn) {
    var card = btn.closest('.loan-card');
    if (!card) return;
    var input = card.querySelector('.loan-paid-input');
    if (!input) return;
    this.saveLoanManualPaid(input.getAttribute('data-loan-id'), input.value);
  },

  saveLoan() {
    Storage.add(Storage.keys.loans, {
      bank: document.getElementById("loanBank").value,
      property: document.getElementById("loanProperty").value,
      total: document.getElementById("loanTotal").value,
      paid: document.getElementById("loanPaid").value || 0,
      rate: document.getElementById("loanRate").value,
      term: document.getElementById("loanTerm").value,
      startDate: document.getElementById("loanStartDate").value,
      mode: document.getElementById("loanMode").value,
      payDay: document.getElementById("loanPayDay").value || 17,
      autoProgress: document.getElementById("loanAutoProgress").checked
    });
    document.getElementById("loanForm").reset();
    document.getElementById("loanPayDay").value = 17;
    document.getElementById("loanAutoProgress").checked = true;
    this.setTodayDates();
    document.getElementById("loanFormModal").classList.remove("show");
    this.loadLoanList();
    this.showToast("房贷记录已保存");
  },

  // 切换单条房贷的自动/手动进度模式
  toggleLoanProgress(id) {
    var loans = Storage.get(Storage.keys.loans);
    var loan = loans.find(function(l) { return l.id === id; });
    if (!loan) return;
    loan.autoProgress = !loan.autoProgress;
    Storage.set(Storage.keys.loans, loans);
    this.loadLoanList();
    this.showToast(loan.autoProgress ? '已切换为自动计算' : '已切换为手动输入');
  },

  // 保存手动覆盖的"已还本金"
  saveLoanManualPaid(id, value) {
    var v = parseFloat(value);
    if (isNaN(v) || v < 0) {
      this.showToast('请输入有效的本金金额', 'error');
      return false;
    }
    var loans = Storage.get(Storage.keys.loans);
    var loan = loans.find(function(l) { return l.id === id; });
    if (!loan) return false;
    if (v > parseFloat(loan.total)) {
      this.showToast('已还本金不能超过贷款总额', 'error');
      return false;
    }
    loan.paid = v;
    Storage.set(Storage.keys.loans, loans);
    this.loadLoanList();
    this.showToast('已保存手动进度');
    return true;
  },

  deleteLoan(id) {
    if (!confirm("确定删除此房贷记录？")) return;
    Storage.delete(Storage.keys.loans, id);
    this.loadLoanList(); this.showToast("房贷记录已删除");
  },

  // ========== 年金管理 ==========

  // 检查是否需要导入预设年金数据
  checkAnnuityImportStatus() {
    var list = Storage.get(Storage.keys.annuities);
    if (list.length === 0 && typeof ANNUITY_HOLDINGS !== "undefined" && ANNUITY_HOLDINGS.length > 0) {
      this.importAnnuityData();
    }
  },

  importAnnuityData() {
    var list = Storage.get(Storage.keys.annuities, true); // 包含已删除，便于修复旧 ID
    var added = 0;
    var idFixed = 0;
    var self = this;
    ANNUITY_HOLDINGS.forEach(function(a) {
      var exists = list.find(function(item) { return item.code === a.code; });
      if (!exists) {
        a.id = a.code;
        a.createdAt = new Date().toISOString();
        list.push({...a});
        added++;
      } else if (exists.id !== a.code) {
        var idx = list.findIndex(function(item) { return item.id === exists.id; });
        if (idx !== -1) {
          list[idx].id = a.code;
          list[idx].updatedAt = new Date().toISOString();
          idFixed++;
          console.log('[App] 修复年金 ID:', exists.id, '→', a.code);
        }
      }
    });
    Storage.set(Storage.keys.annuities, list);
    this.renderAnnuityPage();
    this.loadDashboard();
    this.showToast(added > 0 ? ("已导入 " + added + " 个年金组合") : (idFixed > 0 ? ("已修复 " + idFixed + " 个年金组合 ID") : "年金数据已是最新"));
  },

  loadAnnuityList() { this.renderAnnuityPage(); },

  renderAnnuityPage() {
    var list = Storage.get(Storage.keys.annuities);
    var self = this;
    var chartSection = document.getElementById("annuityChartSection");
    var detailList = document.getElementById("annuityDetailList");
    if (!chartSection || !detailList) return;

    if (list.length === 0) {
      chartSection.innerHTML = '<div class="empty-tip">暂无年金数据，请先导入预设数据</div>';
      detailList.innerHTML = '';
      return;
    }

    var total = 0;
    list.forEach(function(a) { total += parseFloat(a.balance) || 0; });
    // 按余额从大到小
    list.sort(function(a, b) { return (parseFloat(b.balance) || 0) - (parseFloat(a.balance) || 0); });

    // ==== 环形图 ====
    var colors = ["#4ade80", "#38bdf8", "#a78bfa", "#fbbf24", "#fb923c", "#f87171"];
    var cx = 140, cy = 140, rOuter = 100, rInner = 62;
    var cumulative = 0;
    var slicesSvg = "";
    var legendHtml = "";
    list.forEach(function(item, i) {
      var val = parseFloat(item.balance) || 0;
      var pct = total > 0 ? val / total : 0;
      var startAngle = cumulative * Math.PI * 2;
      var endAngle = (cumulative + pct) * Math.PI * 2;
      cumulative += pct;
      var x1 = cx + rOuter * Math.sin(startAngle);
      var y1 = cy - rOuter * Math.cos(startAngle);
      var x2 = cx + rOuter * Math.sin(endAngle);
      var y2 = cy - rOuter * Math.cos(endAngle);
      var largeArc = pct > 0.5 ? 1 : 0;
      var d = "M" + cx + " " + cy +
        " L" + x1.toFixed(1) + " " + y1.toFixed(1) +
        " A" + rOuter + " " + rOuter + " 0 " + largeArc + " 1 " + x2.toFixed(1) + " " + y2.toFixed(1) +
        " Z";
      var color = colors[i % colors.length];
      slicesSvg += '<path d="' + d + '" fill="' + color + '" opacity="0.9"/>';
      legendHtml += '<div class="annuity-legend-item">' +
        '<span class="annuity-legend-dot" style="background:' + color + '"></span>' +
        '<span class="annuity-legend-name">' + self.escapeHtml(item.name) + '</span>' +
        '<span class="annuity-legend-pct">' + (pct * 100).toFixed(1) + '%</span>' +
        '</div>';
    });

    var svgHtml = '<svg viewBox="0 0 320 320" class="annuity-donut">' +
      slicesSvg +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + rInner + '" fill="var(--card-bg)"/>' +
      '<text x="' + cx + '" y="' + (cy - 20) + '" text-anchor="middle" class="annuity-donut-label">年金总额</text>' +
      '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" class="annuity-donut-value">' + self.formatMoney(total).replace("¥","") + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 38) + '" text-anchor="middle" class="annuity-donut-suffix">元</text>' +
      '</svg>';

    chartSection.innerHTML = '<div class="annuity-chart-wrap">' + svgHtml +
      '<div class="annuity-legend">' + legendHtml + '</div></div>';

    // ==== 投资明细 ====
    var detailHtml = "";
    list.forEach(function(item, i) {
      var color = colors[i % colors.length];
      var riskColor = { "R1": "#4ade80", "R2": "#38bdf8", "R3": "#fbbf24", "R4": "#fb923c", "R5": "#ef4444" };
      var risk = item.risk || "R2-中低风险";
      var riskKey = risk.charAt(0);
      var badgeColor = riskColor[riskKey] || "#38bdf8";
      var pct = total > 0 ? ((parseFloat(item.balance) || 0) / total * 100) : 0;

      detailHtml += '<div class="annuity-detail-card">' +
        '<div class="annuity-detail-left">' +
        '<div class="annuity-detail-bar" style="background:' + color + '"></div>' +
        '<div class="annuity-detail-info">' +
        '<div class="annuity-detail-name">' + self.escapeHtml(item.name) + '</div>' +
        '<div class="annuity-detail-meta">' +
        (item.planName ? '<span>' + self.escapeHtml(item.planName) + '</span>' : '') +
        (item.manager ? '<span> · ' + self.escapeHtml(item.manager) + '</span>' : '') +
        '<span class="annuity-risk-badge" style="color:' + badgeColor + '">' + self.escapeHtml(risk) + '</span>' +
        (item.lastUpdate ? '<span> · 净值日期 ' + self.escapeHtml(item.lastUpdate) + '</span>' : '') +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="annuity-detail-right">' +
        '<div class="annuity-detail-amount">' + self.formatMoney(item.balance) + '</div>' +
        '<div class="annuity-detail-pct" style="color:' + color + '">' + pct.toFixed(1) + '%</div>' +
        '</div>' +
        '</div>';
    });
    detailList.innerHTML = detailHtml;
  },

  // ── 退休计算 ──
  // 基于当前资产，回答：今天能不能退休？还差多少钱？
  _retirementCalcTimer: null,
  _retirementParams: null,

  // 基本养老保险（来自截图：本息总额 460,126.76，个人缴费 2,984.16/月，累计 197 个月；成员2先按相同）
  RETIREMENT_PENSION: {
    member1: { name: '王典', birthYear: 1983, gender: 'male', retireAge: 63, accountBalance: 460126.76, monthsPaid: 197, monthlyContribution: 2984.16 },
    member2: { name: 'Rowen', birthYear: 1983, gender: 'female', retireAge: 58, accountBalance: 460126.76, monthsPaid: 197, monthlyContribution: 2984.16 }
  },

  // 保险年金收入（以 Excel 领取核算为准，单位：元/年）
  // 年龄 -> { annual, lumpSum }
  // 注意：仅包含 4 份固定年金（优享年年、友未来×2、悦享年年）+ 69 岁双赢两全一次性领取
  // 2 份友邦自在宝终身寿险（万能型）已被明确排除，不参与退休现金流计算
  RETIREMENT_INSURANCE_INCOME: (function() {
    var map = {};
    // 60-80岁：友享年年20551 + 友未来×2共60000 + 悦享年12564 = 93115/年
    for (var age = 60; age <= 80; age++) { map[age] = { annual: 93115 }; }
    // 69岁（2052年）加双赢两全一次性领取
    map[69] = { annual: 93115, lumpSum: 208700 }; // 104400+104300
    // 81-85岁：友享年年和悦享年已结束，只剩友未来×2 = 60000/年
    for (var age = 81; age <= 85; age++) { map[age] = { annual: 60000 }; }
    // 86岁及以上：友未来也结束，无确定年金收入
    for (var age = 86; age <= 100; age++) { map[age] = { annual: 0 }; }
    return map;
  })(),

  // 初始化退休计算（30 秒延迟，降低同步负载）
  scheduleRetirementCalculation() {
    var self = this;
    if (this._retirementCalcTimer) clearTimeout(this._retirementCalcTimer);
    this._retirementCalcTimer = setTimeout(function() {
      console.log('[退休计算] 30 秒延迟结束，开始计算');
      self._retirementParams = self._loadRetirementParams();
      self._retirementCache = self.calculateRetirement(self._retirementParams);
      if (self.currentPage === 'retirement') {
        self.renderRetirementPage();
      }
    }, 30000);
  },

  loadRetirementPage() {
    var self = this;
    // 恢复参数控件
    this._retirementParams = this._loadRetirementParams();
    this._bindRetirementInputs();

    // 如果还没有缓存，立即计算一次（用户首次进入）
    if (!this._retirementCache) {
      this._retirementCache = this.calculateRetirement(this._retirementParams);
    }
    this.renderRetirementPage();

    // 30 秒后基于最新数据重新计算（异步，不阻塞）
    this.scheduleRetirementCalculation();
  },

  _loadRetirementParams() {
    var defaults = {
      annualExpense: 20, annualEducation: 10, educationEndYear: 2035, annualExtraIncome: 0,
      inflation: 3, investmentReturn: 2, lifeExpectancy: 90, mortgagePayoffMode: 'lump',
      pensionMember1Balance: 460126.76, pensionMember1Monthly: 2984.16, pensionMember1RetireAge: 63,
      pensionMember2Balance: 460126.76, pensionMember2Monthly: 2984.16, pensionMember2RetireAge: 58
    };
    try {
      var saved = localStorage.getItem('fm_retirement_params');
      if (saved) defaults = Object.assign(defaults, JSON.parse(saved));
    } catch(e) {}
    return defaults;
  },

  _saveRetirementParams(params) {
    try {
      localStorage.setItem('fm_retirement_params', JSON.stringify(params));
    } catch(e) {}
  },

  _bindRetirementInputs() {
    var self = this;
    var inputs = {
      annualExpense: 'retirementParamAnnualExpense',
      annualEducation: 'retirementParamAnnualEducation',
      educationEndYear: 'retirementParamEducationEndYear',
      annualExtraIncome: 'retirementParamAnnualExtraIncome',
      inflation: 'retirementParamInflation',
      investmentReturn: 'retirementParamReturn',
      lifeExpectancy: 'retirementParamLifeExpectancy',
      pensionMember1Balance: 'retirementParamPensionMember1Balance',
      pensionMember1Monthly: 'retirementParamPensionMember1Monthly',
      pensionMember1RetireAge: 'retirementParamPensionMember1RetireAge',
      pensionMember2Balance: 'retirementParamPensionMember2Balance',
      pensionMember2Monthly: 'retirementParamPensionMember2Monthly',
      pensionMember2RetireAge: 'retirementParamPensionMember2RetireAge'
    };

    function updateLabel(key, value) {
      var el = document.getElementById(inputs[key] + 'Value');
      if (!el) return;
      var text = value;
      if (key === 'inflation' || key === 'investmentReturn') text = value + ' %';
      else if (key === 'lifeExpectancy') text = value + ' 岁';
      else if (key === 'educationEndYear') text = value + ' 年';
      else if (key === 'annualExpense' || key === 'annualEducation' || key === 'annualExtraIncome') text = value + ' 万';
      else if (key.indexOf('Balance') >= 0) text = (value / 10000).toFixed(1) + ' 万';
      else if (key.indexOf('Monthly') >= 0) text = value + ' 元';
      else if (key.indexOf('RetireAge') >= 0) text = value + ' 岁';
      el.textContent = text;
    }

    Object.keys(inputs).forEach(function(key) {
      var el = document.getElementById(inputs[key]);
      if (!el) return;
      el.value = self._retirementParams[key];
      updateLabel(key, el.value);
      el.addEventListener('input', function() {
        var val = parseFloat(el.value);
        if (isNaN(val)) return;
        self._retirementParams[key] = val;
        updateLabel(key, val);
        self._saveRetirementParams(self._retirementParams);
        self._retirementCache = self.calculateRetirement(self._retirementParams);
        self.renderRetirementPage();
      });
    });

    // 房贷还款方式单选
    var radios = document.getElementsByName('retirementParamMortgageMode');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = (radios[i].value === self._retirementParams.mortgagePayoffMode);
      radios[i].addEventListener('change', function() {
        if (this.checked) {
          self._retirementParams.mortgagePayoffMode = this.value;
          self._saveRetirementParams(self._retirementParams);
          self._retirementCache = self.calculateRetirement(self._retirementParams);
          self.renderRetirementPage();
        }
      });
    }
  },

  // 计算今天退休的可行性
  // 退休计算：核心模拟函数（纯函数，initialCash 作为参数）
  // 返回：{ years: [...], minEndBalance: Number, runOutYear: Number|null }
  _simulateRetirement(initialCash, currentYear, currentAge, endYear, params, schedules) {
    var balance = initialCash;
    var runOutYear = null;
    var minEndBalance = Infinity;
    var UNIVERSAL_INSURANCE_START_AGE = 60;
    var universalBalanceAt60 = schedules.universalBalanceAt60;
    var universalInsuranceBalance = 0;
    var years = [];

    for (var year = currentYear; year <= endYear; year++) {
      var age = currentAge + (year - currentYear);

      if (age === UNIVERSAL_INSURANCE_START_AGE) {
        universalInsuranceBalance = universalBalanceAt60;
      } else if (age > UNIVERSAL_INSURANCE_START_AGE) {
        universalInsuranceBalance = universalInsuranceBalance * 1.02;
      }

      var premium = schedules.premiumSchedule[year] || 0;
      var mortgage = schedules.mortgagePaymentSchedule[year] || 0;
      var education = (year <= currentYear + Math.max(0, params.educationEndYear - currentYear) - 1) ? (params.annualEducation * 10000) : 0;
      var expense = (params.annualExpense * 10000) * Math.pow(1 + params.inflation / 100, year - currentYear);
      var extraIncome = (params.annualExtraIncome * 10000) * Math.pow(1 + params.inflation / 100, year - currentYear);
      var pension = schedules.pensionSchedule[year] || 0;
      var insurance = schedules.insuranceSchedule[year] || 0;
      var enterpriseAnnuity = schedules.enterpriseAnnuitySchedule[year] || 0;
      var outflow = premium + mortgage + education + expense;
      var inflow = extraIncome + pension + insurance + enterpriseAnnuity;
      var netFlow = inflow - outflow;
      // 投资收益只对正资产计算；资产为负时不应再按收益率滚雪球（否则出现"收益越高负债越多"的反直觉现象）
      var investmentGain = balance > 0 ? balance * (params.investmentReturn / 100) : 0;
      var endBalance = balance + investmentGain + netFlow;

      // 创赢未来领取策略
      var universalWithdrawal = 0;
      if (endBalance < 0 && universalInsuranceBalance > 0) {
        universalWithdrawal = Math.min(-endBalance, universalInsuranceBalance);
        universalInsuranceBalance -= universalWithdrawal;
        endBalance += universalWithdrawal;
      }

      if (runOutYear === null && endBalance < 0) {
        runOutYear = year;
      }
      if (endBalance < minEndBalance) {
        minEndBalance = endBalance;
      }

      years.push({
        year: year, age: age, startBalance: balance, endBalance: endBalance,
        inflow: inflow, outflow: outflow, premium: premium, mortgage: mortgage,
        education: education, expense: expense, pension: pension, insurance: insurance,
        enterpriseAnnuity: enterpriseAnnuity, investmentGain: investmentGain,
        extraIncome: extraIncome,
        universalWithdrawal: universalWithdrawal,
        universalInsuranceBalance: universalInsuranceBalance
      });

      balance = endBalance;
    }

    return { years: years, minEndBalance: minEndBalance, runOutYear: runOutYear };
  },

  calculateRetirement(params) {
    var today = new Date(); today.setHours(0,0,0,0);
    var currentYear = today.getFullYear();
    var currentAge = 43;
    var endYear = currentYear + (params.lifeExpectancy - currentAge);

    // 1. 今天可用资产
    var cash = this._sumCashAccounts();
    var stocks = this._sumStocksCNY();
    var funds = this._sumFundsCNY();
    var liquidAssets = cash + stocks + funds;

    var debug_assetBreakdown = {
      cash: { total: cash, accounts: Storage.get(Storage.keys.cashAccounts) },
      stocks: { total: stocks, items: Storage.get(Storage.keys.stocks), fxRates: this._getFxRates() },
      funds: { total: funds, items: Storage.get(Storage.keys.funds) }
    };

    // 2. 房贷
    var loans = Storage.get(Storage.keys.loans);
    var mortgagePayoff = 0;
    loans.forEach(function(l) { mortgagePayoff += parseFloat(l.balance || 0); });
    var mortgagePayoffMode = params.mortgagePayoffMode || 'lump';
    var mortgagePaymentSchedule = (mortgagePayoffMode === 'monthly')
      ? this._buildMortgagePaymentSchedule(currentYear, endYear)
      : {};
    var actualInitialCash = liquidAssets - (mortgagePayoffMode === 'lump' ? mortgagePayoff : 0);

    // 3~6. 预计算所有时间表（与 initialCash 无关）
    var premiumSchedule = this._buildPremiumSchedule(currentYear, endYear);
    var pensionSchedule = this._buildPensionSchedule(currentYear, endYear, params);
    var insuranceSchedule = this._buildInsuranceIncomeSchedule(currentYear, endYear);
    var enterpriseAnnuitySchedule = this._buildEnterpriseAnnuitySchedule(currentYear, endYear);
    var universalBalanceAt60 = 695693.05 + 1045781.41;

    var schedules = {
      premiumSchedule: premiumSchedule,
      mortgagePaymentSchedule: mortgagePaymentSchedule,
      pensionSchedule: pensionSchedule,
      insuranceSchedule: insuranceSchedule,
      enterpriseAnnuitySchedule: enterpriseAnnuitySchedule,
      universalBalanceAt60: universalBalanceAt60
    };

    // 7. 二分搜索：找最小 initialCash，使得所有年份 minEndBalance >= 0
    // 搜索范围：[actualInitialCash, actualInitialCash + 10000万]
    var LO = actualInitialCash;
    var HI = actualInitialCash + 100000000; // 上限 1 亿
    var requiredInitialCash = actualInitialCash;
    var MAX_ITER = 60;

    var sim0 = this._simulateRetirement(actualInitialCash, currentYear, currentAge, endYear, params, schedules);
    if (sim0.minEndBalance < 0) {
      // 今天不能退休，需要搜索
      var HI_LO_history = [];
      for (var iter = 0; iter < MAX_ITER; iter++) {
        var MID = LO + Math.round((HI - LO) / 2);
        var sim = this._simulateRetirement(MID, currentYear, currentAge, endYear, params, schedules);
        if (sim.minEndBalance >= 0) {
          requiredInitialCash = MID;
          HI = MID - 1;
        } else {
          LO = MID + 1;
        }
        HI_LO_history.push('iter=' + iter + ' [' + LO.toFixed(0) + ',' + HI.toFixed(0) + '] MID=' + MID.toFixed(0) + ' minBal=' + sim.minEndBalance.toFixed(0));
        if (LO > HI) break;
      }
      console.log('[退休计算] 二分搜索过程:', HI_LO_history.join(' | '));
    }

    var shortfall = requiredInitialCash - actualInitialCash;
    var canRetire = shortfall <= 0;

    // 用实际资产跑模拟（用于画曲线，反映真实情况——可能有红有绿）
    var actualSim = this._simulateRetirement(actualInitialCash, currentYear, currentAge, endYear, params, schedules);
    var years = actualSim.years;
    var runOutYear = actualSim.runOutYear;

    console.log('[退休计算] 结果: actualInitialCash=' + actualInitialCash.toFixed(0)
      + ' requiredInitialCash=' + requiredInitialCash.toFixed(0)
      + ' shortfall=' + shortfall.toFixed(0)
      + ' canRetire=' + canRetire
      + ' runOutYear=' + runOutYear);

    return {
      today: today,
      currentYear: currentYear,
      currentAge: currentAge,
      liquidAssets: liquidAssets,
      mortgagePayoff: mortgagePayoff,
      mortgagePayoffMode: mortgagePayoffMode,
      mortgagePaymentSchedule: mortgagePaymentSchedule,
      initialCash: requiredInitialCash,
      actualInitialCash: actualInitialCash,
      years: years,
      runOutYear: runOutYear,
      shortfall: shortfall,
      canRetire: canRetire,
      params: params,
      debug: {
        assetBreakdown: debug_assetBreakdown,
        fxRates: this._getFxRates(),
        premiumSchedule: premiumSchedule,
        pensionSchedule: pensionSchedule,
        insuranceSchedule: insuranceSchedule,
        enterpriseAnnuitySchedule: enterpriseAnnuitySchedule,
        mortgagePaymentSchedule: mortgagePaymentSchedule,
      }
    };
  },

  _sumCashAccounts() {
    var accounts = Storage.get(Storage.keys.cashAccounts);
    return accounts.reduce(function(sum, a) { return sum + (parseFloat(a.balance) || 0); }, 0);
  },

  _sumStocksCNY() {
    var rates = this._getFxRates();
    var stocks = Storage.get(Storage.keys.stocks);
    var total = 0;
    var self = this;
    stocks.forEach(function(s) {
      var rate = 1;
      if (s.currency === 'USD') rate = rates.USDCNY;
      else if (s.currency === 'HKD') rate = rates.HKDCNY;
      total += (parseFloat(s.currentPrice || s.price || 0) || 0) * (parseInt(s.shares) || 0) * rate;
    });
    return total;
  },

  _sumFundsCNY() {
    var funds = Storage.get(Storage.keys.funds);
    return funds.reduce(function(sum, f) { return sum + (parseFloat(f.holdValue || f.marketValue || 0) || 0); }, 0);
  },

  _buildPremiumSchedule(startYear, endYear) {
    var schedule = {};
    var insurance = Storage.get(Storage.keys.insurance);
    var self = this;

    insurance.forEach(function(p) {
      var years = self._parsePayPeriodYears(p.payPeriod);
      if (!years || years.length === 0) {
        // 每年单独购买：持续计入
        if (p.payPeriod && p.payPeriod.indexOf('每年') >= 0) {
          for (var y = startYear; y <= endYear; y++) {
            schedule[y] = (schedule[y] || 0) + (parseFloat(p.premium) || 0);
          }
        }
        return;
      }
      // 有明确缴费区间
      years.forEach(function(y) {
        if (y >= startYear && y <= endYear) {
          schedule[y] = (schedule[y] || 0) + (parseFloat(p.premium) || 0);
        }
      });
    });
    return schedule;
  },

  _parsePayPeriodYears(payPeriod) {
    if (!payPeriod) return null;
    // 匹配 "2023-2032 · 10年"
    var m = payPeriod.match(/(\d{4})\s*-\s*(\d{4})/);
    if (!m) return null;
    var start = parseInt(m[1]);
    var end = parseInt(m[2]);
    var years = [];
    for (var y = start; y <= end; y++) years.push(y);
    return years;
  },

  _buildPensionSchedule(startYear, endYear, params) {
    var schedule = {};
    var birthYear = 1983;
    var members = [
      { balance: params.pensionMember1Balance, monthly: params.pensionMember1Monthly, retireAge: params.pensionMember1RetireAge },
      { balance: params.pensionMember2Balance, monthly: params.pensionMember2Monthly, retireAge: params.pensionMember2RetireAge }
    ];
    var pmMap = { 58: 152, 59: 145, 60: 139, 61: 132, 62: 125, 63: 117, 64: 109, 65: 101 };
    // 缴费起始年（2008年）
    var contributionStartYear = 2008;
    // 2025年上海计发基数（社平工资）
    var baseAvgSalary2025 = 12434;
    // 社平工资年增长率（预估）
    var avgSalaryGrowthRate = 0.05;
    // 平均缴费指数（按3倍上限缴）
    var avgContributionIndex = 3.0;

    members.forEach(function(p) {
      var retireYear = birthYear + p.retireAge;
      // 如果今天退休：后续不再工作，养老金账户只按 2% 复利增长，不再追加缴费
      // 缴费年限也只计算到当前年份（或退休当年，取较早者）
      var balance = p.balance;
      for (var y = startYear; y < retireYear; y++) {
        balance = balance * 1.02;
      }
      // 计发月数（只是计算除数，不是领取期限；养老金终身发放）
      var pm = pmMap[p.retireAge] || 117;
      var personalMonthly = balance / pm;
      // 基础养老金
      // 公式：月领 = 退休时计发基数 × (1 + 平均缴费指数) ÷ 2 × 缴费年限 × 1%
      var avgSalaryAtRetirement = baseAvgSalary2025 * Math.pow(1 + avgSalaryGrowthRate, retireYear - 2025);
      var contributionYears = Math.max(0, Math.min(startYear, retireYear) - contributionStartYear);
      var baseMonthly = avgSalaryAtRetirement * (1 + avgContributionIndex) / 2 * contributionYears * 0.01;
      var monthly = personalMonthly + baseMonthly;
      for (var y = retireYear; y <= endYear; y++) {
        schedule[y] = (schedule[y] || 0) + (monthly * 12);
      }
    });
    // C186709225（友邦优享年年金）已失效，现金价值约5000元锁定在个人养老金账户，60岁时一次性领取
    var pensionCashValueYear = birthYear + 60;
    if (pensionCashValueYear >= startYear && pensionCashValueYear <= endYear) {
      schedule[pensionCashValueYear] = (schedule[pensionCashValueYear] || 0) + 5000;
    }
    return schedule;
  },

  _buildInsuranceIncomeSchedule(startYear, endYear) {
    var schedule = {};
    var self = this;
    for (var year = startYear; year <= endYear; year++) {
      var age = 43 + (year - startYear);
      var income = self.RETIREMENT_INSURANCE_INCOME[age];
      if (income) {
        schedule[year] = (income.annual || 0) + (income.lumpSum || 0);
      }
    }
    return schedule;
  },

  // 企业年金领取收入（仅王典，Rowen 无）
  _buildEnterpriseAnnuitySchedule(startYear, endYear) {
    var schedule = {};
    var annuities = Storage.get(Storage.keys.annuities);
    if (!annuities || annuities.length === 0) return schedule;

    // 按持仓比例加权年化收益
    var totalBalance = 0;
    var weightedReturn = 0;
    annuities.forEach(function(a) {
      var bal = parseFloat(a.balance) || 0;
      var ret = parseFloat(a.annualReturn) || 5; // 无数据时默认 5%
      totalBalance += bal;
      weightedReturn += bal * ret;
    });
    if (totalBalance <= 0) return schedule;
    weightedReturn = weightedReturn / totalBalance;

    // 王典退休参数（Rowen 无企业年金）
    var retireAge = 63;
    var birthYear = 1983;
    var retireYear = birthYear + retireAge;
    var pm = { 58: 152, 59: 145, 60: 139, 61: 132, 62: 125, 63: 117, 64: 109, 65: 101 }[retireAge] || 117;

    // 从当前复利到退休时点的账户余额
    var balance = totalBalance;
    for (var y = startYear; y < retireYear; y++) {
      balance = balance * (1 + weightedReturn / 100);
    }

    var monthly = balance / pm;
    var remainingMonths = pm;
    for (var year = retireYear; year <= endYear && remainingMonths > 0; year++) {
      var monthsThisYear = Math.min(12, remainingMonths);
      schedule[year] = (schedule[year] || 0) + monthly * monthsThisYear;
      remainingMonths -= monthsThisYear;
    }

    return schedule;
  },

  // 房贷按月还款支出表
  _buildMortgagePaymentSchedule(startYear, endYear) {
    var schedule = {};
    var loans = Storage.get(Storage.keys.loans);
    var self = this;

    loans.forEach(function(l) {
      // 优先用 calcLoanProgress 自动推算当前月供与剩余期数（基于等额本息/等额本金 + 剩余期数）
      var prog = self.calcLoanProgress(l);
      var monthly = prog.monthlyPayment || 0;
      var remainingMonths = prog.monthsRemaining || 0;

      // 兜底：如果 calcLoanProgress 未算出，再尝试 loan 对象上的手动字段
      if (monthly <= 0) monthly = parseFloat(l.monthlyPayment) || 0;
      if (remainingMonths <= 0) remainingMonths = parseInt(l.remainingMonths) || 0;

      var balance = parseFloat(l.balance) || 0;
      var rate = parseFloat(l.rate) || 0;
      if (monthly <= 0) {
        var total = parseFloat(l.total) || balance;
        var months = parseInt(l.months) || 240;
        if (rate > 0 && total > 0) {
          var r = rate / 100 / 12;
          monthly = total * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
        } else if (balance > 0) {
          monthly = balance / 240;
        }
      }
      if (remainingMonths <= 0 && l.endDate) {
        var today = new Date();
        var end = new Date(l.endDate);
        remainingMonths = Math.max(0, Math.ceil((end - today) / (1000 * 60 * 60 * 24 * 30)));
      }

      if (monthly <= 0 || remainingMonths <= 0) return;

      var firstYearPartial = 12 - (new Date().getMonth() + 1) + 1; // 本年剩余月份（含当前月）
      firstYearPartial = Math.max(1, Math.min(12, firstYearPartial));
      var firstYearMonths = Math.min(firstYearPartial, remainingMonths);
      if (firstYearMonths > 0) {
        schedule[startYear] = (schedule[startYear] || 0) + monthly * firstYearMonths;
        remainingMonths -= firstYearMonths;
      }

      for (var y = startYear + 1; y <= endYear && remainingMonths > 0; y++) {
        var monthsThisYear = Math.min(12, remainingMonths);
        schedule[y] = (schedule[y] || 0) + monthly * monthsThisYear;
        remainingMonths -= monthsThisYear;
      }
    });

    return schedule;
  },

  renderRetirementPage() {
    var result = this._retirementCache;
    if (!result) return;
    var self = this;

    // 1. 结论卡片
    var conclusion = document.getElementById('retirementConclusion');
    if (conclusion) {
      if (result.canRetire) {
        conclusion.innerHTML = '<div class="retirement-conclusion-success">今天可以退休，🎉🎉🎉</div>';
      } else {
        var gapText = result.shortfall > 0 ? '还差 ' + self.formatMoney(result.shortfall).replace('¥', '') + ' 元' : '资金将在 ' + result.runOutYear + ' 年用光';
        conclusion.innerHTML = '<div class="retirement-conclusion-fail">今天不能退休，' + gapText + '</div>';
      }
    }

    // 2. 计算明细
    var grid = document.getElementById('retirementSummaryGrid');
    if (grid) {
      var items = [
        { label: '今天可用资产（现金+股票+基金）', value: self.formatMoney(result.liquidAssets), cls: 'positive' }
      ];
      if (result.mortgagePayoffMode === 'lump') {
        items.push({ label: '立即还清房贷', value: '-' + self.formatMoney(result.mortgagePayoff).replace('¥', '¥'), cls: 'negative' });
      } else {
        items.push({ label: '继续按月还房贷（本金合计）', value: self.formatMoney(result.mortgagePayoff).replace('¥', '¥'), cls: 'neutral' });
        items.push({ label: '首年房贷支出', value: '-' + self.formatMoney((result.years[0] && result.years[0].mortgage) || 0).replace('¥', '¥'), cls: 'negative' });
      }
      if (!result.canRetire) {
        items.push({ label: '资金用光年份', value: result.runOutYear ? (result.runOutYear + ' 年') : '未耗尽', cls: 'danger' });
        items.push({ label: '当前缺口（现值）', value: self.formatMoney(result.shortfall), cls: 'danger' });
      }
      grid.innerHTML = items.map(function(it) {
        return '<div class="retirement-summary-item ' + it.cls + '"><div class="retirement-summary-label">' + self.escapeHtml(it.label) + '</div><div class="retirement-summary-value">' + it.value + '</div></div>';
      }).join('') + '<button id="btnRetireDetail" class="action-btn" style="margin-top:12px;width:100%;background:#1e293b;border:1px solid #334155;color:#94a3b8;">查看计算详情</button>';
    }

    // 3. 计算详情面板（初始隐藏）
    var detailWrap = document.getElementById('retirementDetailWrap');
    if (!detailWrap) {
      detailWrap = document.createElement('div');
      detailWrap.id = 'retirementDetailWrap';
      detailWrap.style.display = 'none';
      detailWrap.style.marginTop = '16px';
      detailWrap.style.padding = '16px';
      detailWrap.style.background = '#0f172a';
      detailWrap.style.borderRadius = '12px';
      detailWrap.style.border = '1px solid #1e293b';
      detailWrap.style.maxHeight = '500px';
      detailWrap.style.overflowY = 'auto';
      var chartWrap = document.getElementById('retirementChartWrap');
      if (chartWrap && chartWrap.parentNode) {
        chartWrap.parentNode.insertBefore(detailWrap, chartWrap);
      }
    }
    // 绑定按钮事件
    var btnDetail = document.getElementById('btnRetireDetail');
    if (btnDetail && !btnDetail._bound) {
      btnDetail._bound = true;
      btnDetail.onclick = function() {
        var wrap = document.getElementById('retirementDetailWrap');
        if (!wrap) return;
        if (wrap.style.display === 'none') {
          wrap.style.display = 'block';
          btnDetail.textContent = '收起计算详情';
          // 渲染详情表格
          var result = self._retirementCache;
          if (!result) return;
          var rows = '<table style="width:100%;font-size:11px;color:#cbd5e1;border-collapse:collapse;">'
            + '<thead><tr style="background:#1e293b;position:sticky;top:0;">'
            + '<th style="padding:4px 6px;text-align:left;">年份</th>'
            + '<th style="padding:4px 6px;text-align:right;">年龄</th>'
            + '<th style="padding:4px 6px;text-align:right;">期初余额</th>'
            + '<th style="padding:4px 6px;text-align:right;">投资收益</th>'
            + '<th style="padding:4px 6px;text-align:right;">流入</th>'
            + '<th style="padding:4px 6px;text-align:right;">流出</th>'
            + '<th style="padding:4px 6px;text-align:right;">净现金流</th>'
            + '<th style="padding:4px 6px;text-align:right;">期末余额</th>'
            + '</tr></thead><tbody>';
          result.years.forEach(function(y) {
            var cls = y.endBalance < 0 ? ' style="color:#f87171;"' : (y.endBalance > 0 ? ' style="color:#4ade80;"' : '');
            rows += '<tr' + cls + '>'
              + '<td style="padding:3px 6px;">' + y.year + '</td>'
              + '<td style="padding:3px 6px;text-align:right;">' + y.age + '岁</td>'
              + '<td style="padding:3px 6px;text-align:right;">' + self.formatMoney(y.startBalance) + '</td>'
              + '<td style="padding:3px 6px;text-align:right;">' + self.formatMoney(y.startBalance * (result.params.investmentReturn/100)) + '</td>'
              + '<td style="padding:3px 6px;text-align:right;">' + self.formatMoney(y.inflow) + '</td>'
              + '<td style="padding:3px 6px;text-align:right;">' + self.formatMoney(y.outflow) + '</td>'
              + '<td style="padding:3px 6px;text-align:right;">' + self.formatMoney(y.inflow - y.outflow) + '</td>'
              + '<td style="padding:3px 6px;text-align:right;">' + self.formatMoney(y.endBalance) + '</td>'
              + '</tr>';
          });
          rows += '</tbody></table>';
          // 缺口计算说明（二分搜索算法）
          var note = '<div style="margin-top:12px;padding:10px;background:#1e293b;border-radius:8px;font-size:11px;color:#94a3b8;line-height:1.8;">'
            + '<div style="color:#fbbf24;font-weight:600;margin-bottom:6px;">缺口计算说明（二分搜索）</div>'
            + '算法：通过二分搜索找到最小的 initialCash，使得所有年份期末余额 ≥ 0<br>'
            + '搜索范围：[actualInitialCash, actualInitialCash + 1亿]<br>'
            + '当前实际资产：' + self.formatMoney(result.actualInitialCash) + '<br>'
            + '所需最小资产：' + self.formatMoney(result.initialCash) + '<br>'
            + '<span style="color:#f87171;font-weight:600;">缺口 = 所需最小资产 - 当前实际资产 = ' + self.formatMoney(result.shortfall) + '</span>'
            + '</div>';
          wrap.innerHTML = rows + note;
        } else {
          wrap.style.display = 'none';
          btnDetail.textContent = '查看计算详情';
        }
      };
    }

    // 4. 资金曲线
    this.renderRetirementChart(result);
  },

  renderRetirementChart(result) {
    var self = this;
    var wrap = document.getElementById('retirementChartWrap');
    var note = document.getElementById('retirementChartNote');
    if (!wrap) return;

    // 调试：打印详细数据到控制台
    if (result && result.debug) {
      console.log('%c[退休计算] 详细数据', 'font-weight:bold;font-size:14px;color:#3b82f6;');
      console.log('[资产] 现金: ¥' + (result.debug.assetBreakdown.cash.total/10000).toFixed(2) + '万');
      console.log('[资产] 股票:', result.debug.assetBreakdown.stocks.items.map(function(s) {
        var rate = 1;
        if (s.currency === 'USD') rate = result.debug.fxRates.USDCNY;
        else if (s.currency === 'HKD') rate = result.debug.fxRates.HKDCNY;
        var marketValue = (parseFloat(s.currentPrice) || 0) * (parseInt(s.shares) || 0) * rate;
        return s.code + ' ' + s.name + ': ' + s.shares + '股 × ¥' + parseFloat(s.currentPrice || 0).toFixed(2) + ' = ¥' + (marketValue/10000).toFixed(2) + '万';
      }));
      console.log('[资产] 基金合计: ¥' + (result.debug.assetBreakdown.funds.total/10000).toFixed(2) + '万');
      console.log('[汇率] USD/CNY:', result.debug.fxRates.USDCNY, 'HKD/CNY:', result.debug.fxRates.HKDCNY);
      console.log('[参数] 投资年化收益:', result.params.investmentReturn + '%', '通货膨胀:', result.params.inflation + '%');
      // 打印未来收入摘要
      var pensionYears = Object.keys(result.debug.pensionSchedule).filter(function(y) { return result.debug.pensionSchedule[y] > 0; });
      if (pensionYears.length > 0) {
        console.log('[养老金] 开始年份:', Math.min.apply(null, pensionYears), '首年金额: ¥' + (result.debug.pensionSchedule[pensionYears[0]]/10000).toFixed(2) + '万');
      }
      var insuranceYears = Object.keys(result.debug.insuranceSchedule).filter(function(y) { return result.debug.insuranceSchedule[y] > 0; });
      if (insuranceYears.length > 0) {
        console.log('[保险年金] 开始年份:', Math.min.apply(null, insuranceYears), '首年金额: ¥' + (result.debug.insuranceSchedule[insuranceYears[0]]/10000).toFixed(2) + '万');
      }
    }

    // 1) 只画到预期寿命对应的年份
    var allYears = result.years;
    var lifeExp = result.params.lifeExpectancy;
    // 找到 age >= lifeExp 的第一个索引（年龄可能跳步，用 >=）
    var lifeIdx = allYears.findIndex(function(y) { return y.age >= lifeExp; });
    if (lifeIdx < 0) lifeIdx = allYears.length - 1;
    var years = allYears.slice(0, lifeIdx + 1);

    if (years.length === 0) {
      wrap.innerHTML = '<div class="empty-tip">暂无数据</div>';
      return;
    }

    var values = years.map(function(y) { return y.endBalance; });
    var maxVal = Math.max.apply(null, values);
    var minVal = Math.min.apply(null, values);

    // 2) 纵轴：画全曲线（含负值），上限约400万，下限跟随最小值留边距
    var yMax = Math.max(maxVal * 1.12, 4000000);
    var yMin = Math.min(minVal * 1.15, -100000); // 至少显示到-10万，但不强制为0
    if (yMin > 0) yMin = 0; // 如果全为正则下限为0
    var yRange = yMax - yMin || 1;

    var width = 720, height = 300, padLeft = 78, padRight = 24, padTop = 28, padBottom = 52;
    var chartW = width - padLeft - padRight;
    var chartH = height - padTop - padBottom;

    var xStep = chartW / (years.length - 1 || 1);
    function px(i) { return padLeft + i * xStep; }
    function py(v) { return padTop + chartH * (1 - (v - yMin) / yRange); }

    var pathD = 'M' + px(0).toFixed(1) + ' ' + py(years[0].endBalance).toFixed(1);
    for (var i = 1; i < years.length; i++) {
      pathD += ' L' + px(i).toFixed(1) + ' ' + py(years[i].endBalance).toFixed(1);
    }

    // 区域填充：正值绿色渐变 → 零线透明 → 负值红色渐变
    var zeroLineY = py(0).toFixed(1);
    var areaD = pathD + ' L' + px(years.length - 1).toFixed(1) + ' ' + zeroLineY + ' L' + px(0).toFixed(1) + ' ' + zeroLineY + ' Z';

    // 3) 纵轴刻度：5 条等分线，单位"万"
    var gridLines = '';
    var yTicks = 5;
    for (var t = 0; t <= yTicks; t++) {
      var v = yMax - t * (yRange / yTicks);
      var yPos = padTop + chartH * (t / yTicks);
      gridLines += '<line x1="' + padLeft + '" y1="' + yPos.toFixed(1) + '" x2="' + (width - padRight) + '" y2="' + yPos.toFixed(1) + '" stroke="rgba(148,163,184,0.08)" stroke-width="1"/>';
      var labelWan = (v / 10000).toFixed(v >= 1000000 ? 0 : 1);
      gridLines += '<text x="' + (padLeft - 10) + '" y="' + (yPos + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#475569">' + labelWan + '万</text>';
    }

    // 4) 横轴标签：更细的刻度（约每 5 年一个），确保包含首尾
    var xLabelInterval = 5; // 每 5 年一个刻度
    var xLabels = '';
    function drawXLabel(idx) {
      var xPos = px(idx);
      xLabels += '<line x1="' + xPos.toFixed(1) + '" y1="' + (height - padBottom) + '" x2="' + xPos.toFixed(1) + '" y2="' + (height - padBottom + 5) + '" stroke="#334155" stroke-width="1"/>';
      xLabels += '<text x="' + xPos.toFixed(1) + '" y="' + (height - padBottom + 18).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#475569">' + years[idx].year + '年</text>';
      xLabels += '<text x="' + xPos.toFixed(1) + '" y="' + (height - padBottom + 30).toFixed(1) + '" text-anchor="middle" font-size="9" fill="#334155">' + years[idx].age + '岁</text>';
    }
    // 每 5 年一个刻度
    for (var i = 0; i < years.length; i += xLabelInterval) drawXLabel(i);
    if ((years.length - 1) % xLabelInterval !== 0) drawXLabel(years.length - 1);

    // 5) 关键事件虚线标注 — 扁平黑暗风格
    var milestones = '';
    function addMilestone(age, label, color, top, fontSize, yOffset) {
      fontSize = fontSize || 10;
      yOffset = yOffset || 0;
      var idx = years.findIndex(function(y) { return y.age === age; });
      if (idx < 0) return;
      var mx = px(idx);
      milestones += '<line x1="' + mx.toFixed(1) + '" y1="' + padTop + '" x2="' + mx.toFixed(1) + '" y2="' + (height - padBottom) + '" stroke="' + color + '" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.30"/>';
      var textY = top ? (padTop + 14 + yOffset) : (height - padBottom - 8);
      milestones += '<text x="' + mx.toFixed(1) + '" y="' + textY.toFixed(1) + '" text-anchor="middle" font-size="' + fontSize + '" fill="' + color + '" font-weight="500">' + label + '</text>';
    }
    var m1Age = result.params.pensionMember1RetireAge || 63;
    var m2Age = result.params.pensionMember2RetireAge || 58;
    var eduEndYear = result.params.educationEndYear || 2035;
    var eduEntry = result.years.find(function(y) { return y.year === eduEndYear; });
    var eduEndAge = eduEntry ? eduEntry.age : 43 + (eduEndYear - 2026);

    // 顶部：关键事件标注（扁平化小字，错开两行避免重叠）
    addMilestone(m2Age, 'Rowen退休', '#22d3ee', true, 9);       // 第一行
    addMilestone(m1Age, '王典退休', '#4ade80', true, 9);         // 第一行
    addMilestone(60, '保险年金', '#f59e0b', true, 9, 12);       // 第二行
    addMilestone(eduEndAge, '教育结束', '#a78bfa', true, 9, 12); // 第二行

    if (result.runOutYear && result.runOutYear <= years[years.length - 1].year) {
      var runIdx = years.findIndex(function(y) { return y.year === result.runOutYear; });
      if (runIdx >= 0) {
        var runX = px(runIdx);
        var runY = py(years[runIdx].endBalance);
        milestones += '<circle cx="' + runX.toFixed(1) + '" cy="' + runY.toFixed(1) + '" r="4" fill="#ef4444" stroke="#0f172a" stroke-width="1.5"/>';
        milestones += '<text x="' + runX.toFixed(1) + '" y="' + (runY - 10).toFixed(1) + '" text-anchor="middle" font-size="9" fill="#f87171" font-weight="500">' + result.runOutYear + '年耗尽</text>';
      }
    }

    // 6) SVG 渲染 — 扁平黑暗风格
    var zeroRatio = ((yMax - yMin > 0) ? ((yMax - 0) / (yMax - yMin)) : 0.5) * 100;
    var svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" class="retirement-chart-svg">' +
      '<defs>' +
      '<linearGradient id="retArea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#4ade80" stop-opacity="0.20"/>' +
      '<stop offset="' + Math.max(0, zeroRatio).toFixed(1) + '%" stop-color="#4ade80" stop-opacity="0.03"/>' +
      '<stop offset="' + Math.max(0, zeroRatio).toFixed(1) + '%" stop-color="#ef4444" stop-opacity="0.03"/>' +
      '<stop offset="100%" stop-color="#ef4444" stop-opacity="0.20"/>' +
      '</linearGradient>' +
      '</defs>' +
      gridLines +
      // 零线（虚线风格）
      '<line x1="' + padLeft + '" y1="' + zeroLineY + '" x2="' + (width - padRight) + '" y2="' + zeroLineY + '" stroke="#475569" stroke-width="1" stroke-dasharray="2 3"/>' +
      // 面积填充
      '<path d="' + areaD + '" fill="url(#retArea)"/>' +
      // 曲线本身
      '<path d="' + pathD + '" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      milestones +
      xLabels +
      // 坐标轴框
      '<line x1="' + padLeft + '" y1="' + (height - padBottom) + '" x2="' + (width - padRight) + '" y2="' + (height - padBottom) + '" stroke="#334155" stroke-width="1"/>' +
      '<line x1="' + padLeft + '" y1="' + padTop + '" x2="' + padLeft + '" y2="' + (height - padBottom) + '" stroke="#334155" stroke-width="1"/>' +
      // 轴标题
      '<text x="' + (width / 2).toFixed(1) + '" y="' + (height - 6).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#475569">年份 / 年龄</text>' +
      '<text x="16" y="' + (height / 2).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#475569" transform="rotate(-90 16 ' + (height / 2).toFixed(1) + ')">余额（万元）</text>' +
      '</svg>';

    // 7) 收支明细堆积面积图（按分项多色堆叠）
    var cfHeight = 190, cfPadTop = 18, cfPadBottom = 52;
    var cfChartH = cfHeight - cfPadTop - cfPadBottom;
    var cfMaxIn = Math.max.apply(null, years.map(function(y) { return y.inflow + y.investmentGain; }));
    var cfMaxOut = Math.max.apply(null, years.map(function(y) { return y.outflow; }));
    var cfMax = Math.max(cfMaxIn, cfMaxOut, 100000); // 至少显示到 10万

    var cfZeroY = cfPadTop + cfChartH / 2;
    function cfpy(v) { return cfZeroY - (v / cfMax) * (cfChartH / 2); }

    // 收入分项（从下往上堆叠）
    var incomeLayers = [
      { key: 'extraIncome', label: '其他收入', color: '#94a3b8' },
      { key: 'pension', label: '基本养老金', color: '#38bdf8' },
      { key: 'insurance', label: '保险年金', color: '#a78bfa' },
      { key: 'enterpriseAnnuity', label: '企业年金', color: '#34d399' },
      { key: 'investmentGain', label: '投资收益', color: '#fbbf24' }
    ];
    // 支出分项（从上往下堆叠，即向下）
    var expenseLayers = [
      { key: 'expense', label: '生活消费', color: '#f87171' },
      { key: 'education', label: '教育消费', color: '#fb923c' },
      { key: 'mortgage', label: '房贷', color: '#22d3ee' },
      { key: 'premium', label: '购买保险', color: '#f472b6' }
    ];

    function buildStackedArea(layers, isExpense) {
      var areas = [];
      var running = years.map(function() { return 0; });
      layers.forEach(function(layer) {
        var bottom = running.slice();
        var top = years.map(function(y, i) { return running[i] + (y[layer.key] || 0); });
        var d = 'M' + px(0).toFixed(1) + ' ' + cfpy(isExpense ? -bottom[0] : top[0]).toFixed(1);
        for (var i = 1; i < years.length; i++) {
          d += ' L' + px(i).toFixed(1) + ' ' + cfpy(isExpense ? -bottom[i] : top[i]).toFixed(1);
        }
        for (var i = years.length - 1; i >= 0; i--) {
          d += ' L' + px(i).toFixed(1) + ' ' + cfpy(isExpense ? -top[i] : bottom[i]).toFixed(1);
        }
        d += ' Z';
        areas.push({ d: d, color: layer.color, label: layer.label });
        running = top;
      });
      return areas;
    }

    var incomeAreas = buildStackedArea(incomeLayers, false);
    var expenseAreas = buildStackedArea(expenseLayers, true);

    var cfGrid = '';
    cfGrid += '<line x1="' + padLeft + '" y1="' + cfpy(cfMax).toFixed(1) + '" x2="' + (width - padRight) + '" y2="' + cfpy(cfMax).toFixed(1) + '" stroke="rgba(148,163,184,0.08)" stroke-width="1"/>';
    cfGrid += '<text x="' + (padLeft - 10) + '" y="' + (cfpy(cfMax) + 4).toFixed(1) + '" text-anchor="end" font-size="9" fill="#475569">+' + (cfMax / 10000).toFixed(0) + '万</text>';
    cfGrid += '<line x1="' + padLeft + '" y1="' + cfpy(-cfMax).toFixed(1) + '" x2="' + (width - padRight) + '" y2="' + cfpy(-cfMax).toFixed(1) + '" stroke="rgba(148,163,184,0.08)" stroke-width="1"/>';
    cfGrid += '<text x="' + (padLeft - 10) + '" y="' + (cfpy(-cfMax) + 4).toFixed(1) + '" text-anchor="end" font-size="9" fill="#475569">-' + (cfMax / 10000).toFixed(0) + '万</text>';

    var cfPathsHtml = '';
    incomeAreas.concat(expenseAreas).forEach(function(area) {
      cfPathsHtml += '<path d="' + area.d + '" fill="' + area.color + '" fill-opacity="0.35" stroke="' + area.color + '" stroke-width="1" stroke-linejoin="round" stroke-opacity="0.7"/>';
    });

    // 与上方走势图对齐的横轴刻度
    var cfXAxis = '';
    function drawCfXLabel(idx) {
      var xPos = px(idx);
      cfXAxis += '<line x1="' + xPos.toFixed(1) + '" y1="' + (cfHeight - cfPadBottom) + '" x2="' + xPos.toFixed(1) + '" y2="' + (cfHeight - cfPadBottom + 5) + '" stroke="#334155" stroke-width="1"/>';
      cfXAxis += '<text x="' + xPos.toFixed(1) + '" y="' + (cfHeight - cfPadBottom + 18).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#475569">' + years[idx].year + '年</text>';
      cfXAxis += '<text x="' + xPos.toFixed(1) + '" y="' + (cfHeight - cfPadBottom + 30).toFixed(1) + '" text-anchor="middle" font-size="9" fill="#334155">' + years[idx].age + '岁</text>';
    }
    for (var i = 0; i < years.length; i += xLabelInterval) drawCfXLabel(i);
    if ((years.length - 1) % xLabelInterval !== 0) drawCfXLabel(years.length - 1);

    var cfSvg = '<svg viewBox="0 0 ' + width + ' ' + cfHeight + '" class="retirement-chart-svg" style="height:' + cfHeight + 'px;min-width:680px">' +
      cfGrid +
      '<line x1="' + padLeft + '" y1="' + cfpy(0).toFixed(1) + '" x2="' + (width - padRight) + '" y2="' + cfpy(0).toFixed(1) + '" stroke="#475569" stroke-width="1" stroke-dasharray="2 3"/>' +
      '<line x1="' + padLeft + '" y1="' + (cfHeight - cfPadBottom) + '" x2="' + (width - padRight) + '" y2="' + (cfHeight - cfPadBottom) + '" stroke="#334155" stroke-width="1"/>' +
      cfPathsHtml +
      cfXAxis +
      '<text x="' + (padLeft + 4) + '" y="' + (cfPadTop - 4).toFixed(1) + '" text-anchor="start" font-size="10" fill="#475569">年度收支明细（收益↑ / 消费↓）</text>' +
      '</svg>';

    // 堆积图图例：收入、支出分两行
    var cfLegend = '<div style="display:flex;flex-direction:column;gap:8px;align-items:center;font-size:11px;line-height:1.4;">';
    cfLegend += '<div style="display:flex;flex-wrap:wrap;gap:10px 14px;justify-content:center;">';
    cfLegend += '<span style="color:#64748b;font-weight:500;">收入：</span>';
    incomeLayers.forEach(function(l) {
      cfLegend += '<span style="display:inline-flex;align-items:center;gap:4px;color:' + l.color + '"><span style="width:8px;height:8px;border-radius:2px;background:' + l.color + ';opacity:0.8;"></span>' + l.label + '</span>';
    });
    cfLegend += '</div>';
    cfLegend += '<div style="display:flex;flex-wrap:wrap;gap:10px 14px;justify-content:center;">';
    cfLegend += '<span style="color:#64748b;font-weight:500;">支出：</span>';
    expenseLayers.forEach(function(l) {
      cfLegend += '<span style="display:inline-flex;align-items:center;gap:4px;color:' + l.color + '"><span style="width:8px;height:8px;border-radius:2px;background:' + l.color + ';opacity:0.8;"></span>' + l.label + '</span>';
    });
    cfLegend += '</div>';
    cfLegend += '</div>';

    wrap.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;">' + svg + cfSvg + cfLegend + '</div>';

    // 8) 图例说明 — 扁平黑暗风格（余额曲线）
    if (note) {
      var notes = [];
      if (result.runOutYear && result.runOutYear <= years[years.length - 1].year) {
        notes.push('<span style="color:#f87171;font-weight:500">⚠ 资金将在 ' + result.runOutYear + ' 年耗尽</span>');
      } else {
        notes.push('<span style="color:#4ade80;font-weight:500">✓ 可支撑至 ' + lifeExp + ' 岁</span>');
      }
      notes.push('<span style="color:#64748b">● 绿色 = 资产 ≥ 0</span>');
      notes.push('<span style="color:#64748b">● 红色 = 缺口</span>');
      notes.push('<span style="color:#475569">╎ 虚线 = 关键事件</span>');
      note.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;font-size:11px;line-height:1.8">' + notes.join('') + '</div>';
    }
  },

  // ── 通知管理（iOS 风格日历） ──
  _calendarYear: null,

  loadAlertsPage() {
    var now = new Date();
    if (!this._calendarYear) this._calendarYear = now.getFullYear();
    this.renderYearCalendar();
    this._bindYearNav();

    // 下载按钮
    var self = this;
    var btn = document.getElementById("downloadCalendarBtn");
    if (btn) btn.onclick = function() { self.downloadCalendar(); };
  },

  _bindYearNav() {
    var self = this;
    var prev = document.getElementById("calPrevBtn");
    var next = document.getElementById("calNextBtn");
    if (prev) prev.onclick = function() { self._calendarYear--; self.renderYearCalendar(); self._bindYearNav(); };
    if (next) next.onclick = function() { self._calendarYear++; self.renderYearCalendar(); self._bindYearNav(); };
  },

  renderYearCalendar() {
    var year = this._calendarYear;
    var label = document.getElementById("calYearLabel");
    if (label) label.textContent = year + "年";

    // 月份名
    var monthNames = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
    var weekDays = ["日","一","二","三","四","五","六"];
    var today = new Date();
    var todayKey = today.getFullYear() + "-" + ("0"+(today.getMonth()+1)).slice(-2) + "-" + ("0"+today.getDate()).slice(-2);

    // 收集全年事件
    var allEvents = {};
    for (var m = 0; m < 12; m++) {
      var monthEvents = this._collectCalendarEvents(year, m);
      Object.keys(monthEvents).forEach(function(k) {
        if (!allEvents[k]) allEvents[k] = [];
        allEvents[k] = allEvents[k].concat(monthEvents[k]);
      });
    }
    this._yearEvents = allEvents;

    var grid = document.getElementById("yearGrid");
    var html = "";

    for (var m = 0; m < 12; m++) {
      var events = this._collectCalendarEvents(year, m);
      var firstDay = new Date(year, m, 1).getDay();
      var daysInMonth = new Date(year, m + 1, 0).getDate();

      html += '<div class="year-month">';
      html += '<div class="year-month-name">' + monthNames[m] + '</div>';

      // 星期头
      html += '<div class="year-weekdays">';
      for (var w = 0; w < 7; w++) {
        html += '<span>' + weekDays[w] + '</span>';
      }
      html += '</div>';

      // 日期网格
      html += '<div class="year-days">';
      // 空白填充
      for (var i = 0; i < firstDay; i++) {
        html += '<span class="yd-cell yd-empty"></span>';
      }
      for (var d = 1; d <= daysInMonth; d++) {
        var dateKey = year + "-" + ("0"+(m+1)).slice(-2) + "-" + ("0"+d).slice(-2);
        var isToday = dateKey === todayKey;
        var dayEvents = events[dateKey] || [];
        var dotHtml = "";
        if (dayEvents.length > 0) {
          dotHtml = '<span class="yd-dots">';
          dayEvents.forEach(function(ev) {
            dotHtml += '<span class="yd-dot ' + ev.cls + '"></span>';
          });
          dotHtml += '</span>';
        }
        html += '<span class="yd-cell' + (isToday ? ' yd-today' : '') + (dayEvents.length > 0 ? ' yd-has-event' : '') + '" data-date="' + dateKey + '">' + d + dotHtml + '</span>';
      }
      html += '</div>'; // year-days
      html += '</div>'; // year-month
    }

    grid.innerHTML = html;

    // 绑定点击事件
    this._bindYearCellClick(allEvents);
  },

  // 绑定年历日期点击
  _bindYearCellClick(allEvents) {
    var self = this;
    var cells = document.querySelectorAll(".yd-cell.yd-has-event");
    cells.forEach(function(cell) {
      cell.style.cursor = "pointer";
      cell.onclick = function(e) {
        e.stopPropagation();
        var dateKey = cell.getAttribute("data-date");
        var dayEvents = allEvents[dateKey] || [];
        if (dayEvents.length > 0) {
          self._showEventDetail(dateKey, dayEvents);
        }
      };
    });

    // 关闭按钮
    var closeBtn = document.getElementById("eventDetailClose");
    if (closeBtn) closeBtn.onclick = function() {
      document.getElementById("eventDetailCard").style.display = "none";
    };
  },

  // 显示事件明细
  _showEventDetail(dateKey, events) {
    var card = document.getElementById("eventDetailCard");
    var dateEl = document.getElementById("eventDetailDate");
    var listEl = document.getElementById("eventDetailList");

    // 格式化日期
    var parts = dateKey.split("-");
    var weekDayNames = ["周日","周一","周二","周三","周四","周五","周六"];
    var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
    var weekDay = weekDayNames[d.getDay()];
    dateEl.textContent = parts[1] + "月" + parseInt(parts[2]) + "日 " + weekDay;

    var iconMap = { insurance: "🟢", loan: "🔵", rsu: "🟣" };
    var labelMap = { insurance: "保险缴费", loan: "房贷还款", rsu: "RSU解禁" };

    var html = "";
    events.forEach(function(ev) {
      html += '<div class="event-detail-item">';
      html += '<span class="event-detail-type">' + (iconMap[ev.type] || "") + " " + (labelMap[ev.type] || "") + '</span>';
      html += '<span class="event-detail-title">' + ev.title + '</span>';
      html += '</div>';
    });
    listEl.innerHTML = html;
    card.style.display = "block";
  },

  // 收集所有事件：保险缴费、房贷还款、RSU解禁
  _collectCalendarEvents(year, month) {
    var events = {}; // dateKey -> [{title, cls}]
    var self = this;

    // 1. 保险缴费（基于 nextPayDate）
    var insurance = Storage.get(Storage.keys.insurance);
    insurance.forEach(function(p) {
      if (!p.nextPayDate) return;
      var parts = p.nextPayDate.split("-");
      var py = parseInt(parts[0]), pm = parseInt(parts[1]) - 1, pd = parseInt(parts[2]);
      if (py === year && pm === month) {
        var dk = p.nextPayDate;
        if (!events[dk]) events[dk] = [];
        events[dk].push({
          title: "保险 · " + (p.person||"") + " " + p.product + " ¥" + (parseFloat(p.premium)||0).toFixed(0),
          cls: "cal-dot-insurance",
          type: "insurance"
        });
      }
    });

    // 2. 房贷还款（每月同一天）
    var loans = Storage.get(Storage.keys.loans);
    loans.forEach(function(l) {
      var sdParts = l.startDate.split("-");
      var sdDay = parseInt(sdParts[2]);
      var endParts = l.endDate.split("-");
      var endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1])-1, parseInt(endParts[2]));
      // 检查该月还款日是否在贷款期内
      var checkDate = new Date(year, month, sdDay);
      var startDate = new Date(parseInt(sdParts[0]), parseInt(sdParts[1])-1, parseInt(sdParts[2]));
      if (checkDate >= startDate && checkDate <= endDate && sdDay <= new Date(year, month+1, 0).getDate()) {
        var dk = year + "-" + ("0"+(month+1)).slice(-2) + "-" + ("0"+sdDay).slice(-2);
        if (!events[dk]) events[dk] = [];
        var pay = self.calcMonthlyPayment(l.total, l.rate, l.months);
        events[dk].push({
          title: "房贷 · " + l.loanType + "月供 ¥" + pay.toFixed(0),
          cls: "cal-dot-loan",
          type: "loan"
        });
      }
    });

    // 3. RSU解禁
    var rsuList = Storage.get(Storage.keys.rsu);
    rsuList.forEach(function(r) {
      if (!r.vesting) return;
      r.vesting.forEach(function(v) {
        var vParts = v.date.split("-");
        var vy = parseInt(vParts[0]), vm = parseInt(vParts[1]) - 1, vd = parseInt(vParts[2]);
        if (vy === year && vm === month) {
          var dk = v.date;
          if (!events[dk]) events[dk] = [];
          events[dk].push({
            title: "RSU · " + r.name + " 解禁 " + v.shares + "股",
            cls: "cal-dot-rsu",
            type: "rsu"
          });
        }
      });
    });

    return events;
  },

  downloadCalendar() {
    var insurance = Storage.get(Storage.keys.insurance);
    var loans = Storage.get(Storage.keys.loans);
    var self = this;

    var lines = [];
    lines.push("BEGIN:VCALENDAR");
    lines.push("VERSION:2.0");
    lines.push("PRODID:-//FamilyFinance//Calendar//CN");
    lines.push("CALSCALE:GREGORIAN");
    lines.push("METHOD:PUBLISH");
    lines.push("X-WR-CALNAME:家庭资产 · 缴费还款提醒");
    lines.push("X-APPLE-CALENDAR-COLOR:#4ade80");

    var uidCounter = 1;

    // 保险事件
    insurance.forEach(function(p) {
      if (!p.nextPayDate) return;
      var dt = p.nextPayDate.replace(/-/g, "");
      var endYear = null;
      if (p.payPeriod) {
        var parts = p.payPeriod.replace(/[^0-9\-]/g, " ").split(/\s+/);
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].indexOf("-") > -1 && parts[i][0] === "2") {
            var segs = parts[i].split("-");
            if (segs.length === 2 && segs[1].length === 4) { endYear = parseInt(segs[1]); break; }
          }
        }
      }
      // 从日期提取起付日
      var dParts = p.nextPayDate.split("-");
      if (!endYear) endYear = parseInt(dParts[0]) + 10; // 默认往后10年
      var untilStr = endYear + dParts[1] + dParts[2] + "T235959Z";

      var summary = "💰 " + (p.person || "") + " · " + p.product;
      var desc = "保险公司：" + (p.company || "") + "\\n产品：" + p.product + "\\n被保人：" + (p.person || "") + "\\n年缴保费：¥" + parseFloat(p.premium || 0).toFixed(2) + "\\n合同号：" + (p.contractNo || "");

      lines.push("BEGIN:VEVENT");
      lines.push("UID:insurance-" + (p.contractNo || uidCounter++) + "@family-finance");
      lines.push("DTSTART:" + dt + "T000000");
      lines.push("SUMMARY:" + summary);
      lines.push("DESCRIPTION:" + desc);
      lines.push("RRULE:FREQ=YEARLY;UNTIL=" + untilStr);
      lines.push("BEGIN:VALARM");
      lines.push("TRIGGER:-PT1440M");
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:提醒：" + summary);
      lines.push("END:VALARM");
      lines.push("END:VEVENT");
    });

    // 房贷事件
    loans.forEach(function(l) {
      var sd = l.startDate.replace(/-/g, "");
      var ed = l.endDate.replace(/-/g, "");
      var pay = self.calcMonthlyPayment(l.total, l.rate, l.months);
      var summary = "🏠 " + l.loanType + "房贷月供";
      var desc = "银行：" + l.bank + "\\n贷款类型：" + l.loanType + "\\n贷款总额：¥" + parseFloat(l.total).toFixed(0) + "\\n剩余本金：¥" + parseFloat(l.balance).toFixed(2) + "\\n年利率：" + l.rate + "%\\n月供（等额本息）：¥" + pay.toFixed(2);

      lines.push("BEGIN:VEVENT");
      lines.push("UID:loan-" + (l.contractNo || l.loanType) + "@family-finance");
      lines.push("DTSTART:" + sd + "T000000");
      lines.push("SUMMARY:" + summary);
      lines.push("DESCRIPTION:" + desc);
      lines.push("RRULE:FREQ=MONTHLY;UNTIL=" + ed + "T235959Z");
      lines.push("BEGIN:VALARM");
      lines.push("TRIGGER:-PT1440M");
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:提醒：" + summary);
      lines.push("END:VALARM");
      lines.push("END:VEVENT");
    });

    // RSU 解禁事件
    var rsuList = Storage.get(Storage.keys.rsu);
    rsuList.forEach(function(r) {
      if (!r.vesting) return;
      r.vesting.forEach(function(v) {
        var dt = v.date.replace(/-/g, "");
        var summary = "📈 RSU · " + r.name + " 解禁 " + v.shares + "股";
        var desc = "公司：" + r.name + "\\n解禁股数：" + v.shares + "股\\n当前市价：¥" + (parseFloat(r.currentPrice)||0).toFixed(2);

        lines.push("BEGIN:VEVENT");
        lines.push("UID:rsu-" + r.code + "-" + v.date + "@family-finance");
        lines.push("DTSTART:" + dt + "T000000");
        lines.push("SUMMARY:" + summary);
        lines.push("DESCRIPTION:" + desc);
        lines.push("BEGIN:VALARM");
        lines.push("TRIGGER:-PT1440M");
        lines.push("ACTION:DISPLAY");
        lines.push("DESCRIPTION:提醒：" + summary);
        lines.push("END:VALARM");
        lines.push("END:VEVENT");
      });
    });

    lines.push("END:VCALENDAR");

    var content = lines.join("\r\n");
    var blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "家庭资产管理-缴费还款日历.ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast("日历文件已开始下载", "success");
  },

  escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  },

  formatMoney(amount) {
    const num = parseFloat(amount) || 0;
    return "¥" + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  },

  // 格式化数字（不带¥符号，用于原币种显示）
  _formatNum(amount) {
    const num = parseFloat(amount) || 0;
    return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  },

  // ============================================
  // CSV 账单导入
  // ============================================

  _csvParsedRecords: [],
  _csvDedupCount: 0,
  _editingAccountId: null,

  // 余额编辑弹窗事件绑定
  setupEditBalance() {
    var self = this;
    var el;

    el = document.getElementById("cancelEditBalanceBtn");
    if (el) el.addEventListener("click", function() { self.closeEditBalance(); });

    el = document.getElementById("confirmEditBalanceBtn");
    if (el) el.addEventListener("click", function() { self.confirmEditBalance(); });

    // 点击遮罩关闭
    el = document.getElementById("editBalanceOverlay");
    if (el) el.addEventListener("click", function(e) {
      if (e.target === this) self.closeEditBalance();
    });

    // Enter 键确认
    el = document.getElementById("editBalanceInput");
    if (el) el.addEventListener("keydown", function(e) {
      if (e.key === "Enter") self.confirmEditBalance();
      if (e.key === "Escape") self.closeEditBalance();
    });
  },

  setupAddCashAccount() {
    var self = this;
    var el;

    el = document.getElementById("addCashAccountBtn");
    if (el) el.addEventListener("click", function() { self.openAddCashAccount(); });

    el = document.getElementById("cancelAddCashBtn");
    if (el) el.addEventListener("click", function() { self.closeAddCashAccount(); });

    el = document.getElementById("confirmAddCashBtn");
    if (el) el.addEventListener("click", function() { self.confirmAddCashAccount(); });

    // 点击遮罩关闭
    el = document.getElementById("addCashOverlay");
    if (el) el.addEventListener("click", function(e) {
      if (e.target === this) self.closeAddCashAccount();
    });

    // 图标选择
    var opts = document.querySelectorAll("#cashIconPicker .cash-icon-option");
    opts.forEach(function(opt) {
      opt.addEventListener("click", function() {
        opts.forEach(function(o) { o.classList.remove("selected"); });
        this.classList.add("selected");
        self._selectedCashIcon = this.getAttribute("data-icon");
      });
    });

    // Enter 键确认（在金额输入框按 Enter）
    el = document.getElementById("addCashBalance");
    if (el) el.addEventListener("keydown", function(e) {
      if (e.key === "Enter") self.confirmAddCashAccount();
    });
    el = document.getElementById("addCashNote");
    if (el) el.addEventListener("keydown", function(e) {
      if (e.key === "Enter") self.confirmAddCashAccount();
      if (e.key === "Escape") self.closeAddCashAccount();
    });
    el = document.getElementById("addCashLabel");
    if (el) el.addEventListener("keydown", function(e) {
      if (e.key === "Escape") self.closeAddCashAccount();
    });
  },

  setupCSVImport() {
    var self = this;
    var el;

    // 打开导入面板
    el = document.getElementById("importCSVBtn");
    if (el) el.addEventListener("click", () => this.openImportPanel());

    // 关闭按钮
    el = document.getElementById("closeImportBtn");
    if (el) el.addEventListener("click", () => this.closeImportPanel());

    // 点击遮罩关闭
    el = document.getElementById("importOverlay");
    if (el) el.addEventListener("click", function(e) {
      if (e.target === this) self.closeImportPanel();
    });

    // 来源切换
    var sourceRadios = document.querySelectorAll('input[name="csvSource"]');
    sourceRadios.forEach(function(radio) {
      radio.addEventListener("change", function() {
        document.querySelectorAll(".source-option").forEach(function(opt) {
          opt.classList.toggle("active", opt.querySelector("input").checked);
        });
      });
    });

    // 文件选择
    el = document.getElementById("csvFileInput");
    if (el) el.addEventListener("change", function(e) {
      if (e.target.files.length > 0) self.handleCSVFile(e.target.files[0]);
    });

    // 拖拽上传
    var dropzone = document.getElementById("importDropzone");
    if (dropzone) {
      dropzone.addEventListener("click", function() {
        document.getElementById("csvFileInput").click();
      });
      dropzone.addEventListener("dragover", function(e) {
        e.preventDefault();
        this.classList.add("drag-over");
      });
      dropzone.addEventListener("dragleave", function() {
        this.classList.remove("drag-over");
      });
      dropzone.addEventListener("drop", function(e) {
        e.preventDefault();
        this.classList.remove("drag-over");
        if (e.dataTransfer.files.length > 0) self.handleCSVFile(e.dataTransfer.files[0]);
      });
    }

    // 预览操作
    el = document.getElementById("cancelPreviewBtn");
    if (el) el.addEventListener("click", () => this.closeImportPanel());

    el = document.getElementById("confirmImportBtn");
    if (el) el.addEventListener("click", () => this.confirmCSVImport());

    el = document.getElementById("selectAllCheckbox");
    if (el) el.addEventListener("change", function() {
      var checked = this.checked;
      document.querySelectorAll(".preview-checkbox").forEach(function(cb) {
        cb.checked = checked;
      });
    });
  },

  openImportPanel() {
    // 重置状态
    this._csvParsedRecords = [];
    this._csvDedupCount = 0;
    document.getElementById("csvFileInput").value = "";
    document.getElementById("importOverlay").style.display = "flex";
    document.getElementById("importDropzone").style.display = "block";
    document.getElementById("importStatus").style.display = "none";
    document.getElementById("importPreview").style.display = "none";
    // 默认选中"自动识别"
    document.querySelector('input[name="csvSource"][value="auto"]').checked = true;
    document.querySelectorAll(".source-option").forEach(function(opt) {
      opt.classList.toggle("active", opt.querySelector("input").value === "auto");
    });
  },

  closeImportPanel() {
    document.getElementById("importOverlay").style.display = "none";
  },

  handleCSVFile(file) {
    var self = this;

    // 文件大小检查（>10MB 提示）
    if (file.size > 10 * 1024 * 1024) {
      this.showToast("文件过大（>10MB），建议按月导出后再导入", "error");
      return;
    }

    // 显示解析状态
    document.getElementById("importDropzone").style.display = "none";
    document.getElementById("importStatus").style.display = "flex";

    var reader = new FileReader();
    reader.onload = function(e) {
      var buffer = e.target.result;
      var text = self.tryDecodeCSV(buffer);
      var sourceType = self.getSelectedSource();
      self.parseCSVAndPreview(text, sourceType, file.name);
    };
    reader.onerror = function() {
      self.showToast("文件读取失败，请重试", "error");
      document.getElementById("importStatus").style.display = "none";
      document.getElementById("importDropzone").style.display = "block";
    };

    // 用 ArrayBuffer 读取，后续手动处理编码
    reader.readAsArrayBuffer(file);
  },

  getSelectedSource() {
    var checked = document.querySelector('input[name="csvSource"]:checked');
    return checked ? checked.value : "auto";
  },

  // 自动检测编码并解码 ArrayBuffer
  tryDecodeCSV(buffer) {
    var arr = new Uint8Array(buffer);

    // 先尝试 UTF-8
    try {
      var text = new TextDecoder("utf-8", { fatal: true }).decode(arr);
      // 如果解码成功但包含大量乱码特征，可能是 GBK
      if (!this._looksLikeGarbled(text)) return text;
    } catch(e) {
      // UTF-8 解析失败，尝试 GBK
    }

    // 尝试 GBK/GB2312
    try {
      var gbkText = new TextDecoder("gbk", { fatal: true }).decode(arr);
      return gbkText;
    } catch(e) {
      // 最后回退：忽略错误
      return new TextDecoder("utf-8").decode(arr);
    }
  },

  // 简单检测是否乱码：如果出现大量替换字符 � 或不可打印字符
  _looksLikeGarbled(text) {
    var replacementCount = 0;
    for (var i = 0; i < Math.min(text.length, 500); i++) {
      if (text.charCodeAt(i) === 0xFFFD) replacementCount++;
      // 检测大量高位 Latin-1 乱码特征（GBK 被误读为 Latin-1）
      if (text.charCodeAt(i) >= 0x80 && text.charCodeAt(i) <= 0x9F) replacementCount++;
    }
    return replacementCount > 10;
  },

  // 在 CSV 行中查找表头位置（跳过支付宝回单头部信息）
  findHeaderRow(rows) {
    var headerKeywords = ["交易时间", "交易时间", "记账日期", "交易类型"];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.length < 3) continue;
      var joined = row.join(",");
      // 检查是否包含表头关键词
      var matchCount = 0;
      for (var k = 0; k < headerKeywords.length; k++) {
        if (joined.indexOf(headerKeywords[k]) !== -1) matchCount++;
      }
      if (matchCount >= 2) return i;
    }
    return 0; // 找不到就返回第一行
  },

  parseCSVAndPreview(text, sourceType, fileName) {
    var self = this;

    // 检测 BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    var rows = this.parseCSVText(text);
    if (!rows || rows.length < 2) {
      document.getElementById("importStatus").style.display = "none";
      document.getElementById("importDropzone").style.display = "block";
      this.showToast("文件中没有有效数据", "error");
      return;
    }

    // 跳过支付宝回单头部信息，找到真正的表头行
    var headerIndex = this.findHeaderRow(rows);
    var headers = rows[headerIndex];
    headers = headers.map(function(h) { return h.trim().replace(/\t/g, ""); });

    // 自动检测来源
    if (sourceType === "auto") {
      sourceType = this.detectCSVSource(headers);
    }

    if (sourceType === "unknown") {
      document.getElementById("importStatus").style.display = "none";
      document.getElementById("importDropzone").style.display = "block";
      this.showToast("无法识别 CSV 格式，请手动选择账单来源（支付宝/微信/招商银行）", "error");
      return;
    }

    // 解析数据行（从表头下一行开始）
    var records = [];
    var skippedNonTrade = 0;
    for (var i = headerIndex + 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row.some(function(c) { return c.trim(); })) continue; // 跳过空行

      // 清理每个字段中的 \t
      row = row.map(function(c) { return (c || "").replace(/\t/g, "").trim(); });

      // 检查是否为支付宝尾部统计信息（如"已导入XX条"等）
      var firstCell = (row[0] || "").trim();
      if (firstCell && !firstCell.match(/^\d{4}-\d{2}-\d{2}/)) continue; // 跳过非日期开头的行

      var record = this.parseCSVRow(row, headers, sourceType);
      if (record === "skip") { skippedNonTrade++; continue; }
      if (record) records.push(record);
    }

    if (records.length === 0) {
      document.getElementById("importStatus").style.display = "none";
      document.getElementById("importDropzone").style.display = "block";
      var msg = "未解析到任何有效的收支记录";
      if (skippedNonTrade > 0) msg += "（已跳过 " + skippedNonTrade + " 条不计收支记录）";
      this.showToast(msg, "error");
      return;
    }

    // 去重
    var dedupResult = this.deduplicateCSV(records);
    this._csvParsedRecords = dedupResult.records;
    this._csvDedupCount = dedupResult.skipped;

    // 渲染预览
    this.renderCSVPreview(this._csvParsedRecords, sourceType, this._csvDedupCount, skippedNonTrade);

    document.getElementById("importStatus").style.display = "none";
    document.getElementById("importPreview").style.display = "block";
  },

  parseCSVText(text) {
    // 支持引号包裹的字段（含逗号和换行）
    var rows = [];
    var current = [];
    var field = "";
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          current.push(field);
          field = "";
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
          current.push(field);
          field = "";
          rows.push(current);
          current = [];
        } else {
          field += ch;
        }
      }
    }
    // 处理最后一行（无换行符结尾）
    current.push(field);
    if (current.some(function(c) { return c.trim(); })) {
      rows.push(current);
    }

    return rows;
  },

  detectCSVSource(headers) {
    var h = headers.join(",");
    if (h.includes("收/付款方式") || h.includes("交易分类")) return "alipay";
    if (h.includes("支付方式") && (h.includes("当前状态") || h.includes("交易类型"))) return "wechat";
    if (h.includes("记账日期") || (h.includes("收入金额") && h.includes("支出金额"))) return "cmb";
    return "unknown";
  },

  parseCSVRow(row, headers, sourceType) {
    var get = function(keywords) {
      for (var i = 0; i < keywords.length; i++) {
        var idx = -1;
        for (var j = 0; j < headers.length; j++) {
          if (headers[j].includes(keywords[i])) { idx = j; break; }
        }
        if (idx >= 0 && idx < row.length) {
          var val = (row[idx] || "").trim();
          if (val) return val;
        }
      }
      return "";
    };

    var amount, type;
    var balance = "";

    if (sourceType === "cmb") {
      // 招商银行：收入金额 / 支出金额 两列互斥
      var incomeStr = get(["收入金额"]).replace(/[,¥￥\s]/g, "");
      var expenseStr = get(["支出金额"]).replace(/[,¥￥\s]/g, "");
      var income = parseFloat(incomeStr);
      var expense = parseFloat(expenseStr);
      if (!isNaN(income) && income > 0) { amount = income; type = "income"; }
      else if (!isNaN(expense) && expense > 0) { amount = expense; type = "expense"; }
      else return null;
      balance = get(["余额"]);
    } else {
      // 支付宝 / 微信
      var typeStr = get(["收/支"]);
      // "不计收支"（余额宝收益发放等）— 跳过
      if (typeStr && typeStr.indexOf("不计收支") !== -1) return "skip";

      var amountStr = get(["金额"]);
      if (!amountStr) return null;
      amount = parseFloat(amountStr.replace(/[,¥￥\s]/g, ""));
      if (isNaN(amount) || amount <= 0) return null;
      type = (typeStr.indexOf("支出") !== -1 || typeStr === "支") ? "expense" : "income";
    }

    var date = (get(["交易时间", "记账日期"]) || "").split(" ")[0];
    if (!date) return null;

    var merchant = get(["交易对方"]);
    var note = get(["商品说明", "商品", "交易摘要"]);
    var method = get(["收/付款方式", "支付方式"]);

    // 合并备注：交易对方 + 商品说明
    var fullNote = [merchant, note].filter(Boolean).join(" · ");
    if (!fullNote) fullNote = (type === "income" ? "收入" : "支出");

    return {
      type: type,
      amount: amount,
      date: date,
      merchant: merchant,
      note: note,
      method: method,
      balance: balance,
      category: this.autoClassifyCSV(merchant, note),
      source: sourceType
    };
  },

  autoClassifyCSV(merchant, note) {
    var text = ((merchant || "") + " " + (note || "")).toLowerCase();
    var rules = [
      { keys: ["外卖", "美团", "饿了么", "餐厅", "饭", "食", "咖啡", "奶茶", "甜品", "肯德基", "麦当劳", "星巴克", "瑞幸", "快餐", "小吃", "火锅", "烧烤", "面馆", "烘焙"], cat: "food" },
      { keys: ["超市", "便利店", "京东", "淘宝", "拼多多", "天猫", "商场", "百货", "唯品会", "闲鱼", "当当", "网易严选", "小米商城"], cat: "shopping" },
      { keys: ["地铁", "公交", "滴滴", "加油", "停车", "高铁", "机票", "火车", "单车", "骑行", "哈啰", "神州", "一嗨", "etc"], cat: "transport" },
      { keys: ["房租", "物业", "水电", "燃气", "宽带", "话费", "暖气", "有线电视"], cat: "housing" },
      { keys: ["医院", "药", "诊所", "体检", "门诊", "挂号", "医保"], cat: "medical" },
      { keys: ["电影", "游戏", "ktv", "旅游", "酒店", "景点", "门票", "度假", "携程", "飞猪", "airbnb", "民宿", "演唱会", "演出", "展览"], cat: "entertainment" },
      { keys: ["学费", "课程", "书", "培训", "考试", "得到", "知乎", "极客"], cat: "education" }
    ];
    for (var i = 0; i < rules.length; i++) {
      for (var j = 0; j < rules[i].keys.length; j++) {
        if (text.indexOf(rules[i].keys[j]) !== -1) return rules[i].cat;
      }
    }
    return "other";
  },

  deduplicateCSV(records) {
    var existing = [];
    existing = existing.concat(Storage.get(Storage.keys.income));
    existing = existing.concat(Storage.get(Storage.keys.expense));

    var existingKeys = {};
    existing.forEach(function(r) {
      var d = r.date || "";
      var a = parseFloat(r.amount) || 0;
      var m = r.merchant || r.source || r.note || "";
      existingKeys[d + "_" + a.toFixed(2) + "_" + m] = true;
    });

    var deduped = [];
    var skipped = 0;
    records.forEach(function(r) {
      var key = r.date + "_" + r.amount.toFixed(2) + "_" + r.merchant;
      if (existingKeys[key]) {
        skipped++;
      } else {
        deduped.push(r);
        existingKeys[key] = true; // 防止同批次内重复
      }
    });

    return { records: deduped, skipped: skipped };
  },

  renderCSVPreview(records, sourceType, dedupCount, skippedNonTrade) {
    var sourceLabel = { alipay: "支付宝", wechat: "微信", cmb: "招商银行" }[sourceType] || sourceType;

    var totalIncome = 0, totalExpense = 0, incomeCount = 0, expenseCount = 0;
    records.forEach(function(r) {
      if (r.type === "income") { totalIncome += r.amount; incomeCount++; }
      else { totalExpense += r.amount; expenseCount++; }
    });

    var summary = document.getElementById("previewSummary");
    var parts = [
      "识别来源：<strong>" + sourceLabel + "</strong>",
      "共 <strong>" + records.length + "</strong> 条记录",
      "收入 <strong class=\"summary-income\">" + incomeCount + " 笔 ¥" + this.formatMoney(totalIncome) + "</strong>",
      "支出 <strong class=\"summary-expense\">" + expenseCount + " 笔 ¥" + this.formatMoney(totalExpense) + "</strong>"
    ];
    if (dedupCount > 0) {
      parts.push("<span class=\"summary-skip\">已跳过 " + dedupCount + " 条重复记录</span>");
    }
    if (skippedNonTrade > 0) {
      parts.push("<span class=\"summary-skip\">已跳过 " + skippedNonTrade + " 条不计收支（如余额宝收益）</span>");
    }
    summary.innerHTML = parts.join(" &nbsp;|&nbsp; ");

    // 渲染表格
    var tbody = document.getElementById("previewTbody");
    var html = "";
    var catLabels = { food: "餐饮", shopping: "购物", housing: "住房", transport: "交通", education: "教育", medical: "医疗", entertainment: "娱乐", other: "其他" };
    records.forEach(function(r, i) {
      var cls = r.type === "income" ? "tx-income" : "tx-expense";
      var prefix = r.type === "income" ? "+" : "-";
      html += "<tr>";
      html += "<td class=\"tx-checkbox\"><input type=\"checkbox\" class=\"preview-checkbox\" data-index=\"" + i + "\" checked></td>";
      html += "<td>" + (r.date || "") + "</td>";
      html += "<td class=\"" + cls + "\">" + (r.type === "income" ? "收入" : "支出") + "</td>";
      html += "<td class=\"tx-amount " + cls + "\">" + prefix + this.formatMoney(r.amount) + "</td>";
      html += "<td>" + (r.merchant || r.note || "-") + "</td>";
      html += "<td>" + (catLabels[r.category] || "其他") + "</td>";
      html += "<td>" + sourceLabel + "</td>";
      html += "</tr>";
    }.bind(this));
    tbody.innerHTML = html;

    // 全选状态
    document.getElementById("selectAllCheckbox").checked = true;

    // 更新确认按钮文案
    var confirmBtn = document.getElementById("confirmImportBtn");
    if (confirmBtn) confirmBtn.textContent = "确认导入 " + records.length + " 条";
  },

  confirmCSVImport() {
    var self = this;
    var selectedIndices = [];
    document.querySelectorAll(".preview-checkbox:checked").forEach(function(cb) {
      selectedIndices.push(parseInt(cb.getAttribute("data-index")));
    });

    if (selectedIndices.length === 0) {
      this.showToast("请至少选择一条记录", "error");
      return;
    }

    var importCount = 0;
    selectedIndices.forEach(function(idx) {
      var r = self._csvParsedRecords[idx];
      if (!r) return;

      if (r.type === "income") {
        Storage.add(Storage.keys.income, {
          type: self.mapCategoryToIncomeType(r.category),
          amount: r.amount,
          source: r.merchant || r.note || "",
          date: r.date,
          csvSource: r.source
        });
      } else {
        Storage.add(Storage.keys.expense, {
          category: r.category,
          amount: r.amount,
          method: r.method || "",
          note: r.merchant ? (r.note ? r.merchant + " · " + r.note : r.merchant) : (r.note || ""),
          date: r.date,
          csvSource: r.source
        });
      }
      importCount++;
    });

    this.closeImportPanel();
    this.loadTransactions();
    this.loadDashboard();
    this.showToast("成功导入 " + importCount + " 条记录");
  },

  // 将自动分类映射到现有收入类型
  mapCategoryToIncomeType(category) {
    var map = { food: "other", shopping: "other", housing: "rent", transport: "other", education: "other", medical: "other", entertainment: "other", other: "other" };
    return map[category] || "other";
  },

  showToast(message, type) {
    type = type || "success";
    if (!this._toastStyleAdded) {
      const style = document.createElement("style");
      style.textContent = "@keyframes slideDown{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}";
      document.head.appendChild(style);
      this._toastStyleAdded = true;
    }
    const toast = document.createElement("div");
    toast.style.cssText = "position:fixed;top:70px;left:50%;transform:translateX(-50%);background:" + (type==="error"?"#ef4444":"#22c55e") + ";color:white;padding:12px 24px;border-radius:8px;font-size:14px;z-index:1000;animation:slideDown 0.3s ease;";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0"; toast.style.transition = "opacity 0.3s";
      setTimeout(() => { toast.remove(); }, 300);
    }, 2000);
  }
};

document.addEventListener("DOMContentLoaded", () => App.init());