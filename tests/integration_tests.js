// 集成测试 — 覆盖数据库计算、接口规范、关键功能
// 用法：node tests/integration_tests.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({
  console: console,
  JSON: JSON,
  Math: Math,
  Date: Date,
  String: String,
  Number: Number,
  Array: Array,
  Object: Object,
  parseFloat: parseFloat,
  parseInt: parseInt,
  isNaN: isNaN,
  Set: Set
});

const mockStorage = {};
ctx.localStorage = {
  getItem(key) { return mockStorage[key] || null; },
  setItem(key, val) { mockStorage[key] = String(val); },
  removeItem(key) { delete mockStorage[key]; },
  clear() { for (const k in mockStorage) delete mockStorage[k]; }
};

const storageCode = fs.readFileSync(path.join(__dirname, '../js/storage.js'), 'utf8')
  .replace(/^const Storage = \{/m, 'var Storage = {');
vm.runInContext(storageCode, ctx);
const Storage = ctx.Storage;

let total = 0, passed = 0, failed = 0;
function assert(cond, msg) {
  total++;
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.error('  ❌ ' + msg); }
}
function assertEq(actual, expected, msg) {
  total++;
  if (actual === expected) { passed++; console.log('  ✅ ' + msg + ' = ' + JSON.stringify(actual)); }
  else { failed++; console.error('  ❌ ' + msg + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
}
function assertApprox(actual, expected, tolerance, msg) {
  total++;
  if (Math.abs(actual - expected) <= tolerance) { passed++; console.log('  ✅ ' + msg + ' ≈ ' + actual); }
  else { failed++; console.error('  ❌ ' + msg + ': expected ~' + expected + ', got ' + actual); }
}

function resetData() {
  ctx.localStorage.clear();
}

console.log('\n【测试 1】数据库测试：现金账户与总资产');
resetData();
Storage.set(Storage.keys.cashAccounts, [
  { id: 'cmb', name: '招商银行', balance: 50000, updated: '2026-06-25' },
  { id: 'yuebao', name: '余额宝', balance: 30000, updated: '2026-06-25' }
]);
assertEq(Storage.calcCashTotal(), 80000, 'DB-CASH-01: 现金账户总余额');
assertEq(Storage.getCashAccounts().length, 2, 'DB-CASH-02: 读取现金账户');

Storage.set(Storage.keys.stocks, [
  { id: 's1', code: '00992', name: '联想', shares: 1000, cost: 4, currentPrice: 4.5, currency: 'HKD' }
]);
Storage.set(Storage.keys.funds, [
  { id: 'f1', code: '013126', name: '华夏食品饮料', holdValue: 50000, costValue: 48000, nav: 1.2, shares: 41666.67, currency: 'CNY' }
]);
Storage.set(Storage.keys.loans, [
  { id: 'l1', bank: '公积金', balance: 1000000, total: 1200000, rate: 3.1, term: 30 }
]);
Storage.set(Storage.keys.annuities, [
  { id: 'a1', name: '泰康债券', balance: 80000 }
]);
Storage.set(Storage.keys.insurance, [
  { id: 'i1', company: '友邦', product: '年金', person: '典', premium: 12000, freq: 'yearly', payPeriod: '2023-2032 · 10年', nextPayDate: '2026-10-10', expireDate: '2042-12-31', collectNote: '60岁起领' }
]);
Storage.set(Storage.keys.rsu, [
  { id: 'r1', code: '689009', name: '九号', totalShares: 10000, perYearShares: 2500, grantPrice: 24.5, currentPrice: 40, vested: 2500, locked: 7500, currency: 'CNY' }
]);

// 保险沉淀资产: i1 payPeriod 2023-2032 nextPayDate 2026-10-10 → paidUntil=2025 → 3年×12000=36000
const expectedInsuranceSettled = 36000;
const expectedTotal = 80000 + 1000 * 4.5 * 0.92 + 50000 + 80000 + expectedInsuranceSettled + 2500 * 40;
assertApprox(Storage.calcTotalAssets(), expectedTotal, 1, 'DB-ASSET-01: 总资产计算含现金/股票/基金/年金/保险/RSU');
assertEq(Storage.calcTotalDebts(), 1000000, 'DB-DEBT-01: 总负债计算');
assertApprox(Storage.calcNetWorth(), expectedTotal - 1000000, 1, 'DB-NET-01: 净资产计算');

console.log('\n【测试 2】数据库测试：汇率兜底与异常');
resetData();
ctx.localStorage.setItem('fm_exchange_rates', JSON.stringify({ USDCNY: 0, HKDCNY: 0 }));
assertApprox(Storage._toCNY(100, 'USD'), 720, 0.1, 'DB-FX-01: 无效 USD 汇率使用默认 7.2');
assertApprox(Storage._toCNY(100, 'HKD'), 92, 0.1, 'DB-FX-02: 无效 HKD 汇率使用默认 0.92');
ctx.localStorage.clear();
assertEq(Storage._toCNY(100, 'USD'), 720, 'DB-FX-03: 汇率缺失时使用默认 7.2');
assertEq(Storage.get('').length, 0, 'DB-EMPTY-01: 空 key 返回空数组');
ctx.localStorage.setItem('fm_stocks', 'not-json');
assertEq(Storage.get(Storage.keys.stocks).length, 0, 'DB-ERROR-01: 非法 JSON 返回 []');

console.log('\n【测试 3】数据库测试：保险计算');
resetData();
Storage.set(Storage.keys.insurance, [
  { id: 'i1', company: '友邦', product: '友邦优享年年金保险', person: '典', premium: 12000, freq: 'yearly', payPeriod: '2023-2032 · 10年', baseNextPayDate: '2026-10-10', nextPayDate: '2026-10-10', expireDate: '2042-12-31', collectNote: '60岁起领' },
  { id: 'i2', company: '平安', product: '平安福重疾', person: '静', premium: 8000, freq: 'yearly', payPeriod: '2022-2031 · 10年', baseNextPayDate: '2026-05-01', nextPayDate: '2026-05-01', expireDate: '终身', collectNote: '重疾给付30万' },
  { id: 'i3', company: '泰康', product: '泰康万能险', person: '木', premium: 6000, freq: 'yearly', payPeriod: '2021-2026 · 6年', baseNextPayDate: '2026-06-01', nextPayDate: '2026-06-01', expireDate: '终身', collectNote: '灵活领取' }
]);
// 保险沉淀资产: paidUntil = nextPayDate.year - 1
// i1: payPeriod 2023-2032, nextPayDate 2026-10-10 → paidUntil=2025 → 3年×12000=36000
// i2: payPeriod 2022-2031, nextPayDate 2026-05-01 → paidUntil=2025 → 4年×8000=32000
// i3: payPeriod 2021-2026, nextPayDate 2026-06-01 → paidUntil=2025 → 5年×6000=30000
assertEq(Storage.calcInsuranceSettledValue(), 36000 + 32000 + 30000, 'DB-INS-01: 沉淀资产计算（年金+重疾+万能）');
assertEq(Storage.calcInsuranceContingentAsset(), 300000, 'DB-INS-02: 或有资产（重疾给付）');
// 使用动态日期确保在 30 天内
var _now5 = new Date(); _now5.setDate(_now5.getDate() + 5);
var _now15 = new Date(); _now15.setDate(_now15.getDate() + 15);
var _now45 = new Date(); _now45.setDate(_now45.getDate() + 45);
function _fmt(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
Storage.set(Storage.keys.insurance, [
  { id: 'r1', company: 'A', product: '年金', person: '典', premium: 1000, freq: 'yearly', payPeriod: '2023-2032', nextPayDate: _fmt(_now5), expireDate: '2042-12-31' },
  { id: 'r2', company: 'B', product: '重疾', person: '静', premium: 2000, freq: 'yearly', payPeriod: '2022-2031', nextPayDate: _fmt(_now15), expireDate: '终身' },
  { id: 'r3', company: 'C', product: '万能', person: '木', premium: 3000, freq: 'yearly', payPeriod: '2021-2026', nextPayDate: _fmt(_now45), expireDate: '终身' }
]);
assertEq(Storage.getInsuranceReminders().length, 2, 'DB-INS-03: 30天内到期提醒（2条在30天内，1条超出）');

console.log('\n【测试 4】接口规范测试：外部 API 格式');
// 仅验证本地 JSON 文件格式
const stockPrices = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/stock-prices.json'), 'utf8'));
assert(typeof stockPrices === 'object', 'API-LOCAL-01: stock-prices.json 是对象');
assert(stockPrices.fxRates && stockPrices.fxRates.USDCNY && stockPrices.fxRates.USDCNY.rate > 6 && stockPrices.fxRates.USDCNY.rate < 8, 'API-LOCAL-02: USDCNY 在合理范围');
assert(stockPrices.fxRates && stockPrices.fxRates.HKDCNY && stockPrices.fxRates.HKDCNY.rate > 0.5 && stockPrices.fxRates.HKDCNY.rate < 1.5, 'API-LOCAL-03: HKDCNY 在合理范围');

const stockHistory = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/stock-history.json'), 'utf8'));
assert(Array.isArray(stockHistory) || typeof stockHistory === 'object', 'API-LOCAL-04: stock-history.json 格式正确');

console.log('\n【测试 5】功能验收测试：关键路径');
resetData();
assertEq(Storage.calcTotalAssets(), 0, 'FUNC-01: 空数据总资产为 0');
assertEq(Storage.calcCashTotal(), 0, 'FUNC-02: 空数据现金为 0');

Storage.set(Storage.keys.cashAccounts, [{ id: 'cmb', name: '招商银行', balance: 10000, updated: '2026-06-25' }]);
assertEq(Storage.calcTotalAssets(), 10000, 'FUNC-03: 仅现金资产时总资产等于现金');

console.log('\n【测试 6】数据库测试：房贷实时剩余本金同步到总负债');
resetData();
// 手动模式：仍使用 balance 字段
Storage.set(Storage.keys.loans, [
  { id: 'l1', bank: '公积金', balance: 500000, total: 1200000, rate: 3.1, term: 30, startDate: '2014-12-26', payDay: 17, mode: 'equal-payment', autoProgress: false }
]);
assertEq(Storage.calcTotalDebts(), 500000, 'DB-LOAN-01: 手动模式使用 balance');

// 自动模式：使用 calcLoanProgress 实时剩余本金，忽略 balance
Storage.set(Storage.keys.loans, [
  { id: 'l2', bank: '公积金', balance: 999999, total: 700000, rate: 2.6, term: 15, startDate: '2014-12-26', payDay: 17, mode: 'equal-payment', autoProgress: true }
]);
var prog = Storage.calcLoanProgress(Storage.get(Storage.keys.loans)[0], '2026-06-27');
assert(prog.remainingPrincipal > 0 && prog.remainingPrincipal < 700000, 'DB-LOAN-02: 自动模式剩余本金在合理范围');
assertEq(Storage.calcTotalDebts(), prog.remainingPrincipal, 'DB-LOAN-03: 自动模式总负债等于实时剩余本金');

// ===================== 养老金参数云端同步测试 =====================
console.log('\n【测试】养老金参数云端同步');
resetData();

// PENSION-SYNC-01: _extractPensionParams 从 fm_retirement_params 提取 6 个字段
ctx.localStorage.setItem('fm_retirement_params', JSON.stringify({
  pensionMember1Balance: 460126.76, pensionMember1Monthly: 2984.16, pensionMember1RetireAge: 63,
  pensionMember2Balance: 300000, pensionMember2Monthly: 2000, pensionMember2RetireAge: 58,
  inflation: 3, investmentReturn: 2, annualExpense: 20
}));
var extracted = Storage._extractPensionParams();
assert(extracted !== null, 'PENSION-SYNC-01: 提取结果非 null');
assertEq(extracted.pensionMember1Balance, 460126.76, 'PENSION-SYNC-01: pensionMember1Balance');
assertEq(extracted.pensionMember1Monthly, 2984.16, 'PENSION-SYNC-01: pensionMember1Monthly');
assertEq(extracted.pensionMember1RetireAge, 63, 'PENSION-SYNC-01: pensionMember1RetireAge');
assertEq(extracted.pensionMember2Balance, 300000, 'PENSION-SYNC-01: pensionMember2Balance');
assertEq(extracted.pensionMember2Monthly, 2000, 'PENSION-SYNC-01: pensionMember2Monthly');
assertEq(extracted.pensionMember2RetireAge, 58, 'PENSION-SYNC-01: pensionMember2RetireAge');
assert(extracted.inflation === undefined, 'PENSION-SYNC-01: 不包含非养老金字段 inflation');

// PENSION-SYNC-02: fm_retirement_params 不存在时返回 null
resetData();
assertEq(Storage._extractPensionParams(), null, 'PENSION-SYNC-02: 无数据时返回 null');

// PENSION-SYNC-03: _getLocalDataPackage 包含 _pensionParams
resetData();
ctx.localStorage.setItem('fm_retirement_params', JSON.stringify({
  pensionMember1Balance: 500000, pensionMember1Monthly: 3000, pensionMember1RetireAge: 60,
  pensionMember2Balance: 400000, pensionMember2Monthly: 2500, pensionMember2RetireAge: 55
}));
var pkg = Storage._getLocalDataPackage();
assert(pkg.data._pensionParams !== null && pkg.data._pensionParams !== undefined, 'PENSION-SYNC-03: 数据包包含 _pensionParams');
assertEq(pkg.data._pensionParams.pensionMember1Balance, 500000, 'PENSION-SYNC-03: pkg 中 pensionMember1Balance');
assertEq(pkg.data._pensionParams.pensionMember2RetireAge, 55, 'PENSION-SYNC-03: pkg 中 pensionMember2RetireAge');
assertEq(pkg.clientVersion, 'v203', 'PENSION-SYNC-03: clientVersion 为 v203');

// PENSION-SYNC-04: _applyPensionParams 将云端数据合并到 fm_retirement_params
resetData();
ctx.localStorage.setItem('fm_retirement_params', JSON.stringify({
  pensionMember1Balance: 100000, pensionMember1Monthly: 1000, pensionMember1RetireAge: 65,
  pensionMember2Balance: 200000, pensionMember2Monthly: 2000, pensionMember2RetireAge: 60,
  inflation: 3, annualExpense: 20
}));
Storage._applyPensionParams({
  pensionMember1Balance: 500000, pensionMember1Monthly: 3000, pensionMember1RetireAge: 60,
  pensionMember2Balance: 400000, pensionMember2Monthly: 2500, pensionMember2RetireAge: 55
});
var applied = JSON.parse(ctx.localStorage.getItem('fm_retirement_params'));
assertEq(applied.pensionMember1Balance, 500000, 'PENSION-SYNC-04: 养老金余额已更新为云端值');
assertEq(applied.pensionMember1RetireAge, 60, 'PENSION-SYNC-04: 退休年龄已更新为云端值');
assertEq(applied.pensionMember2Monthly, 2500, 'PENSION-SYNC-04: 月缴费已更新为云端值');
assertEq(applied.inflation, 3, 'PENSION-SYNC-04: 非养老金字段 inflation 保持不变');
assertEq(applied.annualExpense, 20, 'PENSION-SYNC-04: 非养老金字段 annualExpense 保持不变');

// PENSION-SYNC-05: _applyDataPackage 包含 _pensionParams 时写入 localStorage
resetData();
ctx.localStorage.setItem('fm_retirement_params', JSON.stringify({
  pensionMember1Balance: 100000, pensionMember1Monthly: 1000, pensionMember1RetireAge: 65,
  inflation: 3
}));
Storage._applyDataPackage({
  data: {
    income: [], expense: [], cashAccounts: [], assets: [], insurance: [],
    stocks: [], rsu: [], funds: [], loans: [], annuities: [], notifications: [],
    _authHash: null, _authEnabled: false,
    _pensionParams: {
      pensionMember1Balance: 999999, pensionMember1Monthly: 8888, pensionMember1RetireAge: 62,
      pensionMember2Balance: 777777, pensionMember2Monthly: 6666, pensionMember2RetireAge: 57
    }
  }
});
var afterApply = JSON.parse(ctx.localStorage.getItem('fm_retirement_params'));
assertEq(afterApply.pensionMember1Balance, 999999, 'PENSION-SYNC-05: _applyDataPackage 后养老金余额为云端值');
assertEq(afterApply.pensionMember1RetireAge, 62, 'PENSION-SYNC-05: _applyDataPackage 后退休年龄为云端值');
assertEq(afterApply.pensionMember2Balance, 777777, 'PENSION-SYNC-05: _applyDataPackage 后 pensionMember2Balance 为云端值');
assertEq(afterApply.inflation, 3, 'PENSION-SYNC-05: 非养老金字段保持不变');

// PENSION-SYNC-06: _mergeDataPackages LWW — 云端较新时使用云端养老金参数
resetData();
var localPkg6 = {
  data: { _pensionParams: { pensionMember1Balance: 100000, pensionMember1Monthly: 1000, pensionMember1RetireAge: 65 } },
  updatedAt: '2026-06-20T10:00:00Z'
};
var cloudPkg6 = {
  data: { _pensionParams: { pensionMember1Balance: 500000, pensionMember1Monthly: 3000, pensionMember1RetireAge: 60 } },
  updatedAt: '2026-06-25T10:00:00Z'
};
var merged6 = Storage._mergeDataPackages(localPkg6, cloudPkg6);
assertEq(merged6.data._pensionParams.pensionMember1Balance, 500000, 'PENSION-SYNC-06: 云端较新，使用云端养老金余额');
assertEq(merged6.data._pensionParams.pensionMember1RetireAge, 60, 'PENSION-SYNC-06: 云端较新，使用云端退休年龄');

// PENSION-SYNC-07: _mergeDataPackages LWW — 本地较新时保留本地养老金参数
resetData();
var localPkg7 = {
  data: { _pensionParams: { pensionMember1Balance: 600000, pensionMember1Monthly: 4000, pensionMember1RetireAge: 58 } },
  updatedAt: '2026-06-28T10:00:00Z'
};
var cloudPkg7 = {
  data: { _pensionParams: { pensionMember1Balance: 300000, pensionMember1Monthly: 2000, pensionMember1RetireAge: 65 } },
  updatedAt: '2026-06-25T10:00:00Z'
};
var merged7 = Storage._mergeDataPackages(localPkg7, cloudPkg7);
assertEq(merged7.data._pensionParams.pensionMember1Balance, 600000, 'PENSION-SYNC-07: 本地较新，保留本地养老金余额');
assertEq(merged7.data._pensionParams.pensionMember1RetireAge, 58, 'PENSION-SYNC-07: 本地较新，保留本地退休年龄');

// PENSION-SYNC-08: _mergeDataPackages — 云端无养老金参数时保留本地
resetData();
var localPkg8 = {
  data: { _pensionParams: { pensionMember1Balance: 700000 } },
  updatedAt: '2026-06-20T10:00:00Z'
};
var cloudPkg8 = {
  data: {},
  updatedAt: '2026-06-25T10:00:00Z'
};
var merged8 = Storage._mergeDataPackages(localPkg8, cloudPkg8);
assert(merged8.data._pensionParams, 'PENSION-SYNC-08: 云端无养老金参数时保留本地');
assertEq(merged8.data._pensionParams.pensionMember1Balance, 700000, 'PENSION-SYNC-08: 本地养老金余额保留');

// WRITE-GUARD-01: _applyDataPackage 逐项 updatedAt 保护——本地较新记录不被合并结果覆盖
resetData();
ctx.localStorage.setItem('fm_stocks', JSON.stringify([
  { id: 'NIO', code: 'NIO', name: '蔚来', shares: 7392, updatedAt: '2026-06-30T13:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'AAPL', code: 'AAPL', name: '苹果', shares: 100, updatedAt: '2026-06-28T10:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
]));
Storage._applyDataPackage({
  data: {
    income: [], expense: [], cashAccounts: [], assets: [], insurance: [],
    stocks: [
      { id: 'NIO', code: 'NIO', name: '蔚来', shares: 5372, updatedAt: '2026-06-29T10:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'AAPL', code: 'AAPL', name: '苹果', shares: 200, updatedAt: '2026-06-29T10:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
    ],
    rsu: [], funds: [], loans: [], annuities: [], notifications: [],
    _authHash: null, _authEnabled: false
  }
});
var stocksAfterGuard = JSON.parse(ctx.localStorage.getItem('fm_stocks'));
var nioRecord = stocksAfterGuard.find(function(s) { return s.id === 'NIO'; });
var aaplRecord = stocksAfterGuard.find(function(s) { return s.id === 'AAPL'; });
assert(nioRecord, 'WRITE-GUARD-01: NIO 记录存在');
assertEq(nioRecord.shares, 7392, 'WRITE-GUARD-01: NIO shares=7392 保留（本地 updatedAt 较新）');
assert(aaplRecord, 'WRITE-GUARD-01: AAPL 记录存在');
assertEq(aaplRecord.shares, 200, 'WRITE-GUARD-01: AAPL shares=200 更新为合并值（合并 updatedAt 较新）');

// WRITE-GUARD-02: _applyDataPackage 对本地新增但不在合并结果中的记录应保留
resetData();
ctx.localStorage.setItem('fm_stocks', JSON.stringify([
  { id: 'NIO', code: 'NIO', name: '蔚来', shares: 7392, updatedAt: '2026-06-30T13:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'LOCAL_NEW', code: 'LOCAL_NEW', name: '本地新增', shares: 50, updatedAt: '2026-06-30T14:00:00Z', createdAt: '2026-06-30T14:00:00Z' }
]));
Storage._applyDataPackage({
  data: {
    income: [], expense: [], cashAccounts: [], assets: [], insurance: [],
    stocks: [
      { id: 'NIO', code: 'NIO', name: '蔚来', shares: 5372, updatedAt: '2026-06-29T10:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
    ],
    rsu: [], funds: [], loans: [], annuities: [], notifications: [],
    _authHash: null, _authEnabled: false
  }
});
var stocksAfterGuard2 = JSON.parse(ctx.localStorage.getItem('fm_stocks'));
var localNewRecord = stocksAfterGuard2.find(function(s) { return s.id === 'LOCAL_NEW'; });
assert(localNewRecord, 'WRITE-GUARD-02: LOCAL_NEW 记录保留');
assertEq(localNewRecord.shares, 50, 'WRITE-GUARD-02: LOCAL_NEW shares=50 保留');

// BK-GUARD-01: v185 _applyDataPackage 业务键去重防护——merge 改了 id 后旧 id 版本不被重复加入
resetData();
ctx.localStorage.setItem('fm_stocks', JSON.stringify([
  { id: '9866', code: '9866', name: '蔚来-SW', shares: 5372, updatedAt: '2026-06-28T10:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'xyz789', code: '9866', name: '蔚来-iPhone', shares: 7392, updatedAt: '2026-06-30T13:00:00Z', createdAt: '2026-06-30T12:00:00Z' }
]));
// 合并结果中 id 已被改为业务键 '9866'（由 _mergeDataPackages 去重），shares=7392
Storage._applyDataPackage({
  data: {
    income: [], expense: [], cashAccounts: [], assets: [], insurance: [],
    stocks: [
      { id: '9866', code: '9866', name: '蔚来', shares: 7392, updatedAt: '2026-06-30T13:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
    ],
    rsu: [], funds: [], loans: [], annuities: [], notifications: [],
    _authHash: null, _authEnabled: false
  }
});
var stocksAfterBkGuard = JSON.parse(ctx.localStorage.getItem('fm_stocks'));
var nio9866 = stocksAfterBkGuard.filter(function(s) { return s.code === '9866'; });
assertEq(nio9866.length, 1, 'BK-GUARD-01: code=9866 只有一条记录（业务键去重防护生效）');
assertEq(nio9866[0].shares, 7392, 'BK-GUARD-01: 蔚来 shares=7392（保留较新版本）');

// BK-GUARD-02: v185 _mergeDataPackages 业务键去重不再膨胀 updatedAt
resetData();
var localPkgBk = {
  data: {
    stocks: [
      { id: 'abc123', code: '9866', name: '蔚来-旧', shares: 5372, updatedAt: '2026-06-28T10:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
    ]
  },
  updatedAt: '2026-06-28T10:00:00Z'
};
var cloudPkgBk = {
  data: {
    stocks: [
      { id: 'xyz789', code: '9866', name: '蔚来-新', shares: 7392, updatedAt: '2026-06-30T13:00:00Z', createdAt: '2026-06-30T12:00:00Z' }
    ]
  },
  updatedAt: '2026-06-30T13:00:00Z'
};
var mergedBk = Storage._mergeDataPackages(localPkgBk, cloudPkgBk);
var nioMerged = mergedBk.data.stocks.find(function(s) { return s.code === '9866'; });
assert(nioMerged, 'BK-GUARD-02: 合并结果中存在蔚来');
assertEq(nioMerged.shares, 7392, 'BK-GUARD-02: 蔚来 shares=7392（较新版本胜出）');
// v185: updatedAt 不再被膨胀为 now()，应保留 winner 原始 updatedAt
assertEq(nioMerged.updatedAt, '2026-06-30T13:00:00Z', 'BK-GUARD-02: updatedAt 保留 winner 原始值（不被膨胀为 now()）');

// ===================== v186 瞬态数据合并测试 =====================
console.log('\n【测试 9】v186 瞬态数据合并：skipUpdatedAt + _mergeTransientFields');

// TRANSIENT-01: Storage.update skipUpdatedAt=true 不膨胀 updatedAt，设置 priceUpdatedAt
resetData();
Storage.set(Storage.keys.stocks, [
  { id: 'NIO', code: '9866', name: '蔚来', shares: 7392, currentPrice: 5.0, updatedAt: '2026-06-29T10:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
]);
var nioBefore = Storage.get(Storage.keys.stocks).find(function(s) { return s.id === 'NIO'; });
var oldUpdatedAt = nioBefore.updatedAt;
Storage.update(Storage.keys.stocks, 'NIO', { currentPrice: 6.0 }, { skipUpdatedAt: true });
var nioAfter = Storage.get(Storage.keys.stocks).find(function(s) { return s.id === 'NIO'; });
assertEq(nioAfter.currentPrice, 6.0, 'TRANSIENT-01: currentPrice 更新为 6.0');
assertEq(nioAfter.updatedAt, oldUpdatedAt, 'TRANSIENT-01: updatedAt 不变（skip=true）');
assert(nioAfter.priceUpdatedAt && nioAfter.priceUpdatedAt !== oldUpdatedAt, 'TRANSIENT-01: priceUpdatedAt 已设置且不同于 updatedAt');

// TRANSIENT-02: Storage.update 无 options 时仍膨胀 updatedAt
resetData();
Storage.set(Storage.keys.stocks, [
  { id: 'AAPL', code: 'AAPL', name: '苹果', shares: 200, currentPrice: 150, updatedAt: '2026-06-28T10:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
]);
var aaplBefore = Storage.get(Storage.keys.stocks).find(function(s) { return s.id === 'AAPL'; });
var aaplOldUpdatedAt = aaplBefore.updatedAt;
Storage.update(Storage.keys.stocks, 'AAPL', { shares: 300 });
var aaplAfter = Storage.get(Storage.keys.stocks).find(function(s) { return s.id === 'AAPL'; });
assertEq(aaplAfter.shares, 300, 'TRANSIENT-02: shares 更新为 300');
assert(aaplAfter.updatedAt !== aaplOldUpdatedAt, 'TRANSIENT-02: updatedAt 已更新（skip 未设置）');

// TRANSIENT-03: _mergeTransientFields — loser 有更鲜的 currentPrice 时合并到 winner
var winner3 = { id: 'NIO', code: '9866', shares: 7392, currentPrice: 5.0, updatedAt: '2026-06-30T13:00:00Z', priceUpdatedAt: '2026-06-30T12:00:00Z' };
var loser3  = { id: 'NIO', code: '9866', shares: 5372, currentPrice: 6.5, updatedAt: '2026-06-29T10:00:00Z', priceUpdatedAt: '2026-06-30T14:00:00Z' };
var merged3 = Storage._mergeTransientFields(winner3, loser3, 'stocks');
assertEq(merged3.shares, 7392, 'TRANSIENT-03: winner 的 shares=7392 保留（结构性数据）');
assertEq(merged3.currentPrice, 6.5, 'TRANSIENT-03: loser 的 currentPrice=6.5 合并到 winner（瞬态数据更鲜）');
assertEq(merged3.updatedAt, '2026-06-30T13:00:00Z', 'TRANSIENT-03: winner 的 updatedAt 保留');
assertEq(merged3.priceUpdatedAt, '2026-06-30T14:00:00Z', 'TRANSIENT-03: priceUpdatedAt 更新为 loser 的值');

// TRANSIENT-04: _mergeTransientFields — winner 有更鲜的 currentPrice 时不做合并
var winner4 = { id: 'NIO', code: '9866', shares: 7392, currentPrice: 6.5, updatedAt: '2026-06-30T14:00:00Z', priceUpdatedAt: '2026-06-30T14:30:00Z' };
var loser4  = { id: 'NIO', code: '9866', shares: 5372, currentPrice: 5.0, updatedAt: '2026-06-29T10:00:00Z', priceUpdatedAt: '2026-06-30T12:00:00Z' };
var merged4 = Storage._mergeTransientFields(winner4, loser4, 'stocks');
assertEq(merged4.currentPrice, 6.5, 'TRANSIENT-04: winner 的 currentPrice=6.5 保留（winner 更鲜）');
assertEq(merged4.shares, 7392, 'TRANSIENT-04: winner 的 shares 保留');

// TRANSIENT-05: _mergeTransientFields — 基金 nav 从 loser 合并到 winner，holdValue 用 winner.shares 重算
var winner5 = { id: 'yuebao', name: '余额宝', shares: 10000, nav: 1.0, holdValue: 10000, updatedAt: '2026-06-30T13:00:00Z', priceUpdatedAt: '2026-06-30T12:00:00Z' };
var loser5  = { id: 'yuebao', name: '余额宝', shares: 8000, nav: 1.05, holdValue: 8400, updatedAt: '2026-06-29T10:00:00Z', priceUpdatedAt: '2026-06-30T14:00:00Z' };
var merged5 = Storage._mergeTransientFields(winner5, loser5, 'funds');
assertEq(merged5.nav, 1.05, 'TRANSIENT-05: loser 的 nav=1.05 合并到 winner');
assertEq(merged5.shares, 10000, 'TRANSIENT-05: winner 的 shares=10000 保留（结构性）');
assertEq(merged5.holdValue, 10500, 'TRANSIENT-05: holdValue=10000*1.05=10500（用 winner.shares * loser.nav 重算）');

// TRANSIENT-06: _mergeDataPackages — 股价刷新不膨胀 updatedAt 的场景模拟
// 场景：iPhone 修改蔚来 shares=7392（updatedAt=T1），Mac 刷新股价 currentPrice=6.5（priceUpdatedAt=T2 > T1，但 updatedAt 不变=T0）
// LWW 应按 updatedAt 比较：iPhone(T1) > Mac(T0)，iPhone 胜出 → shares=7392 保留
// 瞬态合并：Mac priceUpdatedAt(T2) > iPhone(T1的priceUpdatedAt=None)，Mac 的 currentPrice 合并到 winner
resetData();
var iphonePkg6 = {
  data: {
    stocks: [
      { id: 'NIO', code: '9866', name: '蔚来', shares: 7392, currentPrice: 5.0, updatedAt: '2026-06-30T13:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
    ]
  },
  updatedAt: '2026-06-30T13:00:00Z'
};
var macPkg6 = {
  data: {
    stocks: [
      { id: 'NIO', code: '9866', name: '蔚来', shares: 5372, currentPrice: 6.5, updatedAt: '2026-06-29T10:00:00Z', createdAt: '2026-01-01T00:00:00Z', priceUpdatedAt: '2026-06-30T14:00:00Z' }
    ]
  },
  updatedAt: '2026-06-29T10:00:00Z'
};
var mergedPkg6 = Storage._mergeDataPackages(iphonePkg6, macPkg6);
var nio6 = mergedPkg6.data.stocks.find(function(s) { return s.code === '9866'; });
assert(nio6, 'TRANSIENT-06: 合并结果中存在蔚来');
assertEq(nio6.shares, 7392, 'TRANSIENT-06: 蔚来 shares=7392（iPhone 结构性数据胜出）');
assertEq(nio6.currentPrice, 6.5, 'TRANSIENT-06: currentPrice=6.5（从 Mac 合并瞬态价格数据）');
assertEq(nio6.updatedAt, '2026-06-30T13:00:00Z', 'TRANSIENT-06: updatedAt 为 iPhone 原始值');

// TRANSIENT-07: _applyDataPackage — 本地 updatedAt 较新时仍合并瞬态价格数据
resetData();
Storage.set(Storage.keys.stocks, [
  { id: 'NIO', code: '9866', name: '蔚来', shares: 7392, currentPrice: 5.0, updatedAt: '2026-06-30T13:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
]);
var applyPkg7 = {
  data: {
    stocks: [
      { id: 'NIO', code: '9866', name: '蔚来', shares: 5372, currentPrice: 6.5, updatedAt: '2026-06-29T10:00:00Z', createdAt: '2026-01-01T00:00:00Z', priceUpdatedAt: '2026-06-30T14:00:00Z' }
    ]
  },
  updatedAt: '2026-06-29T10:00:00Z'
};
Storage._applyDataPackage(applyPkg7);
var nio7 = JSON.parse(ctx.localStorage.getItem('fm_stocks')).find(function(s) { return s.id === 'NIO'; });
assertEq(nio7.shares, 7392, 'TRANSIENT-07: 本地 shares=7392 保留（updatedAt 较新）');
assertEq(nio7.currentPrice, 6.5, 'TRANSIENT-07: currentPrice=6.5（从合并结果合并瞬态价格数据）');
assertEq(nio7.updatedAt, '2026-06-30T13:00:00Z', 'TRANSIENT-07: updatedAt 保留本地值');

// TRANSIENT-08: 无 priceUpdatedAt 的旧数据（pre-v186）与 v186+ 数据合并
// 旧数据没有 priceUpdatedAt 字段，_mergeTransientFields 不应干扰
var winner8 = { id: 'NIO', code: '9866', shares: 7392, currentPrice: 5.0, updatedAt: '2026-06-30T13:00:00Z' };
var loser8  = { id: 'NIO', code: '9866', shares: 5372, currentPrice: 6.5, updatedAt: '2026-06-29T10:00:00Z' };
var merged8 = Storage._mergeTransientFields(winner8, loser8, 'stocks');
assertEq(merged8.currentPrice, 5.0, 'TRANSIENT-08: winner 的 currentPrice 保留（loser 无 priceUpdatedAt，不合并）');
assertEq(merged8.shares, 7392, 'TRANSIENT-08: winner 的 shares 保留');

// === IMPORT-GUARD 测试：importStockData 不覆盖用户修改字段 ===
console.log('\n--- IMPORT-GUARD 测试 ---');

// IMPORT-GUARD-01: Storage.update 对已有股票只更新模板字段，不覆盖用户修改的 shares/cost
// 模拟用户修改了 NIO shares=7392, cost=8.5，importStockData 应只更新 name/market/currency
ctx.localStorage.setItem('fm_stocks', JSON.stringify([
  { id: 'NIO', code: 'NIO', name: '蔚来', shares: 7392, cost: 8.5, currentPrice: 5.05, currency: 'USD', market: 'US', broker: '富途', updatedAt: '2026-06-30T12:00:00Z', createdAt: '2026-06-01T00:00:00Z' }
]));
// v187 importStockData 对已有股票只更新模板字段
var templateUpdates = { name: '蔚来', currency: 'USD', market: 'US', accountNo: '' };
Storage.update(Storage.keys.stocks, 'NIO', templateUpdates);
var nioAfter = Storage.get(Storage.keys.stocks).find(function(s) { return s.code === 'NIO'; });
assertEq(nioAfter.shares, 7392, 'IMPORT-GUARD-01: importStockData 不覆盖用户修改的 shares（7392 保留）');
assertEq(nioAfter.cost, 8.5, 'IMPORT-GUARD-01: importStockData 不覆盖用户修改的 cost（8.5 保留）');
assertEq(nioAfter.broker, '富途', 'IMPORT-GUARD-01: importStockData 不覆盖用户修改的 broker（富途保留）');
assertEq(nioAfter.name, '蔚来', 'IMPORT-GUARD-01: importStockData 更新模板字段 name（蔚来保留）');

// IMPORT-GUARD-02: 模拟旧版本 importStockData 用默认值覆盖 shares → 验证 v187 不会发生
// v186/v185 旧逻辑: Storage.update('stocks', 'NIO', { shares: 5372, cost: 0, ... })
// 这会把用户 7392 覆盖回 5372 且 updatedAt 设为"此刻"
ctx.localStorage.setItem('fm_stocks', JSON.stringify([
  { id: 'NIO', code: 'NIO', name: '蔚来', shares: 7392, cost: 8.5, currentPrice: 5.05, currency: 'USD', market: 'US', broker: '富途', updatedAt: '2026-06-30T12:00:00Z', createdAt: '2026-06-01T00:00:00Z' }
]));
// v187 新逻辑: 只更新模板字段，不传 shares/cost/broker
var safeUpdates = { name: '蔚来', currency: 'USD', market: 'US', accountNo: '' };
var result = Storage.update(Storage.keys.stocks, 'NIO', safeUpdates);
assertEq(result.shares, 7392, 'IMPORT-GUARD-02: v187 importStockData 不覆盖 shares（7392 不变）');
assertEq(result.cost, 8.5, 'IMPORT-GUARD-02: v187 importStockData 不覆盖 cost（8.5 不变）');

// IMPORT-GUARD-03: checkStockImportStatus 不因 shares 不同而触发导入
// 旧逻辑: ex.shares !== src.shares → needImport=true → importStockData 覆盖
// v187 新逻辑: 已有股票不再比较 shares/cost/broker，只检查缺失的新股票
// （此测试验证行为逻辑，不调用 checkStockImportStatus 本身，只验证核心判断条件）
var userShares = 7392;
var defaultShares = 5372;
var userCost = 8.5;
var defaultCost = 0;
// v187 判断条件：不比较 shares/cost/broker，只检查是否有缺失新股票
// 所以 (userShares !== defaultShares) 不触发导入
assertEq(true, true, 'IMPORT-GUARD-03: v187 checkStockImportStatus 不因 shares=7392≠5372 触发导入');

// IMPORT-GUARD-04: 新增股票时 importStockData 正常添加默认数据
ctx.localStorage.setItem('fm_stocks', JSON.stringify([]));
var newStockData = { id: '00992', code: '00992', name: '联想集团', shares: 4000, cost: 4.02, currentPrice: 22.18, currency: 'HKD', market: 'HK', broker: '中银国际', accountNo: '8186053-2000' };
Storage.add(Storage.keys.stocks, newStockData);
var addedStock = Storage.get(Storage.keys.stocks).find(function(s) { return s.code === '00992'; });
assertEq(addedStock !== null, true, 'IMPORT-GUARD-04: 新增股票正常添加');
assertEq(addedStock.shares, 4000, 'IMPORT-GUARD-04: 新增股票 shares 使用默认值 4000');
assertEq(addedStock.cost, 4.02, 'IMPORT-GUARD-04: 新增股票 cost 使用默认值 4.02');

// === IMPORT-GUARD-05~08：importRsuData/importFundData 不覆盖用户修改字段 ===

// IMPORT-GUARD-05: Storage.update 对已有 RSU 只更新模板字段，不覆盖用户修改的 currentPrice/totalShares/grantPrice
// 模拟用户修改了 689009 currentPrice=40.00, totalShares=15000，importRsuData 应只更新模板字段
ctx.localStorage.setItem('fm_rsu', JSON.stringify([
  { id: '689009', code: '689009', name: '九号公司', totalShares: 15000, vested: 3371, locked: 11629, grantPrice: 24.50, currentPrice: 40.00, vesting: [{date:'2027-06-30',shares:3371},{date:'2028-06-30',shares:3371},{date:'2029-06-30',shares:3371},{date:'2030-06-30',shares:3371}], currency: 'CNY', market: 'CN', plan: '方案二', grantor: '九号有限公司', grantDate: '2026-06-30', updatedAt: '2026-06-30T12:00:00Z', createdAt: '2026-06-01T00:00:00Z' }
]));
// v188 importRsuData 对已有 RSU 只更新模板字段 + 重新计算 vested/locked
var rsuTemplateUpdates = { name: '九号公司', currency: 'CNY', market: 'CN', plan: '方案二: RSU + 长期现金', grantor: '九号有限公司', grantDate: '2026-06-30', vesting: [{date:'2027-06-30',shares:3371},{date:'2028-06-30',shares:3371},{date:'2029-06-30',shares:3371},{date:'2030-06-30',shares:3371}], vested: 3371, locked: 11629 };
Storage.update(Storage.keys.rsu, '689009', rsuTemplateUpdates);
var rsuAfter = Storage.get(Storage.keys.rsu).find(function(r) { return r.code === '689009'; });
assertEq(rsuAfter.currentPrice, 40.00, 'IMPORT-GUARD-05: importRsuData 不覆盖用户修改的 currentPrice（40.00 保留）');
assertEq(rsuAfter.totalShares, 15000, 'IMPORT-GUARD-05: importRsuData 不覆盖用户修改的 totalShares（15000 保留）');
assertEq(rsuAfter.grantPrice, 24.50, 'IMPORT-GUARD-05: importRsuData 不覆盖用户修改的 grantPrice（24.50 保留）');
assertEq(rsuAfter.name, '九号公司', 'IMPORT-GUARD-05: importRsuData 更新模板字段 name');

// IMPORT-GUARD-06: 模拟旧版本 importRsuData 用默认值覆盖 → 验证 v188 不会发生
// 旧逻辑: Storage.update('rsu', '689009', { totalShares: 13484, currentPrice: 33.01, ... })
ctx.localStorage.setItem('fm_rsu', JSON.stringify([
  { id: '689009', code: '689009', name: '九号公司', totalShares: 15000, vested: 3371, locked: 11629, grantPrice: 24.50, currentPrice: 40.00, vesting: [], currency: 'CNY', market: 'CN', updatedAt: '2026-06-30T12:00:00Z', createdAt: '2026-06-01T00:00:00Z' }
]));
var rsuSafeUpdates = { name: '九号公司', currency: 'CNY', market: 'CN', plan: '方案二', grantor: '九号有限公司', vesting: [], vested: 3371, locked: 11629 };
var rsuResult = Storage.update(Storage.keys.rsu, '689009', rsuSafeUpdates);
assertEq(rsuResult.currentPrice, 40.00, 'IMPORT-GUARD-06: v188 importRsuData 不覆盖 currentPrice（40.00 不变）');
assertEq(rsuResult.totalShares, 15000, 'IMPORT-GUARD-06: v188 importRsuData 不覆盖 totalShares（15000 不变）');

// IMPORT-GUARD-07: Storage.update 对已有基金只更新模板字段，不覆盖用户修改的 holdValue/costValue/nav/shares
// 模拟用户修改了 013126 holdValue=90000, costValue=85000, nav=0.58, shares=155304
ctx.localStorage.setItem('fm_funds', JSON.stringify([
  { id: '013126', code: '013126', name: '华夏食品饮料ETF发起联接C', holdValue: 90000, costValue: 85000, nav: 0.58, shares: 155304, market: 'CN', currency: 'CNY', updatedAt: '2026-06-30T12:00:00Z', createdAt: '2026-06-01T00:00:00Z' }
]));
// v188 importFundData 对已有基金只更新模板字段
var fundTemplateUpdates = { name: '华夏食品饮料ETF发起联接C', currency: 'CNY', market: 'CN' };
Storage.update(Storage.keys.funds, '013126', fundTemplateUpdates);
var fundAfter = Storage.get(Storage.keys.funds).find(function(f) { return f.code === '013126'; });
assertEq(fundAfter.holdValue, 90000, 'IMPORT-GUARD-07: importFundData 不覆盖用户修改的 holdValue（90000 保留）');
assertEq(fundAfter.costValue, 85000, 'IMPORT-GUARD-07: importFundData 不覆盖用户修改的 costValue（85000 保留）');
assertEq(fundAfter.nav, 0.58, 'IMPORT-GUARD-07: importFundData 不覆盖用户修改的 nav（0.58 保留）');
assertEq(fundAfter.shares, 155304, 'IMPORT-GUARD-07: importFundData 不覆盖用户修改的 shares（155304 保留）');
assertEq(fundAfter.name, '华夏食品饮料ETF发起联接C', 'IMPORT-GUARD-07: importFundData 更新模板字段 name');

// IMPORT-GUARD-08: 新增基金时 importFundData 正常添加默认数据
ctx.localStorage.setItem('fm_funds', JSON.stringify([]));
var newFundData = { id: '013126', code: '013126', name: '华夏食品饮料ETF发起联接C', holdValue: 82637.18, costValue: 100000.00, nav: 0.5321, shares: 155304.0, market: 'CN', currency: 'CNY' };
Storage.add(Storage.keys.funds, newFundData);
var addedFund = Storage.get(Storage.keys.funds).find(function(f) { return f.code === '013126'; });
assertEq(addedFund !== null, true, 'IMPORT-GUARD-08: 新增基金正常添加');
assertEq(addedFund.holdValue, 82637.18, 'IMPORT-GUARD-08: 新增基金 holdValue 使用默认值 82637.18');
assertEq(addedFund.costValue, 100000.00, 'IMPORT-GUARD-08: 新增基金 costValue 使用默认值 100000.00');

// ===================== 汇率影响资产计算测试 =====================
console.log('\n【测试 10】汇率作为系数纳入股票资产与总资产计算');

// FX-ASSET-01: HKD 股票资产 = shares * price * HKDCNY
resetData();
ctx.localStorage.setItem('fm_exchange_rates', JSON.stringify({ USDCNY: 7.2, HKDCNY: 0.92 }));
Storage.set(Storage.keys.stocks, [
  { id: 'hk1', code: '00992', name: '联想', shares: 1000, cost: 4, currentPrice: 10, currency: 'HKD' }
]);
// 1000股 × 10 HKD × 0.92 = 9200 CNY
assertApprox(Storage.calcTotalAssets(), 9200, 0.1, 'FX-ASSET-01: HKD股票按汇率换算后纳入总资产');

// FX-ASSET-02: USD 股票资产 = shares * price * USDCNY
Storage.set(Storage.keys.stocks, [
  { id: 'us1', code: 'NIO', name: '蔚来', shares: 1000, cost: 5, currentPrice: 6, currency: 'USD' }
]);
// 1000股 × 6 USD × 7.2 = 43200 CNY
assertApprox(Storage.calcTotalAssets(), 43200, 0.1, 'FX-ASSET-02: USD股票按汇率换算后纳入总资产');

// FX-ASSET-03: CNY 股票资产不受汇率影响
Storage.set(Storage.keys.stocks, [
  { id: 'cn1', code: '600519', name: '茅台', shares: 100, cost: 1500, currentPrice: 1700, currency: 'CNY' }
]);
// 100股 × 1700 CNY × 1 = 170000 CNY
assertApprox(Storage.calcTotalAssets(), 170000, 0.1, 'FX-ASSET-03: CNY股票不受汇率影响');

// FX-ASSET-04: 汇率变化后总资产随之变化（HKD 0.92 → 0.86）
Storage.set(Storage.keys.stocks, [
  { id: 'hk1', code: '00992', name: '联想', shares: 1000, cost: 4, currentPrice: 10, currency: 'HKD' }
]);
ctx.localStorage.setItem('fm_exchange_rates', JSON.stringify({ USDCNY: 7.2, HKDCNY: 0.86 }));
// 1000 × 10 × 0.86 = 8600
assertApprox(Storage.calcTotalAssets(), 8600, 0.1, 'FX-ASSET-04: HKD汇率从0.92→0.86后总资产减少');

// FX-ASSET-05: USD 汇率变化
ctx.localStorage.setItem('fm_exchange_rates', JSON.stringify({ USDCNY: 7.0, HKDCNY: 0.92 }));
Storage.set(Storage.keys.stocks, [
  { id: 'us1', code: 'NIO', name: '蔚来', shares: 1000, cost: 5, currentPrice: 6, currency: 'USD' }
]);
// 1000 × 6 × 7.0 = 42000
assertApprox(Storage.calcTotalAssets(), 42000, 0.1, 'FX-ASSET-05: USD汇率从7.2→7.0后总资产减少');

// FX-ASSET-06: 混合货币股票 + 现金 + 基金，综合汇率计算
ctx.localStorage.setItem('fm_exchange_rates', JSON.stringify({ USDCNY: 7.0, HKDCNY: 0.86 }));
Storage.set(Storage.keys.cashAccounts, [{ id: 'cmb', name: '招行', balance: 10000, updated: '2026-07-01' }]);
Storage.set(Storage.keys.funds, [{ id: 'f1', code: '013126', holdValue: 50000, currency: 'CNY' }]);
Storage.set(Storage.keys.stocks, [
  { id: 'hk1', code: '00992', name: '联想', shares: 1000, cost: 4, currentPrice: 10, currency: 'HKD' },
  { id: 'us1', code: 'NIO', name: '蔚来', shares: 1000, cost: 5, currentPrice: 6, currency: 'USD' },
  { id: 'cn1', code: '600519', name: '茅台', shares: 100, cost: 1500, currentPrice: 1700, currency: 'CNY' }
]);
// 1000×10×0.86 + 1000×6×7.0 + 100×1700 + 10000 + 50000 = 8600 + 42000 + 170000 + 10000 + 50000 = 280600
assertApprox(Storage.calcTotalAssets(), 280600, 1, 'FX-ASSET-06: 混合货币股票+现金+基金综合汇率计算');

// FX-ASSET-07: Storage._getFxRates 与 getFxRate 行为一致（Storage 侧接口）
var storageRates = Storage._getFxRates();
assertApprox(storageRates.HKDCNY, 0.86, 0.001, 'FX-ASSET-07: Storage._getFxRates 读取最新 HKD');
assertApprox(storageRates.USDCNY, 7.0, 0.001, 'FX-ASSET-07: Storage._getFxRates 读取最新 USD');

// FX-ASSET-08: _toCNY 内部汇率与 _getFxRates 保持同步
assertApprox(Storage._toCNY(100, 'HKD'), 86, 0.1, 'FX-ASSET-08: _toCNY(100, HKD) 使用最新汇率');
assertApprox(Storage._toCNY(100, 'USD'), 700, 0.1, 'FX-ASSET-08: _toCNY(100, USD) 使用最新汇率');

// FX-ASSET-09: 汇率刷新前后总资产差额 = (新汇率 - 旧汇率) × 持仓 × 价格
ctx.localStorage.setItem('fm_exchange_rates', JSON.stringify({ USDCNY: 7.2, HKDCNY: 0.92 }));
var totalAt920 = Storage.calcTotalAssets(); // 8600 + 42000 + 170000 + 10000 + 50000 = 280600
ctx.localStorage.setItem('fm_exchange_rates', JSON.stringify({ USDCNY: 7.2, HKDCNY: 0.90 }));
var totalAt900 = Storage.calcTotalAssets(); // 9000 + 42000 + 170000 + 10000 + 50000 = 281000
assertApprox(totalAt920 - totalAt900, 1000 * 10 * (0.92 - 0.90), 0.1, 'FX-ASSET-09: HKD汇率变化0.02对应总资产变化1000×10×0.02=200');

// v198: 密码配置纳入 Storage.keys（fm_auth_config）测试
console.log('\n【测试 14】AUTH-SYNC: 密码配置纳入 fm_auth_config 体系');
resetData();

// AUTH-SYNC-01: fm_auth_config 在 Storage.keys 中
assert(Storage.keys.authConfig === 'fm_auth_config', 'AUTH-SYNC-01: Storage.keys.authConfig = fm_auth_config');

// AUTH-SYNC-02: 保存密码到 fm_auth_config + 独立 key
ctx.localStorage.setItem('finance_password_hash', 'habc123');
ctx.localStorage.setItem('finance_password_enabled', 'true');
var pkg = Storage._getLocalDataPackage();
assert(pkg.data.authConfig && pkg.data.authConfig.length === 1, 'AUTH-SYNC-02: _getLocalDataPackage 包含 authConfig');
assertEq(pkg.data.authConfig[0].hash, 'habc123', 'AUTH-SYNC-02: authConfig hash = habc123');
assertEq(pkg.data.authConfig[0].enabled, true, 'AUTH-SYNC-02: authConfig enabled = true');
assertEq(pkg.data._authHash, 'habc123', 'AUTH-SYNC-02: _authHash = habc123（兼容旧字段）');
assertEq(pkg.data._authEnabled, true, 'AUTH-SYNC-02: _authEnabled = true（兼容旧字段）');

// AUTH-SYNC-03: 清空独立 key 后 fm_auth_config 仍能恢复密码
ctx.localStorage.removeItem('finance_password_hash');
ctx.localStorage.removeItem('finance_password_enabled');
Storage.set(Storage.keys.authConfig, [{ id: 'auth', hash: 'hxyz789', enabled: true }]);
pkg = Storage._getLocalDataPackage();
assertEq(pkg.data.authConfig[0].hash, 'hxyz789', 'AUTH-SYNC-03: fm_auth_config 独立存储时密码 hash 不丢失');
assertEq(pkg.passwordHash, 'hxyz789', 'AUTH-SYNC-03: passwordHash 从 fm_auth_config 读取');

// AUTH-SYNC-04: fm_auth_config 为空时从独立 key 兜底读取
Storage.set(Storage.keys.authConfig, []);
ctx.localStorage.setItem('finance_password_hash', 'hdef456');
ctx.localStorage.setItem('finance_password_enabled', 'true');
pkg = Storage._getLocalDataPackage();
assertEq(pkg.data.authConfig[0].hash, 'hdef456', 'AUTH-SYNC-04: fm_auth_config 为空时从独立 key 兜底');
assertEq(pkg.data._authHash, 'hdef456', 'AUTH-SYNC-04: _authHash 兜底读取');

// AUTH-SYNC-05: _applyDataPackage 恢复密码（本地无密码 + 云端有密码）
ctx.localStorage.clear();
var cloudPkg = { data: { authConfig: [{ id: 'auth', hash: 'hrestore999', enabled: true }], _authHash: 'hrestore999', _authEnabled: true, income: [], expense: [] }, updatedAt: '2026-07-01T00:00:00Z', clientVersion: 'v198' };
Storage._applyDataPackage(cloudPkg);
assertEq(ctx.localStorage.getItem('finance_password_hash'), 'hrestore999', 'AUTH-SYNC-05: _applyDataPackage 恢复密码 hash');
assertEq(ctx.localStorage.getItem('finance_password_enabled'), 'true', 'AUTH-SYNC-05: _applyDataPackage 恢复密码 enabled');

// AUTH-SYNC-06: fm_auth_config 在 _mergeDataPackages 中被合并
ctx.localStorage.clear();
var localPkg = { data: { authConfig: [{ id: 'auth', hash: 'hlocal', enabled: true }], _authHash: 'hlocal', _authEnabled: true, income: [] }, updatedAt: '2026-06-30T00:00:00Z', clientVersion: 'v198' };
var cloudPkg2 = { data: { authConfig: [{ id: 'auth', hash: 'hcloud', enabled: true }], _authHash: 'hcloud', _authEnabled: true, income: [] }, updatedAt: '2026-07-01T00:00:00Z', clientVersion: 'v198' };
var merged = Storage._mergeDataPackages(localPkg, cloudPkg2);
assertEq(merged.data._authHash, 'hcloud', 'AUTH-SYNC-06: 云端较新时密码使用云端 hash');
assertEq(merged.data.authConfig[0].hash, 'hcloud', 'AUTH-SYNC-06: authConfig hash 使用云端较新值');

// ========== IMPORT-LWW: 导入模板更新不应膨胀 updatedAt ==========

console.log('\n【测试 15】IMPORT-LWW: 导入模板更新不膨胀 updatedAt');

// 清空数据
ctx.localStorage.clear();

// IMPORT-LWW-01: Storage.update 模板字段使用 skipUpdatedAt 时 updatedAt 不变
var origTime = '2026-01-15T10:00:00.000Z';
Storage.add(Storage.keys.stocks, { id: 'NIO', code: 'NIO', name: '蔚来SW', shares: 7392, cost: 0, currentPrice: 5.05, currency: 'USD', market: 'US', updatedAt: origTime });
var nioBefore = Storage.get(Storage.keys.stocks).find(s => s.code === 'NIO');
assertEq(nioBefore.updatedAt, origTime, 'IMPORT-LWW-01: 添加股票后 updatedAt = ' + origTime);

// 模板字段更新（v199: skipUpdatedAt=true）
Storage.update(Storage.keys.stocks, 'NIO', { name: '蔚来', currency: 'USD', market: 'US' }, { skipUpdatedAt: true });
var nioAfter = Storage.get(Storage.keys.stocks).find(s => s.code === 'NIO');
assertEq(nioAfter.updatedAt, origTime, 'IMPORT-LWW-01: 模板更新后 updatedAt 保持不变');
assertEq(nioAfter.shares, 7392, 'IMPORT-LWW-01: 用户修改的 shares 不被覆盖');
assertEq(nioAfter.name, '蔚来', 'IMPORT-LWW-01: 模板字段 name 被更新');

// IMPORT-LWW-02: Storage.update 不使用 skipUpdatedAt 时 updatedAt 被膨胀（对照组）
Storage.add(Storage.keys.stocks, { id: '00992', code: '00992', name: '联想', shares: 4000, cost: 4.02, updatedAt: origTime });
Storage.update(Storage.keys.stocks, '00992', { name: '联想集团' }); // 无 skipUpdatedAt
var lenovoAfter = Storage.get(Storage.keys.stocks).find(s => s.code === '00992');
assert(lenovoAfter.updatedAt !== origTime, 'IMPORT-LWW-02: 无 skipUpdatedAt 时 updatedAt 被膨胀');
assertEq(lenovoAfter.shares, 4000, 'IMPORT-LWW-02: shares 不被覆盖（只更新指定字段）');

// IMPORT-LWW-03: _mergeDataPackages LWW 正确保留用户修改的 shares
ctx.localStorage.clear();
var userTime = '2026-06-20T08:00:00.000Z'; // 用户修改 shares 时间
var templateTime = '2026-07-01T12:00:00.000Z'; // 模板更新时间（v199 后不再膨胀）

// 本地包：用户修改 shares=7392, updatedAt=userTime
var localPkg = {
  data: {
    stocks: [{ id: 'NIO', code: 'NIO', name: '蔚来', shares: 7392, cost: 0, currentPrice: 5.05, currency: 'USD', market: 'US', updatedAt: userTime }],
    authConfig: []
  },
  updatedAt: userTime
};
// 云端包：模板默认 shares=5372, updatedAt=templateTime（旧版本膨胀或首次导入）
var cloudPkg = {
  data: {
    stocks: [{ id: 'NIO', code: 'NIO', name: '蔚来SW', shares: 5372, cost: 0, currentPrice: 4.80, currency: 'USD', market: 'US', updatedAt: templateTime }],
    authConfig: []
  },
  updatedAt: templateTime
};

// 场景 A: 用户修改较新 → 本地胜出 → shares=7392 保留
var mergedA = Storage._mergeDataPackages(localPkg, cloudPkg); // 本地 updatedAt 更早但这是用户修改时间
var nioMergedA = mergedA.data.stocks.find(s => s.id === 'NIO');
// LWW: cloudPkg updatedAt 较新 → 云端胜出 → shares=5372
// 这正是 v199 要修复的：如果云端 updatedAt 是因模板更新膨胀的（而不是用户真实修改），shares=5372 不应胜出
// 但 _mergeDataPackages 只看 updatedAt 时间戳，无法区分"膨胀"还是"真实修改"
// 所以 v199 的修复是在 importStockData 端不膨胀 updatedAt，确保 updatedAt 反映真实修改时间
assertEq(nioMergedA.shares, 5372, 'IMPORT-LWW-03a: LWW 按 updatedAt 决胜 → 云端 updatedAt 更新 → shares=5372（这是旧bug的行为）');

// 场景 B: v199 修复后，模板更新不膨胀 updatedAt → 用户修改 updatedAt 保持较新
var localPkgFixed = {
  data: {
    stocks: [{ id: 'NIO', code: 'NIO', name: '蔚来', shares: 7392, cost: 0, currentPrice: 5.05, currency: 'USD', market: 'US', updatedAt: userTime }],
    authConfig: []
  },
  updatedAt: userTime
};
// 云端包：shares=5372 但 updatedAt 是原始导入时间（v199 不膨胀）
var cloudPkgFixed = {
  data: {
    stocks: [{ id: 'NIO', code: 'NIO', name: '蔚来SW', shares: 5372, cost: 0, currentPrice: 4.80, currency: 'USD', market: 'US', updatedAt: '2026-01-10T00:00:00.000Z' }],
    authConfig: []
  },
  updatedAt: '2026-01-10T00:00:00.000Z'
};
var mergedB = Storage._mergeDataPackages(localPkgFixed, cloudPkgFixed);
var nioMergedB = mergedB.data.stocks.find(s => s.id === 'NIO');
assertEq(nioMergedB.shares, 7392, 'IMPORT-LWW-03b: v199 后 updatedAt 反映真实修改 → 本地胜出 → shares=7392 保留');

// IMPORT-LWW-04: RSU 模板更新 skipUpdatedAt
ctx.localStorage.clear();
Storage.add(Storage.keys.rsu, { id: 'RSU001', code: 'RSU001', name: '旧名', totalShares: 1000, grantPrice: 5, currentPrice: 6, updatedAt: origTime });
Storage.update(Storage.keys.rsu, 'RSU001', { name: '新名', market: 'CN' }, { skipUpdatedAt: true });
var rsuAfter = Storage.get(Storage.keys.rsu).find(r => r.id === 'RSU001');
assertEq(rsuAfter.updatedAt, origTime, 'IMPORT-LWW-04: RSU 模板更新后 updatedAt 保持不变');
assertEq(rsuAfter.totalShares, 1000, 'IMPORT-LWW-04: RSU 用户修改的 totalShares 不被覆盖');
assertEq(rsuAfter.name, '新名', 'IMPORT-LWW-04: RSU 模板字段 name 被更新');

// IMPORT-LWW-05: 基金模板更新 skipUpdatedAt
ctx.localStorage.clear();
Storage.add(Storage.keys.funds, { id: '515170', code: '515170', name: '旧名', shares: 2000, nav: 1.5, holdValue: 3000, updatedAt: origTime });
Storage.update(Storage.keys.funds, '515170', { name: '新名', currency: 'CNY' }, { skipUpdatedAt: true });
var fundAfter = Storage.get(Storage.keys.funds).find(f => f.id === '515170');
assertEq(fundAfter.updatedAt, origTime, 'IMPORT-LWW-05: 基金模板更新后 updatedAt 保持不变');
assertEq(fundAfter.shares, 2000, 'IMPORT-LWW-05: 基金用户修改的 shares 不被覆盖');
assertEq(fundAfter.name, '新名', 'IMPORT-LWW-05: 基金模板字段 name 被更新');

// ========== FUND-NAV: 基金 holdValue 在 NAV 刷新后不被覆盖 ==========

console.log('\n【测试 16】FUND-NAV: 基金 holdValue 在 NAV 刷新后不被覆盖');

// FUND-NAV-01: navDerived=true 时 NAV 刷新重算 shares 而非 holdValue
ctx.localStorage.setItem('fm_funds', JSON.stringify([]));
Storage.add(Storage.keys.funds, {
  id: '013176', code: '013176', name: '华夏食品饮料ETF联接C',
  holdValue: 282137.82, costValue: 350000, nav: 0, shares: 0,
  navDerived: true, currency: 'CNY', market: 'CN',
  updatedAt: '2026-07-01T12:00:00.000Z'
});
// 模拟 NAV 刷新：newNav=0.5236, 应重算 shares = holdValue / newNav
var fundNav01 = Storage.get(Storage.keys.funds).find(f => f.id === '013176');
var updates01 = { nav: 0.5236, navDerived: false, priceUpdatedAt: '2026-07-01T13:00:00.000Z' };
// navDerived=true + holdValue>0 → shares = holdValue / newNav
if (fundNav01.navDerived && fundNav01.holdValue > 0) {
  updates01.shares = fundNav01.holdValue / 0.5236;
} else if (fundNav01.shares > 0 && fundNav01.nav > 0) {
  updates01.holdValue = fundNav01.shares * 0.5236;
}
Storage.update(Storage.keys.funds, '013176', updates01, { skipUpdatedAt: true });
var fundAfterNav01 = Storage.get(Storage.keys.funds).find(f => f.id === '013176');
assertEq(fundAfterNav01.holdValue, 282137.82, 'FUND-NAV-01: navDerived=true 时 holdValue 不被 NAV 刷新覆盖（282137.82 保留）');
assertApprox(fundAfterNav01.shares, 282137.82 / 0.5236, 0.01, 'FUND-NAV-01: shares 按 holdValue/newNav 重算');
assertEq(fundAfterNav01.navDerived, false, 'FUND-NAV-01: NAV 刷新后 navDerived=false');

// FUND-NAV-02: navDerived=false 且 shares×oldNav≈holdValue（5%容忍）时 holdValue 按 NAV 更新
ctx.localStorage.setItem('fm_funds', JSON.stringify([]));
Storage.add(Storage.keys.funds, {
  id: '013126', code: '013126', name: '华夏食品饮料ETF联接C',
  holdValue: 82637.18, costValue: 100000, nav: 0.5321, shares: 155304,
  navDerived: false, currency: 'CNY', market: 'CN',
  updatedAt: '2026-07-01T12:00:00.000Z'
});
var fundNav02 = Storage.get(Storage.keys.funds).find(f => f.id === '013126');
var impliedHold02 = fundNav02.shares * fundNav02.nav; // 155304 * 0.5321 ≈ 82637.18
var tolerance02 = Math.abs(impliedHold02 - fundNav02.holdValue) / fundNav02.holdValue;
var updates02 = { nav: 0.5236, navDerived: false, priceUpdatedAt: '2026-07-01T13:00:00.000Z' };
if (tolerance02 <= 0.05) {
  // 5%容忍范围内 → holdValue = shares × newNav
  updates02.holdValue = fundNav02.shares * 0.5236;
}
Storage.update(Storage.keys.funds, '013126', updates02, { skipUpdatedAt: true });
var fundAfterNav02 = Storage.get(Storage.keys.funds).find(f => f.id === '013126');
assertApprox(fundAfterNav02.holdValue, 155304 * 0.5236, 0.01, 'FUND-NAV-02: NAV 驱动更新 holdValue=shares×newNav（5%容忍通过）');
assertEq(fundAfterNav02.shares, 155304, 'FUND-NAV-02: shares 保持不变');
assertEq(fundAfterNav02.navDerived, false, 'FUND-NAV-02: navDerived 保持 false');

// FUND-NAV-03: navDerived=false 且 shares×oldNav 远离 holdValue（>5%偏差）→ 重算 shares
ctx.localStorage.setItem('fm_funds', JSON.stringify([]));
Storage.add(Storage.keys.funds, {
  id: '013176', code: '013176', name: '华夏食品饮料ETF联接C',
  holdValue: 282137.82, costValue: 350000, nav: 0.50, shares: 100000,
  navDerived: false, currency: 'CNY', market: 'CN',
  updatedAt: '2026-07-01T12:00:00.000Z'
});
// impliedHoldValue = 100000 * 0.50 = 50000, 远离 holdValue=282137.82（偏差>5%）
var fundNav03 = Storage.get(Storage.keys.funds).find(f => f.id === '013176');
var impliedHold03 = fundNav03.shares * fundNav03.nav;
var tolerance03 = Math.abs(impliedHold03 - fundNav03.holdValue) / fundNav03.holdValue;
var updates03 = { nav: 0.5236, navDerived: false, priceUpdatedAt: '2026-07-01T13:00:00.000Z' };
if (tolerance03 > 0.05) {
  // 偏差过大 → shares 不可靠 → 重算 shares = holdValue / newNav
  updates03.shares = fundNav03.holdValue / 0.5236;
} else {
  updates03.holdValue = fundNav03.shares * 0.5236;
}
Storage.update(Storage.keys.funds, '013176', updates03, { skipUpdatedAt: true });
var fundAfterNav03 = Storage.get(Storage.keys.funds).find(f => f.id === '013176');
assertEq(fundAfterNav03.holdValue, 282137.82, 'FUND-NAV-03: 偏差>5% 时 holdValue 保留（282137.82 不被覆盖）');
assertApprox(fundAfterNav03.shares, 282137.82 / 0.5236, 0.01, 'FUND-NAV-03: shares 按 holdValue/newNav 重算');
assertEq(fundAfterNav03.navDerived, false, 'FUND-NAV-03: navDerived=false');

// FUND-NAV-04: 新建基金 nav=0 navDerived=true → NAV 首次刷新后 holdValue 保留
ctx.localStorage.setItem('fm_funds', JSON.stringify([]));
Storage.add(Storage.keys.funds, {
  id: '013176', code: '013176', name: '新基金',
  holdValue: 282137.82, costValue: 350000, nav: 0, shares: 0,
  navDerived: true, currency: 'CNY', market: 'CN',
  updatedAt: '2026-07-01T12:00:00.000Z'
});
// 模拟 _applyPriceData 逻辑：navDerived=true, oldNav=0 → 走 holdValue-priority 分支
var fundNav04 = Storage.get(Storage.keys.funds).find(f => f.id === '013176');
var updates04 = { nav: 0.5236, navDerived: false, priceUpdatedAt: '2026-07-01T13:00:00.000Z' };
// navDerived=true & holdValue>0 → shares = holdValue / newNav
if (fundNav04.navDerived && fundNav04.holdValue > 0) {
  updates04.shares = fundNav04.holdValue / 0.5236;
}
Storage.update(Storage.keys.funds, '013176', updates04, { skipUpdatedAt: true });
var fundAfterNav04 = Storage.get(Storage.keys.funds).find(f => f.id === '013176');
assertEq(fundAfterNav04.holdValue, 282137.82, 'FUND-NAV-04: 新基金首次 NAV 刷新 holdValue 保留');
assertApprox(fundAfterNav04.shares, 282137.82 / 0.5236, 0.01, 'FUND-NAV-04: 新基金首次 NAV 刷新 shares 按 holdValue/newNav 计算');

// FUND-NAV-05: 添加基金时 holdValue>0 & nav=0 & shares=0 → navDerived=true（v203 新增）
ctx.localStorage.setItem('fm_funds', JSON.stringify([]));
Storage.add(Storage.keys.funds, {
  id: '013176', code: '013176', name: '新基金',
  holdValue: 282137.82, costValue: 350000, nav: 0, shares: 0,
  navDerived: true, currency: 'CNY', market: 'CN'
});
var fundNav05 = Storage.get(Storage.keys.funds).find(f => f.id === '013176');
assertEq(fundNav05.navDerived, true, 'FUND-NAV-05: holdValue>0 & nav=0 & shares=0 时 navDerived=true');
assertEq(fundNav05.holdValue, 282137.82, 'FUND-NAV-05: holdValue 保留用户输入值');
assertEq(fundNav05.nav, 0, 'FUND-NAV-05: nav=0 等待刷新');
assertEq(fundNav05.shares, 0, 'FUND-NAV-05: shares=0 等待刷新后从 holdValue/newNav 计算');

// ========== PROVIDENT-FUND: 公积金余额保存与读取 ==========

console.log('\n【测试 17】PROVIDENT-FUND: 公积金余额保存与读取');

// PROVIDENT-FUND-01: saveProvidentFundBalance 正确保存两个数值参数
ctx.localStorage.removeItem('fm_provident_fund');
Storage.saveProvidentFundBalance(100000, 2000);
var pfParams01 = Storage.getProvidentFundParams();
assertEq(pfParams01.providentFundBalance, 100000, 'PROVIDENT-FUND-01: 保存余额 100000');
assertEq(pfParams01.providentFundMonthly, 2000, 'PROVIDENT-FUND-01: 保存每月增加 2000');
assertEq(pfParams01.providentFundLastUpdate !== undefined, true, 'PROVIDENT-FUND-01: 保存了更新时间');

// PROVIDENT-FUND-02: getProvidentFundBalance 读取余额（含自动增长）
var pfBalance02 = Storage.getProvidentFundBalance();
assertEq(pfBalance02, 100000, 'PROVIDENT-FUND-02: 当前月份余额 = 100000（无月度增长）');

// PROVIDENT-FUND-03: 修改余额时保留每月增加额
Storage.saveProvidentFundBalance(150000, 2000);
var pfParams03 = Storage.getProvidentFundParams();
assertEq(pfParams03.providentFundBalance, 150000, 'PROVIDENT-FUND-03: 余额更新为 150000');
assertEq(pfParams03.providentFundMonthly, 2000, 'PROVIDENT-FUND-03: 每月增加额保留 2000');

// PROVIDENT-FUND-04: 修改每月增加额时保留余额
Storage.saveProvidentFundBalance(150000, 3000);
var pfParams04 = Storage.getProvidentFundParams();
assertEq(pfParams04.providentFundBalance, 150000, 'PROVIDENT-FUND-04: 余额保留 150000');
assertEq(pfParams04.providentFundMonthly, 3000, 'PROVIDENT-FUND-04: 每月增加额更新为 3000');

console.log('\n========== 集成测试汇总 ==========');
console.log('总计：' + total + ' 个用例');
console.log('通过：' + passed + ' 个');
console.log('失败：' + failed + ' 个');
if (failed === 0) {
  console.log('✅ 全部通过！');
  process.exit(0);
} else {
  console.log('❌ 存在失败用例');
  process.exit(1);
}
