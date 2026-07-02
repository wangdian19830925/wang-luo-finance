/**
 * 数据库读取模块（PWA 客户端获取数据专用）
 */

const { COLLECTIONS, DOC_IDS } = require('../../shared/constants');
const { formatDate } = require('../../shared/utils');

/**
 * 读取最新股价数据
 */
async function readStockPrices(db) {
  try {
    const res = await db.collection(COLLECTIONS.MARKET_PRICES)
      .doc(DOC_IDS.LATEST_PRICES).get();
    if (res.data) {
      return res.data.stocks || {};
    }
  } catch (e) {
    console.warn('[get-data] 读取股价失败:', e.message);
  }
  return null;
}

/**
 * 读取最新汇率数据
 */
async function readExchangeRates(db) {
  try {
    const res = await db.collection(COLLECTIONS.EXCHANGE_RATES)
      .doc(DOC_IDS.LATEST_RATES).get();
    if (res.data) {
      return res.data;
    }
  } catch (e) {
    console.warn('[get-data] 读取汇率失败:', e.message);
  }
  return null;
}

/**
 * 读取所有基金净值数据
 */
async function readFundNavs(db) {
  try {
    const res = await db.collection(COLLECTIONS.FUND_NAVS).limit(100).get();
    if (res.data && Array.isArray(res.data)) {
      const navs = {};
      for (const doc of res.data) {
        navs[doc.code] = doc;
      }
      return navs;
    }
  } catch (e) {
    console.warn('[get-data] 读取基金净值失败:', e.message);
  }
  return null;
}

/**
 * 读取宏观趋势数据
 */
async function readMacroTrends(db) {
  try {
    const res = await db.collection(COLLECTIONS.MACRO_TRENDS)
      .doc(DOC_IDS.LATEST_MACRO).get();
    if (res.data) {
      return res.data;
    }
  } catch (e) {
    console.warn('[get-data] 读取宏观趋势失败:', e.message);
  }
  return null;
}

/**
 * 读取每日简报
 * 按用户 docId + 当日日期查询
 */
async function readDailyBriefing(db, userDocId) {
  const dateStr = formatDate(new Date());
  const docId = `briefing_${userDocId}_${dateStr}`;

  try {
    const res = await db.collection(COLLECTIONS.DAILY_BRIEFING)
      .doc(docId).get();
    if (res.data) {
      return res.data;
    }
  } catch (e) {
    // 今日简报可能尚未生成（开盘前）
    console.warn('[get-data] 今日简报未找到:', docId);
  }

  // 尝试获取最近的简报（前1天）
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDate(yesterday);
  const yesterdayDocId = `briefing_${userDocId}_${yesterdayStr}`;

  try {
    const res = await db.collection(COLLECTIONS.DAILY_BRIEFING)
      .doc(yesterdayDocId).get();
    if (res.data) {
      return res.data;
    }
  } catch (e) {
    console.warn('[get-data] 昨日简报也未找到');
  }

  return null;
}

module.exports = {
  readStockPrices,
  readExchangeRates,
  readFundNavs,
  readMacroTrends,
  readDailyBriefing,
};
