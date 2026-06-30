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
assertEq(pkg.clientVersion, 'v183', 'PENSION-SYNC-03: clientVersion 为 v183');

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
