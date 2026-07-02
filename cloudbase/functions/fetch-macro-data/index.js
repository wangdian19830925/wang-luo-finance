/**
 * fetch-macro-data 云函数主入口
 * 每日获取：财经新闻 + 汇率历史 → 写入云端数据库
 * 
 * 触发方式：定时触发器（每日 8:00，开盘前）
 * CPI/LPR/利率等静态数据暂由手动更新（权威源无公开 API）
 */

const { initDb } = require('../shared/utils');
const { fetchCNBCNews, fetchEastMoneyNews } = require('./lib/news');
const { fetchFxHistoryForMacro } = require('./lib/fx-history');
const { writeMacroData } = require('./lib/db');

exports.main = async (event, context) => {
  console.log('[fetch-macro-data] 开始执行, event:', JSON.stringify(event));

  const { db } = initDb();
  const macroData = {
    dailyNews: [],
    fxHistory: null,
  };
  const results = {
    success: true,
    newsCount: 0,
    fxHistory: false,
    errors: [],
  };

  // 1. 获取 CNBC 国际财经新闻
  try {
    const cnbcNews = await fetchCNBCNews();
    macroData.dailyNews = macroData.dailyNews.concat(cnbcNews);
    results.newsCount += cnbcNews.length;
  } catch (e) {
    console.error('[fetch-macro-data] CNBC 新闻获取失败:', e.message);
    results.errors.push('cnbc: ' + e.message);
  }

  // 2. 获取东方财富国内财经新闻
  try {
    const emNews = await fetchEastMoneyNews();
    macroData.dailyNews = macroData.dailyNews.concat(emNews);
    results.newsCount += emNews.length;
  } catch (e) {
    console.error('[fetch-macro-data] 东方财富新闻获取失败:', e.message);
    results.errors.push('eastmoney: ' + e.message);
  }

  // 3. 获取汇率历史（6个月走势）
  try {
    const fxHistory = await fetchFxHistoryForMacro();
    macroData.fxHistory = fxHistory;
    if (fxHistory) results.fxHistory = true;
  } catch (e) {
    console.error('[fetch-macro-data] 汇率历史获取失败:', e.message);
    results.errors.push('fxHistory: ' + e.message);
  }

  // 4. 写入云端数据库
  try {
    await writeMacroData(db, macroData);
  } catch (e) {
    console.error('[fetch-macro-data] 数据写入失败:', e.message);
    results.errors.push('db: ' + e.message);
    results.success = false;
  }

  if (results.errors.length > 0) {
    results.success = results.newsCount > 0 || results.fxHistory;
  }

  console.log('[fetch-macro-data] 执行完成:', JSON.stringify(results));
  return results;
};
