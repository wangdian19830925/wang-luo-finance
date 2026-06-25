// 测试运行器 — Node.js 环境（vm 模块版）
// 用法：node tests/run_tests.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 创建共享上下文
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

// Mock localStorage
const mockStorage = {};
ctx.localStorage = {
  getItem(key) { return mockStorage[key] || null; },
  setItem(key, val) { mockStorage[key] = String(val); },
  removeItem(key) { delete mockStorage[key]; },
  clear() { for (const k in mockStorage) delete mockStorage[k]; }
};

// 加载 Storage 模块（将 const 替换为 var 以在 vm 上下文中暴露）
const storageCode = fs.readFileSync(path.join(__dirname, '../js/storage.js'), 'utf8')
  .replace(/^const Storage = \{/m, 'var Storage = {');
vm.runInContext(storageCode, ctx);
const Storage = ctx.Storage;

// 加载 Parser 模块（将 const 替换为 var 以在 vm 上下文中暴露）
const parserCode = fs.readFileSync(path.join(__dirname, '../js/parser.js'), 'utf8')
  .replace(/^const Parser = \{/m, 'var Parser = {');
vm.runInContext(parserCode, ctx);
const Parser = ctx.Parser;

// 测试统计
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

// ==============
// 测试 1：Storage 模块
// ==============
console.log('\n【测试 1】Storage 模块');

// 清理
ctx.localStorage.clear();

// DB-01: get 空 key
assertEq(JSON.stringify(Storage.get('fm_income')), JSON.stringify([]), 'DB-01: get 空 key 返回 []');

// DB-02: set + get
Storage.set('fm_income', [{ amount: 100 }]);
assertEq(Storage.get('fm_income').length, 1, 'DB-02: set + get 成功');

// DB-03: add
const item = Storage.add('fm_income', { amount: 200 });
assert(item.id && item.id.length > 0, 'DB-03: add 自动生成 id');
assert(item.createdAt && item.createdAt.includes('T'), 'DB-03: add 自动生成 createdAt');
assertEq(Storage.get('fm_income').length, 2, 'DB-03: add 后长度 +1');

// DB-04: update
const updated = Storage.update('fm_income', item.id, { amount: 300 });
assertEq(updated.amount, 300, 'DB-04: update 返回更新后对象');
assertEq(Storage.get('fm_income')[1].amount, 300, 'DB-04: update 持久化');

// DB-05: update 不存在的 id
const result = Storage.update('fm_income', 'nonexistent', {});
assertEq(result, null, 'DB-05: update 不存在的 id 返回 null');

// DB-06: delete
Storage.delete('fm_income', item.id);
assertEq(Storage.get('fm_income').length, 1, 'DB-06: delete 后长度 -1');

// DB-07: calcTotalAssets 空
ctx.localStorage.clear();
Storage.set(Storage.keys.stocks, []);
Storage.set(Storage.keys.rsu, []);
Storage.set(Storage.keys.funds, []);
Storage.set(Storage.keys.annuities, []);
Storage.set(Storage.keys.insurance, []);
assertEq(Storage.calcTotalAssets(), 0, 'DB-07: calcTotalAssets 空数据返回 0');

// DB-08: 人民币股票
ctx.localStorage.clear();
Storage.set(Storage.keys.stocks, [{ shares: 100, currentPrice: 10, currency: 'CNY' }]);
assertEq(Storage.calcTotalAssets(), 1000, 'DB-08: 人民币股票 = shares * price');

// DB-09: 港股（HKD）
Storage.set(Storage.keys.stocks, [{ shares: 100, currentPrice: 10, currency: 'HKD' }]);
assertApprox(Storage.calcTotalAssets(), 920, 1, 'DB-09: 港股 = shares * price * 0.92');

// DB-10: 美股（USD）
Storage.set(Storage.keys.stocks, [{ shares: 100, currentPrice: 10, currency: 'USD' }]);
assertApprox(Storage.calcTotalAssets(), 7200, 1, 'DB-10: 美股 = shares * price * 7.2');

// DB-11: RSU 已解禁
Storage.set(Storage.keys.rsu, [{ vested: 50, totalShares: 100, currentPrice: 20, grantPrice: 10 }]);
assertEq(Storage.calcRsuVestedValue(), 1000, 'DB-11: RSU 已解禁 = vested * price');

// DB-12: RSU 未解禁不计入
Storage.set(Storage.keys.rsu, [{ vested: 0, totalShares: 100, currentPrice: 20 }]);
assertEq(Storage.calcRsuVestedValue(), 0, 'DB-12: RSU 未解禁 = 0');

// DB-13: calcTotalDebts
Storage.set(Storage.keys.loans, [{ balance: 100000 }]);
assertEq(Storage.calcTotalDebts(), 100000, 'DB-13: calcTotalDebts = balance');

// DB-14: calcNetWorth
ctx.localStorage.clear();
Storage.set(Storage.keys.stocks, [{ shares: 10, currentPrice: 100, currency: 'CNY' }]);
Storage.set(Storage.keys.loans, [{ balance: 200 }]);
Storage.set(Storage.keys.rsu, []);
Storage.set(Storage.keys.funds, []);
Storage.set(Storage.keys.annuities, []);
Storage.set(Storage.keys.insurance, []);
assertEq(Storage.calcNetWorth(), 800, 'DB-14: calcNetWorth = 1000 - 200');

// DB-15: getInsuranceReminders
ctx.localStorage.clear();
const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 5);
const futureStr = futureDate.getFullYear() + '-' + String(futureDate.getMonth()+1).padStart(2,'0') + '-' + String(futureDate.getDate()).padStart(2,'0');
Storage.set(Storage.keys.insurance, [{ nextPayDate: futureStr, premium: 1000, product: '测试', person: '典' }]);
const reminders = Storage.getInsuranceReminders(30);
assertEq(reminders.length, 1, 'DB-15: getInsuranceReminders 返回 1 条');
assertEq(reminders[0].daysLeft <= 30, true, 'DB-15: daysLeft <= 30');

console.log('【测试 1】完成\n');

// ==============
// 测试 2：Parser 模块
// ==============
console.log('【测试 2】Parser 模块');

// API-01: 收入-工资
let r1 = Parser.parse('工资到账 12800 元 支付宝');
assertEq(r1.success, true, 'API-01: 解析成功');
assertEq(r1.data.type, 'income', 'API-01: type = income');
assertEq(r1.data.amount, 12800, 'API-01: amount = 12800');
assertEq(r1.data.incomeType, 'salary', 'API-01: incomeType = salary');

// API-02: 支出-餐饮
let r2 = Parser.parse('支付宝付款 35.5 元 盒马');
assertEq(r2.success, true, 'API-02: 解析成功');
assertEq(r2.data.type, 'expense', 'API-02: type = expense');
assertEq(r2.data.category, 'food', 'API-02: category = food');
assertApprox(r2.data.amount, 35.5, 0.1, 'API-02: amount = 35.5');

// API-03: 空输入
let r3 = Parser.parse('');
assertEq(r3.success, false, 'API-03: 空输入返回 failure');

// API-04: 无法识别
let r4 = Parser.parse('你好世界');
assertEq(r4.success, true, 'API-04: 无法识别但仍返回 success');
assertEq(r4.data.type, 'unknown', 'API-04: type = unknown');
assertEq(r4.data.confidence < 50, true, 'API-04: confidence < 50');

console.log('【测试 2】完成\n');

// ==============
// 汇总
// ==============
console.log('========== 测试汇总 ==========');
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
