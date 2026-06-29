// 退休曲线单元测试：验证曲线拖拽后后续年份不沿用（carry-forward）
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
function runScenario(name, curve, expected) {
  console.log('\n【' + name + '】');
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
  const result = App._simulateRetirement(10000000, 2026, 43, 2030, params, schedules);
  result.years.forEach((y, i) => {
    let rate = 2;
    if (y.year > 2026) {
      rate = (Math.pow(y.expense / 10000, 1 / (y.year - 2026)) - 1) * 100;
    }
    assertEq(rate, expected[i], y.year + ' 年 CPI 应为 ' + expected[i] + '%');
  });
}

runScenario('仅 2027 改为 5%，后续年份应恢复默认值', { 2027: 5 }, [2, 5, 2, 2, 2]);
runScenario('所有年份默认 2% 后 2027 改为 5%', { 2026: 2, 2027: 5, 2028: 2, 2029: 2, 2030: 2 }, [2, 5, 2, 2, 2]);
runScenario('机构预测后 2027 改为 5%，其余保持机构预测', { 2026: 2, 2027: 5, 2028: 3, 2029: 3, 2030: 3 }, [2, 5, 3, 3, 3]);
runScenario('仅修改末年 2030 为 6%', { 2030: 6 }, [2, 2, 2, 2, 6]);

console.log('\n========== 退休曲线测试汇总 ==========');
console.log('总计：' + total + ' 个用例');
console.log('通过：' + passed + ' 个');
console.log('失败：' + failed + ' 个');
if (failed > 0) {
  console.log('\n❌ 有 ' + failed + ' 个用例失败');
  process.exit(1);
} else {
  console.log('\n✅ 全部通过！');
  process.exit(0);
}
