// 房贷剩余还款趋势图单元测试
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
  }, document: {
    getElementById(id) {
      return {
        innerHTML: '',
        getAttribute() { return null; },
        setAttribute() {},
        closest() { return null; },
        querySelector() { return null; }
      };
    }
  }, window: {}
});

const storageCode = fs.readFileSync(path.join(BASE, 'js/storage.js'), 'utf8').replace(/^const Storage = \{/m, 'var Storage = {');
vm.runInContext(storageCode, ctx);

let appCode = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8').replace(/^const App = \{/m, 'var App = {');
appCode = appCode.replace(/document\.addEventListener\("DOMContentLoaded"[^;]+\);\s*$/, '');
vm.runInContext(appCode, ctx);

const App = ctx.App;

let total = 0, passed = 0, failed = 0;
function assert(cond, msg) {
  total++;
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.error('  ❌ ' + msg); }
}
function assertApprox(actual, expected, tolerance, msg) {
  total++;
  if (Math.abs(actual - expected) <= tolerance) { passed++; console.log('  ✅ ' + msg + ' ≈ ' + actual.toFixed(2)); }
  else { failed++; console.error('  ❌ ' + msg + ': expected ~' + expected + ', got ' + actual); }
}
function assertEq(actual, expected, msg) {
  total++;
  if (Math.abs(actual - expected) <= 0.01) { passed++; console.log('  ✅ ' + msg); }
  else { console.error('  ❌ ' + msg + ': expected ' + expected + ', got ' + actual); failed++; }
}

console.log('【测试】房贷剩余还款趋势图');

// LOAN-CHART-01: 等额本息每月剩余本金递减，首期剩余利息 > 末期剩余利息
const series = App._calcLoanMonthlySeries({ total: 1000000, rate: 3.6, term: 20, mode: 'equal-payment' });
assert(series.length === 241, 'LOAN-CHART-01: 241 个数据点（含结清日归零）');
assertEq(series[0].remainingPrincipal, 1000000, 'LOAN-CHART-01: 首期剩余本金等于贷款总额');
assertEq(series[240].remainingPrincipal, 0, 'LOAN-CHART-01: 结清日剩余本金归零');
assert(series[0].remainingInterest > series[239].remainingInterest, 'LOAN-CHART-01: 首期剩余利息 > 末期剩余利息');
assert(series[240].remainingInterest === 0, 'LOAN-CHART-01: 结清日剩余利息为零');

// LOAN-CHART-02: 等额本金剩余本金线性递减，每月本金固定
const series2 = App._calcLoanMonthlySeries({ total: 600000, rate: 3.0, term: 10, mode: 'equal-principal' });
assert(series2.length === 121, 'LOAN-CHART-02: 121 个数据点（含结清日归零）');
assertEq(series2[0].remainingPrincipal, 600000, 'LOAN-CHART-02: 首期剩余本金等于贷款总额');
assertEq(series2[120].remainingPrincipal, 0, 'LOAN-CHART-02: 结清日剩余本金归零');
assertEq(series2[60].remainingPrincipal, 300000, 'LOAN-CHART-02: 第 60 期剩余本金为总额一半');
assert(series2[0].remainingInterest > series2[1].remainingInterest, 'LOAN-CHART-02: 首期剩余利息 > 第二期剩余利息');

// LOAN-CHART-03: 渲染函数生成包含四个系列的 SVG
let capturedHtml = '';
const container = {
  innerHTML: '',
  getAttribute() { return null; },
  setAttribute() {},
  closest() { return null; },
  querySelector() { return null; }
};
Object.defineProperty(container, 'innerHTML', {
  get() { return capturedHtml; },
  set(v) { capturedHtml = v; }
});
const originalGetElementById = ctx.document.getElementById;
ctx.document.getElementById = function(id) {
  if (id === 'loanRepaymentChart') return container;
  return originalGetElementById(id);
};

App._renderLoanRepaymentChart([
  { bank: '公积金', total: 700000, rate: 2.6, term: 15, startDate: '2014-12-26', mode: 'equal-payment', loanType: '公积金' },
  { bank: '商业', total: 800000, rate: 3.2, term: 20, startDate: '2014-12-26', mode: 'equal-payment', loanType: '商业贷款' }
]);
assert(capturedHtml.includes('公积金-剩余本金'), 'LOAN-CHART-03: 包含公积金剩余本金图例');
assert(capturedHtml.includes('公积金-剩余利息'), 'LOAN-CHART-03: 包含公积金剩余利息图例');
assert(capturedHtml.includes('商业-剩余本金'), 'LOAN-CHART-03: 包含商业剩余本金图例');
assert(capturedHtml.includes('商业-剩余利息'), 'LOAN-CHART-03: 包含商业剩余利息图例');
assert(capturedHtml.includes('今日'), 'LOAN-CHART-03: 包含今日标记');
assert(capturedHtml.includes('<svg'), 'LOAN-CHART-03: 生成了 SVG');
assert(capturedHtml.includes('M'), 'LOAN-CHART-03: SVG 包含路径');
assert(capturedHtml.includes('剩余待还'), 'LOAN-CHART-03: 汇总显示剩余待还');
assert(capturedHtml.includes('初始贷款总额'), 'LOAN-CHART-03: 汇总显示初始贷款总额');

// LOAN-CHART-04: 无效数据不生成图表
container.innerHTML = 'before';
App._renderLoanRepaymentChart([]);
assert(container.innerHTML.includes('暂无有效房贷数据'), 'LOAN-CHART-04: 空数据提示');

// LOAN-CHART-05: 公积金贷款结清后，后续月份不再显示其剩余值
const progress = App._lastLoanChartData;
if (progress && progress.monthlyData) {
  const lastFundIdx = 180; // 15 年 = 180 个月，后续月份为商业贷款
  if (progress.monthlyData.length > lastFundIdx) {
    assert(progress.monthlyData[lastFundIdx].fundPrincipal === 0, 'LOAN-CHART-05: 公积金结清后剩余本金归零');
    assert(progress.monthlyData[lastFundIdx].fundInterest === 0, 'LOAN-CHART-05: 公积金结清后剩余利息归零');
  }
}

console.log('\n========== 房贷趋势图测试汇总 ==========');
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
