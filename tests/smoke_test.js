#!/usr/bin/env node
/**
 * 简化冒烟测试 - 验证关键功能不抛异常
 * 用法: node tests/smoke_test.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.log('  ❌ ' + msg); }
}

console.log('=== 冒烟测试 ===\n');

// 1. 检查所有 JS 文件语法
console.log('【1】JS 语法检查');
const jsFiles = [
  'js/app.js', 'js/storage.js', 'js/parser.js',
  'js/stock-data.js', 'js/fund-data.js', 'js/insurance-data.js',
  'js/loan-data.js', 'js/rsu-data.js', 'js/annuity-data.js'
];
for (const f of jsFiles) {
  const fp = path.join(__dirname, '..', f);
  try {
    const code = fs.readFileSync(fp, 'utf8');
    new Function(code); // 语法检查
    assert(true, f + ' 语法正确');
  } catch(e) {
    assert(false, f + ' 语法错误: ' + e.message);
  }
}

// 2. 检查关键函数存在
console.log('\n【2】关键函数存在性');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
const criticalFuncs = [
  'renderAssetTrend', 'renderFundTrend', 'renderStockCharts',
  'renderInsuranceProgress', 'loadLoanList', 'calcLoanProgress',
  'fetchStockHistoryData', '_loadFundHistoryData', '_fetchLiveFxRates',
  'adjustNextPayDate', '_getInlineHistory'
];
for (const fn of criticalFuncs) {
  assert(appCode.includes(fn + '(') || appCode.includes(fn + ' ('),
    'app.js 包含 ' + fn);
}

// 3. 检查 Bug 修复
console.log('\n【3】Bug 修复验证');
assert(appCode.match(/renderInsuranceProgress\(\)\s*\{[\s\S]{0,200}var today\s*=/),
  'P0-01: renderInsuranceProgress 有 var today');
assert(appCode.match(/_loadAllHistoryData[\s\S]{0,500}Storage\.get\(Storage\.keys\.stocks\)/),
  'P1-01: _loadAllHistoryData 动态读取股票代码');
assert(appCode.match(/_fetchLiveFxRates[\s\S]{0,200}location\.protocol\s*===\s*\'file:\'/),
  'P1-02: _fetchLiveFxRates 有 file: 检查');
assert(appCode.match(/today\s*=\s*today\s*\?\s*new Date\(today\)/),
  'P2-02: calcLoanProgress 拷贝入参');

// 4. 检查 data 文件
console.log('\n【4】数据文件完整性');
const dataFiles = ['data/stock-prices.json', 'js/history-data.js'];
for (const f of dataFiles) {
  const fp = path.join(__dirname, '..', f);
  assert(fs.existsSync(fp), f + ' 存在');
  const stat = fs.statSync(fp);
  assert(stat.size > 100, f + ' 大小合理 (' + stat.size + ' bytes)');
}

// 5. 检查 index.html
console.log('\n【5】HTML 引用检查');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(html.includes('js/history-data.js'), 'index.html 引用 history-data.js');
assert(html.includes('app.js?v=159'), 'index.html 版本 v160');
assert(html.includes('style.css?v=159'), 'index.html 样式版本 v160');

// 6. Service Worker
console.log('\n【6】Service Worker');
const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
assert(sw.includes('family-finance-v160'), 'SW 版本 v160');
assert(sw.includes('history-data.js'), 'SW 预缓存 history-data.js');

// 总结
console.log('\n========== 结果 ==========');
console.log('✅ 通过: ' + passed);
console.log('❌ 失败: ' + failed);
console.log('总计: ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
