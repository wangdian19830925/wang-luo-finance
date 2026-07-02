/**
 * CloudBase 云函数共享常量
 */

// CloudBase 环境 ID
const ENV_ID = 'wang-luo-finance-d6enmg07a198e20';

// 数据集合名
const COLLECTIONS = {
  FINANCE_DATA: 'finance_data',        // 用户业务数据（已有）
  MARKET_PRICES: 'market_prices',      // 最新股价
  EXCHANGE_RATES: 'exchange_rates',    // 最新汇率
  FUND_NAVS: 'fund_navs',             // 基金净值+历史
  MACRO_TRENDS: 'macro_trends_cloud', // 宏观趋势云端补充
  DAILY_BRIEFING: 'daily_briefing',   // 每日简报
};

// 固定文档 ID
const DOC_IDS = {
  LATEST_PRICES: 'latest_prices',
  LATEST_RATES: 'latest_rates',
  LATEST_MACRO: 'latest_macro',
  FINANCE_DATA: 'finance_data',
};

// 数据源 URL
const DATA_SOURCES = {
  TENCENT_STOCK: 'https://qt.gtimg.cn/q=',                 // 腾讯财经股价
  EXCHANGE_RATE: 'https://open.er-api.com/v6/latest/USD',  // 汇率
  FRANKFURTER_HISTORY: 'https://api.frankfurter.app/v1/',  // 汇率历史
  FUND_PINGZHONGDATA: 'https://fund.eastmoney.com/pingzhongdata/', // 基金净值
  CNBC_RSS: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  RSS2JSON: 'https://api.rss2json.com/v1/api.json?rss_url=',
};

// 基金净值历史保留天数（6个月 ≈ 183天）
const FUND_HISTORY_DAYS = 183;

module.exports = {
  ENV_ID,
  COLLECTIONS,
  DOC_IDS,
  DATA_SOURCES,
  FUND_HISTORY_DAYS,
};
