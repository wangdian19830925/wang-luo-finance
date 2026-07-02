/**
 * get-cloud-data 云函数主入口
 * PWA 客户端通过 callFunction 获取云端预计算的市场数据
 * 
 * 客户端调用方式：
 * app.callFunction({
 *   name: 'get-cloud-data',
 *   data: { types: ['prices', 'rates', 'navs', 'macro', 'briefing'] }
 * })
 * 
 * 返回格式：
 * { prices: {...}, rates: {...}, navs: {...}, macro: {...}, briefing: {...} }
 */

const { initDb } = require('../shared/utils');
const { DOC_IDS } = require('../shared/constants');
const {
  readStockPrices,
  readExchangeRates,
  readFundNavs,
  readMacroTrends,
  readDailyBriefing,
} = require('./lib/db');

exports.main = async (event, context) => {
  console.log('[get-cloud-data] 请求参数:', JSON.stringify(event));

  const { db } = initDb();
  const types = event.types || ['prices', 'rates', 'navs', 'macro', 'briefing'];
  const userDocId = event.userDocId || DOC_IDS.FINANCE_DATA;
  const result = {};

  // 1. 股价数据
  if (types.includes('prices')) {
    result.prices = await readStockPrices(db);
  }

  // 2. 汇率数据
  if (types.includes('rates')) {
    result.rates = await readExchangeRates(db);
  }

  // 3. 基金净值数据
  if (types.includes('navs')) {
    result.navs = await readFundNavs(db);
  }

  // 4. 宏观趋势数据
  if (types.includes('macro')) {
    result.macro = await readMacroTrends(db);
  }

  // 5. 每日简报
  if (types.includes('briefing')) {
    result.briefing = await readDailyBriefing(db, userDocId);
  }

  // 添加元信息
  result._meta = {
    fetchedAt: new Date().toISOString(),
    types: types,
    userDocId: userDocId,
  };

  console.log('[get-cloud-data] 返回数据类型:', Object.keys(result).filter(k => k !== '_meta').join(','));
  return result;
};
