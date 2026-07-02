/**
 * 简报格式化模块
 * 将计算结果格式化为可读的简报文本
 */

const { formatDate } = require('../../shared/utils');

/**
 * 格式化净资产简报为中文文本摘要
 */
function formatBriefingText(briefing) {
  const { summary } = briefing;
  const s = summary;

  // 涨跌方向标记
  const direction = s.dailyChange >= 0 ? '↑' : '↓';
  const directionColor = s.dailyChange >= 0 ? '红' : '绿';

  let text = `📊 净资产日报 · ${briefing.date}\n\n`;
  text += `总资产: ¥${formatNumber(s.totalAssets)}  ${direction} ¥${formatNumber(Math.abs(s.dailyChange))} (${formatPercent(s.dailyChangeRate)}%)\n\n`;

  text += `资产分类变化:\n`;
  const bd = s.breakdown;
  text += `  股票: ¥${formatNumber(bd.stocks.today)} ${bd.stocks.change >= 0 ? '↑' : '↓'} ¥${formatNumber(Math.abs(bd.stocks.change))}\n`;
  text += `  基金: ¥${formatNumber(bd.funds.today)} ${bd.funds.change >= 0 ? '↑' : '↓'} ¥${formatNumber(Math.abs(bd.funds.change))}\n`;
  text += `  现金: ¥${formatNumber(bd.cash.today)} →\n`;
  text += `  公积金: ¥${formatNumber(bd.providentFund.today)} ${bd.providentFund.change >= 0 ? '↑' : '↓'} ¥${formatNumber(Math.abs(bd.providentFund.change))}\n`;
  text += `  其他: ¥${formatNumber(bd.other.today)} →\n`;

  if (s.topMovers && s.topMovers.length > 0) {
    text += `\n涨幅/跌幅最大:\n`;
    for (const m of s.topMovers.slice(0, 3)) {
      text += `  ${m.name}: ${m.changeRate >= 0 ? '+' : ''}${formatPercent(m.changeRate)}% (¥${formatNumber(m.change)})\n`;
    }
  }

  return text;
}

/**
 * 格式化新闻摘要
 */
function formatNewsSummary(news) {
  if (!news || news.length === 0) return '暂无新闻数据';

  let text = `📰 每日财经 · ${formatDate(new Date())}\n\n`;
  for (const item of news.slice(0, 5)) {
    text += `• ${item.title}\n  ${item.source} · ${item.pubDate}\n`;
  }

  return text;
}

/**
 * 数字格式化（保留2位小数，带千分位）
 */
function formatNumber(num) {
  if (num === 0) return '0';
  const absNum = Math.abs(num);
  if (absNum >= 10000) {
    return (num / 10000).toFixed(2) + '万';
  }
  return num.toFixed(2);
}

/**
 * 百分比格式化（保留2位小数）
 */
function formatPercent(num) {
  return num.toFixed(2);
}

module.exports = { formatBriefingText, formatNewsSummary, formatNumber, formatPercent };
