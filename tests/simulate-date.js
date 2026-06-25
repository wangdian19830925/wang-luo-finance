// 在浏览器控制台粘贴此脚本可模拟任意日期，查看房贷卡片实时数据
// 用法：1) 打开 https://bb5f22c465b348cca2ac06cae2c5fd29.app.codebuddy.work
//      2) 进入"房贷追踪"页
//      3) 打开 Safari/Chrome DevTools 控制台，粘贴下方任一命令：
//
//   模拟 7月15日:      __simulateDate('2026-07-15')
//   模拟 7月17日:      __simulateDate('2026-07-17')
//   模拟 7月18日:      __simulateDate('2026-07-18')
//   模拟 8月15日:      __simulateDate('2026-08-15')
//   模拟 8月17日:      __simulateDate('2026-08-17')
//   模拟 8月25日:      __simulateDate('2026-08-25')
//   恢复真实日期:      __simulateDate(null)

window.__simulateDate = function(dateStr) {
  // 保存原始 Date 构造函数
  if (!window.__origDate) {
    window.__origDate = window.Date;
  }
  if (dateStr === null) {
    // 恢复真实日期
    window.Date = window.__origDate;
    console.log('%c[时间模拟] 已恢复真实日期', 'color: #4ade80; font-weight: bold;');
  } else {
    // 覆盖 Date 构造函数
    var fixedTime = new window.__origDate(dateStr + 'T12:00:00').getTime();
    var FakeDate = function() {
      if (arguments.length === 0) {
        return new window.__origDate(fixedTime);
      } else {
        return new window.__origDate(...arguments);
      }
    };
    FakeDate.now = function() { return fixedTime; };
    FakeDate.parse = window.__origDate.parse;
    FakeDate.UTC = window.__origDate.UTC;
    FakeDate.prototype = window.__origDate.prototype;
    window.Date = FakeDate;
    console.log('%c[时间模拟] 当前时间已锁定为 ' + dateStr, 'color: #fbbf24; font-weight: bold;');
  }
  // 重新渲染房贷卡片
  if (window.App && window.App.loadLoanList) {
    window.App.loadLoanList();
    console.log('%c[时间模拟] 房贷卡片已刷新', 'color: #4ade80;');
  } else {
    console.warn('[时间模拟] App 对象未加载，请先进入房贷追踪页');
  }
};

console.log('%c=== 时间模拟工具已加载 ===', 'color: #60a5fa; font-size: 14px; font-weight: bold;');
console.log('用法: __simulateDate("2026-07-15") 模拟 7 月 15 日');
console.log('     __simulateDate("2026-07-17") 模拟 7 月 17 日（还款日）');
console.log('     __simulateDate("2026-08-17") 模拟 8 月 17 日（还款日）');
console.log('     __simulateDate(null)          恢复真实日期');
