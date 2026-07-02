/**
 * fetch-market-data 云函数主入口
 * 定时获取：股价 + 汇率 + 基金净值 → 写入云端数据库
 * 
 * 触发方式：定时触发器（A股交易时段 9:15~15:00）
 * 也可通过 callFunction 手动调用：{ action: 'fetch' }
 */

const { initDb } = require('../shared/utils');
const { fetchStockPrices } = require('./lib/stock');
const { fetchExchangeRates, fetchFxHistory } = require('./lib/fx');
const { fetchFundNavs } = require('./lib/fund');
const { writeStockPrices, writeExchangeRates, writeFundNavs, writeFxHistory } = require('./lib/db');

exports.main = async (event, context) => {
  console.log('[fetch-market-data] 开始执行, event:', JSON.stringify(event));

  const { db } = initDb();
  const results = {
    success: true,
    stocks: 0,
    rates: false,
    funds: 0,
    fxHistory: false,
    errors: [],
  };

  // 1. 获取股价
  try {
    const stockResult = await fetchStockPrices(db);
    if (stockResult.stocks && Object.keys(stockResult.stocks).length > 0) {
      await writeStockPrices(db, stockResult.stocks);
      results.stocks = Object.keys(stockResult.stocks).length;
    }
  } catch (e) {
    console.error('[fetch-market-data] 股价获取失败:', e.message);
    results.errors.push('stock: ' + e.message);
  }

  // 2. 获取汇率
  try {
    const rates = await fetchExchangeRates();
    if (rates) {
      await writeExchangeRates(db, rates);
      results.rates = true;
    }
  } catch (e) {
    console.error('[fetch-market-data] 汇率获取失败:', e.message);
    results.errors.push('fx: ' + e.message);
  }

  // 3. 获取基金净值
  try {
    const fundResults = await fetchFundNavs(db);
    if (fundResults && Object.keys(fundResults).length > 0) {
      await writeFundNavs(db, fundResults);
      results.funds = Object.keys(fundResults).length;
    }
  } catch (e) {
    console.error('[fetch-market-data] 基金净值获取失败:', e.message);
    results.errors.push('fund: ' + e.message);
  }

  // 4. 获取汇率历史（走势图数据）
  try {
    const fxHistory = await fetchFxHistory();
    if (fxHistory) {
      await writeFxHistory(db, fxHistory);
      results.fxHistory = true;
    }
  } catch (e) {
    console.error('[fetch-market-data] 汇率历史获取失败:', e.message);
    results.errors.push('fxHistory: ' + e.message);
  }

  // 如果有任何错误，标记部分失败
  if (results.errors.length > 0) {
    results.success = results.stocks > 0 || results.rates || results.funds > 0;
  }

  console.log('[fetch-market-data] 执行完成:', JSON.stringify(results));
  return results;
};
