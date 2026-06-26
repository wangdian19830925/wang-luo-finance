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
