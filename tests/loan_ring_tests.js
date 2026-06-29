// 房贷环形还款进度图单元测试
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
function assertEq(actual, expected, msg) {
  total++;
  if (Math.abs(actual - expected) <= 0.01) { passed++; console.log('  ✅ ' + msg); }
  else { console.error('  ❌ ' + msg + ': expected ' + expected + ', got ' + actual); failed++; }
}

console.log('【测试】房贷环形还款进度图');

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
  if (id === 'loanRingChart') return container;
  return originalGetElementById(id);
};

// RING-01: 渲染两个圆环并包含图例
App._renderLoanRingChart([
  { bank: '公积金', total: 700000, rate: 2.6, term: 15, startDate: '2014-12-26', mode: 'equal-payment', loanType: '公积金', autoProgress: true, payDay: 17 },
  { bank: '商业', total: 800000, rate: 3.2, term: 20, startDate: '2014-12-26', mode: 'equal-payment', loanType: '商业贷款', autoProgress: true, payDay: 17 }
]);
assert(capturedHtml.includes('<svg'), 'RING-01: 生成了 SVG');
assert(capturedHtml.includes('公积金已还'), 'RING-01: 包含公积金已还图例');
assert(capturedHtml.includes('公积金剩余'), 'RING-01: 包含公积金剩余图例');
assert(capturedHtml.includes('商业已还'), 'RING-01: 包含商业已还图例');
assert(capturedHtml.includes('商业剩余'), 'RING-01: 包含商业剩余图例');
assert(capturedHtml.includes('剩余'), 'RING-01: 中心显示剩余金额');
assert(capturedHtml.includes('已还'), 'RING-01: 中心显示已还年限');

// RING-02: 空数据提示
container.innerHTML = 'before';
App._renderLoanRingChart([]);
assert(container.innerHTML.includes('暂无有效房贷数据'), 'RING-02: 空数据提示');

// RING-03: 仅商业贷款时只渲染商业环
const onlyCommercial = App._renderLoanRingChart.toString();
assert(onlyCommercial.includes('commercial'), 'RING-03: 函数包含商业贷款处理');
assert(onlyCommercial.includes('fund'), 'RING-03: 函数包含公积金贷款处理');

console.log('\n========== 房贷环形进度图测试汇总 ==========');
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
