/**
 * generate-briefing 云函数主入口
 * 每日收盘后（15:30）生成净资产简报 + 每日新闻摘要
 * 
 * 流程：
 * 1. 从云端数据库读取最新市场数据（股价/汇率/基金净值）
 * 2. 从 finance_data 读取所有用户的持仓数据
 * 3. 为每个用户计算净资产变化（今日 vs 昨日）
 * 4. 从 macro_trends_cloud 读取新闻
 * 5. 组合生成简报，写入 daily_briefing 集合
 */

const { initDb } = require('../shared/utils');
const { parseFinanceData, calculateNetAssetBriefing } = require('./lib/calculator');
const { formatBriefingText, formatNewsSummary } = require('./lib/formatter');
const { readMarketData, readMacroData, readAllFinanceData, writeBriefing } = require('./lib/db');

exports.main = async (event, context) => {
  console.log('[generate-briefing] 开始执行, event:', JSON.stringify(event));

  const { db } = initDb();
  const results = {
    success: true,
    briefingsGenerated: 0,
    errors: [],
  };

  // 1. 读取市场数据
  const marketData = await readMarketData(db);
  console.log('[generate-briefing] 市场数据读取完成: 股票', 
    Object.keys(marketData.marketPrices || {}).length, 
    '基金', Object.keys(marketData.fundNavs || {}).length);

  // 2. 读取宏观趋势数据（新闻）
  const macroData = await readMacroData(db);
  const dailyNews = macroData ? (macroData.dailyNews || []) : [];

  // 3. 读取所有 finance_data 文档
  const allFinanceDocs = await readAllFinanceData(db);
  console.log('[generate-briefing] 用户文档数:', allFinanceDocs.length);

  // 4. 为每个用户生成简报
  for (const doc of allFinanceDocs) {
    try {
      const financeData = parseFinanceData(doc);
      
      // 检查是否有持仓数据
      const hasStocks = financeData.stocks && financeData.stocks.length > 0;
      const hasFunds = financeData.funds && financeData.funds.length > 0;
      const hasCash = financeData.cashAccounts && financeData.cashAccounts.length > 0;
      
      if (!hasStocks && !hasFunds && !hasCash) {
        console.log('[generate-briefing] 用户', doc._id, '无持仓数据，跳过');
        continue;
      }

      // 计算净资产简报
      const briefing = calculateNetAssetBriefing(
        financeData,
        marketData.marketPrices,
        marketData.exchangeRates,
        marketData.fundNavs
      );

      // 添加新闻摘要
      briefing.newsSummary = dailyNews.slice(0, 5).map(item => ({
        title: item.title,
        source: item.source,
        link: item.link,
        summary: (item.description || '').substring(0, 100),
      }));

      // 格式化文本
      briefing.briefingText = formatBriefingText(briefing);
      briefing.newsText = formatNewsSummary(dailyNews);

      // 写入简报
      await writeBriefing(db, doc._id, briefing);
      results.briefingsGenerated++;
    } catch (e) {
      console.error('[generate-briefing] 用户', doc._id, '简报生成失败:', e.message);
      results.errors.push(doc._id + ': ' + e.message);
    }
  }

  if (results.errors.length > 0 && results.briefingsGenerated === 0) {
    results.success = false;
  }

  console.log('[generate-briefing] 执行完成:', JSON.stringify(results));
  return results;
};
