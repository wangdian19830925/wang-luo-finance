// 退休曲线单元测试：验证曲线值逐年独立 + 家庭消费按实际年度 CPI 复利
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.resolve(__dirname, '..');
const ctx = vm.createContext({
  console, JSON, Math, Date, String, Number, Array, Object, parseFloat, parseInt, isNaN, Set, localStorage: {
    getItem() { return null; }, setItem() {}, removeItem() {}, clear() {}
  }, document: {}, window: {}
});

const storageCode = fs.readFileSync(path.join(BASE, 'js/storage.js'), 'utf8').replace(/^const Storage = \{/m, 'var Storage = {');
vm.runInContext(storageCode, ctx);

let appCode = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8').replace(/^const App = \{/m, 'var App = {');
appCode = appCode.replace(/document\.addEventListener\("DOMContentLoaded"[^;]+\);\s*$/, '');
vm.runInContext(appCode, ctx);

const App = ctx.App;

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
