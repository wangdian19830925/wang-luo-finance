// 退休曲线单元测试：验证曲线值逐年独立 + 家庭消费按实际年度 CPI 复利
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.resolve(__dirname, '..');
const mockStorage = {};
const ctx = vm.createContext({
  console, JSON, Math, Date, String, Number, Array, Object, parseFloat, parseInt, isNaN, Set, localStorage: {
    getItem(key) { return mockStorage[key] || null; },
    setItem(key, val) { mockStorage[key] = String(val); },
    removeItem(key) { delete mockStorage[key]; },
    clear() { for (const k in mockStorage) delete mockStorage[k]; }
  }, document: {}, window: {}
});

const storageCode = fs.readFileSync(path.join(BASE, 'js/storage.js'), 'utf8').replace(/^const Storage = \{/m, 'var Storage = {');
vm.runInContext(storageCode, ctx);

let appCode = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8').replace(/^const App = \{/m, 'var App = {');
appCode = appCode.replace(/document\.addEventListener\("DOMContentLoaded"[^;]+\);\s*$/, '');
vm.runInContext(appCode, ctx);

const App = ctx.App;
const Storage = ctx.Storage;

let total = 0, passed = 0, failed = 0;
function assertEq(actual, expected, msg) {
  total++;
  if (Math.abs(actual - expected) <= 0.01) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.error('  ❌ ' + msg + ': expected ' + expected + ', got ' + actual); }
}

function simulate(curve) {
  const params = {
    annualExpense: 1, annualEducation: 0, educationEndYear: 2025,
    inflation: 2, investmentReturn: 0,
    inflationCurve: curve, investmentReturnCurve: {},
    pensionMember1Balance: 0, pensionMember1Monthly: 0, pensionMember1RetireAge: 100,
    pensionMember2Balance: 0, pensionMember2Monthly: 0, pensionMember2RetireAge: 100,
    lifeExpectancy: 90, mortgagePayoffMode: 'lump', extraTransactions: []
  };
  const schedules = {
    premiumSchedule: {}, mortgagePaymentSchedule: {}, pensionSchedule: {},
    insuranceSchedule: {}, enterpriseAnnuitySchedule: {}, universalBalanceAt60: 0
  };
  return App._simulateRetirement(10000000, 2026, 43, 2030, params, schedules);
}

// 场景 1：仅 2027 改为 5%，后续年份应恢复默认 2% 并按实际序列复利
console.log('\n【仅 2027 改为 5%，后续恢复默认 2%】');
let result = simulate({ 2027: 5 });
assertEq(result.years[0].expense, 10000, '2026 消费为基数');
assertEq(result.years[1].expense, 10500, '2027 消费 = 10000 * 1.05');
assertEq(result.years[2].expense, 10710, '2028 消费 = 10500 * 1.02（继续复利，不是 10000 * 1.02^2）');
assertEq(result.years[3].expense, 10924.2, '2029 消费 = 10710 * 1.02');
assertEq(result.years[4].expense, 11142.68, '2030 消费 = 10924.2 * 1.02');

// 场景 2：显式写出所有年份，2027 为 5%，其余 2%
console.log('\n【显式写出所有年份】');
result = simulate({ 2026: 2, 2027: 5, 2028: 2, 2029: 2, 2030: 2 });
assertEq(result.years[1].expense, 10500, '2027 消费 = 10000 * 1.05');
assertEq(result.years[2].expense, 10710, '2028 消费 = 10500 * 1.02');

// 场景 3：机构预测后 2027 改为 5%，其余保持机构预测
console.log('\n【机构预测曲线 + 2027 改为 5%】');
result = simulate({ 2026: 2, 2027: 5, 2028: 3, 2029: 3, 2030: 3 });
assertEq(result.years[1].expense, 10500, '2027 消费 = 10000 * 1.05');
assertEq(result.years[2].expense, 10815, '2028 消费 = 10500 * 1.03');
assertEq(result.years[3].expense, 11139.45, '2029 消费 = 10815 * 1.03');
assertEq(result.years[4].expense, 11473.63, '2030 消费 = 11139.45 * 1.03');

// 场景 4：仅修改末年 2030 为 6%
console.log('\n【仅末年 2030 改为 6%】');
result = simulate({ 2030: 6 });
assertEq(result.years[0].expense, 10000, '2026 消费为基数');
assertEq(result.years[1].expense, 10200, '2027 消费 = 10000 * 1.02');
assertEq(result.years[2].expense, 10404, '2028 消费 = 10200 * 1.02');
assertEq(result.years[3].expense, 10612.08, '2029 消费 = 10404 * 1.02');
assertEq(result.years[4].expense, 11248.80, '2030 消费 = 10612.08 * 1.06');

console.log('\n【保费现金流与 nextPayDate 对齐】');
// 保单缴费区间 2020-2042，nextPayDate=2026-12-16
Storage.set(Storage.keys.insurance, [
  { id: 'p1', company: '友邦', product: '重疾', person: '典', premium: 10000, freq: 'yearly', payPeriod: '2020-2042 · 23年', baseNextPayDate: '2026-12-16', nextPayDate: '2026-12-16', expireDate: '2042-12-31' }
]);
var premSchedule = App._buildPremiumSchedule(2026, 2028);
// 2026 年从 12-16 到年末共 16 天，2026 非闰年（365 天）
assertEq(premSchedule[2026], 10000 * 16 / 365, 'PREM-01: 2026 保费按 nextPayDate 到年末天数比例折算');
assertEq(premSchedule[2027], 10000, 'PREM-02: 2027 保费全额');
assertEq(premSchedule[2028], 10000, 'PREM-03: 2028 保费全额');

// nextPayDate 已推进到次年：2026 不应再计保费
Storage.set(Storage.keys.insurance, [
  { id: 'p2', company: '友邦', product: '年金', person: '典', premium: 12000, freq: 'yearly', payPeriod: '2023-2032 · 10年', baseNextPayDate: '2026-01-01', nextPayDate: '2027-01-01', expireDate: '2042-12-31' }
]);
premSchedule = App._buildPremiumSchedule(2026, 2028);
assertEq(premSchedule[2026] || 0, 0, 'PREM-04: nextPayDate 已推进到 2027 时 2026 不计保费');
assertEq(premSchedule[2027], 12000, 'PREM-05: 2027 全额保费');

console.log('\n========== 退休曲线测试汇总 ==========');
console.log('总计：' + total + ' 个断言');
console.log('通过：' + passed + ' 个');
console.log('失败：' + failed + ' 个');
if (failed > 0) {
  console.log('\n❌ 有 ' + failed + ' 个断言失败');
  process.exit(1);
} else {
  console.log('\n✅ 全部通过！');
  process.exit(0);
}
