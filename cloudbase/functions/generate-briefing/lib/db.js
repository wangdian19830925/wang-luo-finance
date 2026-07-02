/**
 * 数据库读写模块（简报生成专用）
 */

const { COLLECTIONS, DOC_IDS } = require('../../shared/constants');
const { makeBriefingDocId, formatDate } = require('../../shared/utils');

/**
 * 从云端数据库读取市场数据
 */
async function readMarketData(db) {
  const result = {
    marketPrices: null,
    exchangeRates: null,
    fundNavs: {},
  };

  // 读取股价
  try {
    const res = await db.collection(COLLECTIONS.MARKET_PRICES)
      .doc(DOC_IDS.LATEST_PRICES).get();
    if (res.data) {
      result.marketPrices = res.data.stocks || {};
    }
  } catch (e) {
    console.warn('[briefing-db] 读取股价失败:', e.message);
  }

  // 读取汇率
  try {
    const res = await db.collection(COLLECTIONS.EXCHANGE_RATES)
      .doc(DOC_IDS.LATEST_RATES).get();
    if (res.data) {
      result.exchangeRates = res.data;
    }
  } catch (e) {
    console.warn('[briefing-db] 读取汇率失败:', e.message);
  }

  // 读取基金净值（需要遍历所有文档）
  try {
    const res = await db.collection(COLLECTIONS.FUND_NAVS).limit(100).get();
    if (res.data && Array.isArray(res.data)) {
      for (const doc of res.data) {
        result.fundNavs[doc.code] = doc;
      }
    }
  } catch (e) {
    console.warn('[briefing-db] 读取基金净值失败:', e.message);
  }

  return result;
}

/**
 * 读取宏观趋势数据（获取新闻）
 */
async function readMacroData(db) {
  try {
    const res = await db.collection(COLLECTIONS.MACRO_TRENDS)
      .doc(DOC_IDS.LATEST_MACRO).get();
    if (res.data) {
      return res.data;
    }
  } catch (e) {
    console.warn('[briefing-db] 读取宏观数据失败:', e.message);
  }
  return null;
}

/**
 * 读取所有 finance_data 文档
 */
async function readAllFinanceData(db) {
  try {
    const res = await db.collection(COLLECTIONS.FINANCE_DATA).limit(100).get();
    if (res.data && Array.isArray(res.data)) {
      return res.data;
    }
  } catch (e) {
    console.error('[briefing-db] 读取 finance_data 失败:', e.message);
  }
  return [];
}

/**
 * 写入每日简报到 daily_briefing 集合
 * doc ID = briefing_{userDocId}_{YYYY-MM-DD}
 */
async function writeBriefing(db, userDocId, briefingData) {
  const dateStr = formatDate(new Date());
  const docId = makeBriefingDocId(userDocId, dateStr);
  const collection = db.collection(COLLECTIONS.DAILY_BRIEFING);

  const docData = {
    _id: docId,
    userDocId: userDocId,
    ...briefingData,
    generatedAt: new Date().toISOString(),
  };

  try {
    try {
      await collection.doc(docId).set(docData);
    } catch (setErr) {
      try {
        await collection.add(docData);
      } catch (addErr) {
        await collection.doc(docId).update(briefingData);
      }
    }
    console.log('[briefing-db] 简报写入成功:', docId);
  } catch (e) {
    console.error('[briefing-db] 简报写入失败:', e.message);
  }
}

module.exports = { readMarketData, readMacroData, readAllFinanceData, writeBriefing };
