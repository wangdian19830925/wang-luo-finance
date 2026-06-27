// 房贷计算公式单元测试（独立运行，不依赖浏览器 DOM）
// 用法：node tests/loan_calc_tests.js

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
function assertEqOrApprox(actual, expected, msg) {
  total++;
  if (actual === expected || Math.abs(actual - expected) <= 0.5) {
    passed++;
    console.log('  ✅ ' + msg + ' = ' + actual);
  } else {
    failed++;
    console.error('  ❌ ' + msg + ': expected ' + expected + ', got ' + actual);
  }
}

// 等额本息月供计算
function calcMonthlyPayment(total, annualRate, months) {
  if (!total || !annualRate || !months || months <= 0) return 0;
  var mr = annualRate / 100 / 12;
  if (mr === 0) return total / months;
  var factor = Math.pow(1 + mr, months);
  return (total * mr * factor) / (factor - 1);
}

function monthDiff(d1, d2) {
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
}

function calcLoanProgress(loan, today) {
  today = today ? new Date(today) : new Date();
  today.setHours(0, 0, 0, 0);

  var total = parseFloat(loan.total) || 0;
  var rate = parseFloat(loan.rate) || 0;
  var term = parseInt(loan.term) || 0;
  var months = term * 12;
  var mode = loan.mode || 'equal-payment';
  var payDay = parseInt(loan.payDay) || 17;
  var startStr = loan.startDate;

  function parseDate(d) {
    if (!d) return null;
    var p = d.split('-');
    return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  }
  var startDate = parseDate(startStr);

  function getNextPayDate(start, payDay, today) {
    var elapsed = monthDiff(start, today);
    var next = new Date(start.getFullYear(), start.getMonth() + elapsed + 1, payDay);
    var cur = new Date(start.getFullYear(), start.getMonth() + elapsed, payDay);
    if (today < cur) return cur;
    return next;
  }

  if (months <= 0 || total <= 0) {
    return {
      elapsed: 0, total: 0, paidPrincipal: 0, remainingPrincipal: total,
      percent: 0, monthlyPayment: 0, nextPayDate: null, monthsRemaining: 0,
      totalInterest: 0, remainingInterest: 0, isFinished: false, basis: '数据不完整'
    };
  }

  var mr = rate / 100 / 12;
  var principalPerMonth = total / months;

  var elapsed = 0;
  if (startDate) {
    if (today < startDate) {
      elapsed = 0;
    } else {
      elapsed = monthDiff(startDate, today);
      var thisMonthPayDate = new Date(today.getFullYear(), today.getMonth(), payDay);
      if (today < thisMonthPayDate) elapsed -= 1;
      if (elapsed < 0) elapsed = 0;
      if (elapsed > months) elapsed = months;
    }
  }

  var isFinished = elapsed >= months;
  var paidPrincipal = 0;
  var totalInterest = 0;
  var remainingPrincipal = 0;

  if (mode === 'equal-principal') {
    paidPrincipal = principalPerMonth * elapsed;
    if (isFinished) paidPrincipal = total;
    var sumRemaining = 0;
    for (var i = 0; i < elapsed; i++) {
      sumRemaining += (total - i * principalPerMonth);
    }
    totalInterest = mr * sumRemaining;
    remainingPrincipal = Math.max(0, total - paidPrincipal);
  } else {
    var origMonthly = calcMonthlyPayment(total, rate, months);
    var balance = total;
    for (var j = 0; j < elapsed; j++) {
      var interest = balance * mr;
      var principalPart = origMonthly - interest;
      balance -= principalPart;
      if (balance < 0.01) balance = 0;
      paidPrincipal += principalPart;
      totalInterest += interest;
    }
    if (isFinished) paidPrincipal = total;
    remainingPrincipal = Math.max(0, balance);
  }

  var percent = total > 0 ? (paidPrincipal / total * 100) : 0;
  var nextPayDate = startDate ? getNextPayDate(startDate, payDay, today) : null;
  var monthsRemaining = Math.max(0, months - elapsed);

  var monthlyPayment = 0;
  var remainingInterest = 0;
  if (monthsRemaining > 0) {
    if (mode === 'equal-principal') {
      monthlyPayment = principalPerMonth + remainingPrincipal * mr;
      remainingInterest = mr * (monthsRemaining * remainingPrincipal -
        principalPerMonth * monthsRemaining * (monthsRemaining - 1) / 2);
    } else {
      monthlyPayment = calcMonthlyPayment(remainingPrincipal, rate, monthsRemaining);
      remainingInterest = monthlyPayment * monthsRemaining - remainingPrincipal;
    }
  }
  if (remainingInterest < 0) remainingInterest = 0;

  return {
    elapsed: elapsed,
    total: months,
    paidPrincipal: paidPrincipal,
    remainingPrincipal: remainingPrincipal,
    percent: percent,
    monthlyPayment: monthlyPayment,
    nextPayDate: nextPayDate,
    monthsRemaining: monthsRemaining,
    totalInterest: totalInterest,
    remainingInterest: remainingInterest,
    isFinished: isFinished,
    basis: ''
  };
}

console.log('\n【测试】房贷计算：等额本息 + 剩余期数 + 剩余利息');

// LOAN-01: 等额本息基本月供
assertApprox(calcMonthlyPayment(1000000, 3.6, 240), 5851.11, 0.5, 'LOAN-01: 100万 3.6% 20年月供');

// LOAN-02: 公积金贷进度（模拟 2026-06-27）
const loan1 = { total: 700000, rate: 2.6, term: 15, startDate: '2014-12-26', payDay: 17, mode: 'equal-payment' };
const r1 = calcLoanProgress(loan1, '2026-06-27');
assertEqOrApprox(r1.monthsRemaining, 42, 'LOAN-02: 公积金剩余期数 42');
assertApprox(r1.monthlyPayment, 4700.55, 1, 'LOAN-02: 公积金月供约 4700.55');
assertApprox(r1.remainingInterest, 8911, 100, 'LOAN-02: 公积金剩余利息约 8911');

// LOAN-03: 商业贷进度（模拟 2026-06-27）
const loan2 = { total: 800000, rate: 3.2, term: 20, startDate: '2014-12-26', payDay: 17, mode: 'equal-payment' };
const r2 = calcLoanProgress(loan2, '2026-06-27');
assertEqOrApprox(r2.monthsRemaining, 102, 'LOAN-03: 商业贷剩余期数 102');
assertApprox(r2.monthlyPayment, 4517.30, 1, 'LOAN-03: 商业贷月供约 4517.30');
assertApprox(r2.remainingInterest, 57816, 100, 'LOAN-03: 商业贷剩余利息约 57816');

// LOAN-04: 两贷月供总和约 9200
assertApprox(r1.monthlyPayment + r2.monthlyPayment, 9217.85, 2, 'LOAN-04: 两贷月供总和约 9217.85');

// LOAN-05: 等额本金当前月还款与剩余利息
const loan3 = { total: 1200000, rate: 3.6, term: 20, startDate: '2019-01-01', payDay: 1, mode: 'equal-principal' };
const r3 = calcLoanProgress(loan3, '2026-06-15');
assert(r3.monthlyPayment > 0, 'LOAN-05: 等额本金当前月供 > 0');
assert(r3.remainingInterest >= 0, 'LOAN-05: 等额本金剩余利息 >= 0');
assert(r3.monthsRemaining > 0, 'LOAN-05: 等额本金剩余期数 > 0');

// LOAN-06: 已还清贷款
const loan4 = { total: 500000, rate: 3.0, term: 10, startDate: '2010-01-01', payDay: 1, mode: 'equal-payment' };
const r4 = calcLoanProgress(loan4, '2026-06-27');
assert(r4.isFinished === true, 'LOAN-06: 已还清贷款 isFinished = true');
assert(r4.monthlyPayment === 0, 'LOAN-06: 已还清贷款月供 = 0');
assert(r4.remainingInterest === 0, 'LOAN-06: 已还清贷款剩余利息 = 0');

console.log('\n========== 房贷测试汇总 ==========');
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
