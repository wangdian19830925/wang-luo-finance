/**
 * 数据库写入模块
 * 将获取的市场数据写入 CloudBase 数据库
 */

const { COLLECTIONS, DOC_IDS } = require('../../shared/constants');

/**
 * 写入股价数据到 market_prices 集合
 * 使用固定文档 ID: latest_prices
 */
async function writeStockPrices(db, stocksData) {
  if (!stocksData || Object.keys(stocksData).length === 0) {
    console.log('[db] 无股价数据需写入');
    return;
  }

  const collection = db.collection(COLLECTIONS.MARKET_PRICES);
  const docData = {
    _id: DOC_IDS.LATEST_PRICES,
    stocks: stocksData,
    updatedAt: new Date().toISOString(),
  };

  try {
    // 尝试 set（覆盖），失败时用 add
    try {
      await collection.doc(DOC_IDS.LATEST_PRICES).set(docData);
      console.log('[db] 股价数据写入成功 (set)');
    } catch (setErr) {
      // set 失败可能是因为文档不存在且不能用 set 创建
      try {
        await collection.add(docData);
        console.log('[db] 股价数据写入成功 (add)');
      } catch (addErr) {
        // add 失败可能是因为 _id 已存在
        // 使用 update 替代
        await collection.doc(DOC_IDS.LATEST_PRICES).update({
          stocks: stocksData,
          updatedAt: new Date().toISOString(),
        });
        console.log('[db] 股价数据写入成功 (update)');
      }
    }
  } catch (e) {
    console.error('[db] 股价数据写入失败:', e.message);
    throw e;
  }
}

/**
 * 写入汇率数据到 exchange_rates 集合
 * 使用固定文档 ID: latest_rates
 */
async function writeExchangeRates(db, ratesData) {
  if (!ratesData) {
    console.log('[db] 无汇率数据需写入');
    return;
  }

  const collection = db.collection(COLLECTIONS.EXCHANGE_RATES);
  const docData = {
    _id: DOC_IDS.LATEST_RATES,
    ...ratesData,
    updatedAt: new Date().toISOString(),
  };

  try {
    try {
      await collection.doc(DOC_IDS.LATEST_RATES).set(docData);
      console.log('[db] 汇率数据写入成功 (set)');
    } catch (setErr) {
      try {
        await collection.add(docData);
        console.log('[db] 汇率数据写入成功 (add)');
      } catch (addErr) {
        await collection.doc(DOC_IDS.LATEST_RATES).update({
          USDCNY: ratesData.USDCNY,
          HKDCNY: ratesData.HKDCNY,
          EURCNY: ratesData.EURCNY || 0,
          source: ratesData.source,
          updatedAt: new Date().toISOString(),
        });
        console.log('[db] 汇率数据写入成功 (update)');
      }
    }
  } catch (e) {
    console.error('[db] 汇率数据写入失败:', e.message);
    throw e;
  }
}

/**
 * 写入基金净值数据到 fund_navs 集合
 * 每只基金一个文档，doc ID = 基金代码
 */
async function writeFundNavs(db, fundResults) {
  if (!fundResults || Object.keys(fundResults).length === 0) {
    console.log('[db] 无基金净值数据需写入');
    return;
  }

  const collection = db.collection(COLLECTIONS.FUND_NAVS);
  let successCount = 0;
  let failCount = 0;

  for (const [code, data] of Object.entries(fundResults)) {
    // 历史数据可能较大，不存入 DB 主字段（只存 nav + name + 最近历史）
    const docData = {
      _id: code,
      code: data.code,
      name: data.name,
      nav: data.nav,
      // 只保留最近 30 天历史在主文档（完整 6 个月历史存 history 字段）
      recentHistory: data.history ? data.history.slice(-30) : [],
      history: data.history || [],
      source: data.source,
      updatedAt: data.updatedAt,
    };

    // 如果 history 太大（>100KB），只存 recentHistory，不存完整 history
    const historySize = JSON.stringify(data.history || []).length;
    if (historySize > 100000) {
      console.log('[db] ' + code + ' 历史数据过大(' + historySize + '字节)，只存最近30天');
      docData.history = data.history.slice(-60); // 保留60天而非完整
    }

    try {
      try {
        await collection.doc(code).set(docData);
      } catch (setErr) {
        try {
          await collection.add(docData);
        } catch (addErr) {
          await collection.doc(code).update({
            nav: data.nav,
            name: data.name,
            recentHistory: docData.recentHistory,
            history: docData.history,
            source: data.source,
            updatedAt: data.updatedAt,
          });
        }
      }
      successCount++;
    } catch (e) {
      console.error('[db] 基金 ' + code + ' 写入失败:', e.message);
      failCount++;
    }
  }

  console.log('[db] 基金净值写入完成: 成功', successCount, '失败', failCount);
}

/**
 * 写入汇率历史到 exchange_rates 集合的 latest_rates 文档
 * (追加 fxHistory 字段)
 */
async function writeFxHistory(db, fxHistoryData) {
  if (!fxHistoryData) {
    console.log('[db] 无汇率历史数据需写入');
    return;
  }

  const collection = db.collection(COLLECTIONS.EXCHANGE_RATES);

  try {
    await collection.doc(DOC_IDS.LATEST_RATES).update({
      fxHistory: fxHistoryData,
    });
    console.log('[db] 汇率历史写入成功');
  } catch (e) {
    console.error('[db] 汇率历史写入失败:', e.message);
  }
}

module.exports = {
  writeStockPrices,
  writeExchangeRates,
  writeFundNavs,
  writeFxHistory,
};
