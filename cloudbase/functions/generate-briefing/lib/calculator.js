/**
 * 净资产计算模块
 * 从云端数据库读取市场数据和用户持仓，计算净资产变化
 */

const { COLLECTIONS, DOC_IDS } = require('../../shared/constants');
const { formatDate } = require('../../shared/utils');

/**
 * 从 finance_data 文档解析用户持仓数据
 */
function parseFinanceData(doc) {
  let data = doc.data || {};
  if (doc.jsonData && typeof doc.jsonData === 'string') {
    try {
      data = JSON.parse(doc.jsonData);
    } catch (e) {
      console.warn('[calc] jsonData 解析失败:', doc._id);
    }
  }
  return data;
}

/**
 * 计算单个用户的净资产简报
 * 
 * @param {Object} financeData - 用户持仓数据（从 finance_data 文档解析）
 * @param {Object} marketPrices - 最新股价（从 market_prices 文档）
 * @param {Object} exchangeRates - 最新汇率（从 exchange_rates 文档）
 * @param {Object} fundNavs - 最新基金净值（从 fund_navs 集合）
 * @returns {Object} 净资产简报数据
 */
function calculateNetAssetBriefing(financeData, marketPrices, exchangeRates, fundNavs) {
  const today = formatDate(new Date());
  const rates = exchangeRates || {};
  const getRate = (currency) => {
    if (currency === 'CNY') return 1;
    if (currency === 'HKD') return rates.HKDCNY || 0.92;
    if (currency === 'USD') return rates.USDCNY || 7.2;
    if (currency === 'EUR') return rates.EURCNY || 8.0;
    return 1;
  };

  // 计算股票市值
  let stockToday = 0;
  let stockYesterday = 0;
  const stockDetails = [];

  if (financeData.stocks && Array.isArray(financeData.stocks)) {
    for (const s of financeData.stocks) {
      const priceInfo = marketPrices && marketPrices[s.code];
      const rate = getRate(s.currency || 'CNY');
      
      const currentPrice = priceInfo ? priceInfo.price : (s.currentPrice || 0);
      const prevClose = priceInfo ? priceInfo.prevClose : currentPrice;
      const shares = s.shares || 0;

      const todayValue = shares * currentPrice * rate;
      const yesterdayValue = shares * prevClose * rate;

      stockToday += todayValue;
      stockYesterday += yesterdayValue;

      if (shares > 0 && currentPrice > 0) {
        stockDetails.push({
          name: s.name || s.code,
          code: s.code,
          todayValue: parseFloat(todayValue.toFixed(2)),
          yesterdayValue: parseFloat(yesterdayValue.toFixed(2)),
          change: parseFloat((todayValue - yesterdayValue).toFixed(2)),
          changeRate: yesterdayValue > 0 ? parseFloat(((todayValue - yesterdayValue) / yesterdayValue * 100).toFixed(2)) : 0,
        });
      }
    }
  }

  // 计算 RSU 市值
  if (financeData.rsu && Array.isArray(financeData.rsu)) {
    for (const r of financeData.rsu) {
      const priceInfo = marketPrices && marketPrices[r.code];
      const currentPrice = priceInfo ? priceInfo.price : (r.currentPrice || 0);
      const prevClose = priceInfo ? priceInfo.prevClose : currentPrice;
      const shares = r.shares || r.vestedShares || 0;
      const rate = getRate(r.currency || 'CNY');

      const todayValue = shares * currentPrice * rate;
      const yesterdayValue = shares * prevClose * rate;

      stockToday += todayValue;
      stockYesterday += yesterdayValue;
    }
  }

  // 计算基金市值
  let fundToday = 0;
  let fundYesterday = 0;
  const fundDetails = [];

  if (financeData.funds && Array.isArray(financeData.funds)) {
    for (const f of financeData.funds) {
      const navInfo = fundNavs && fundNavs[f.code];
      const nav = navInfo ? navInfo.nav : (f.nav || 0);
      
      // effectiveShares = holdValue / nav (shares-anchor model)
      const holdValue = f.holdValue || 0;
      const effectiveShares = (nav > 0 && holdValue > 0) ? holdValue / nav : (f.shares || 0);

      // 昨日净值：从历史取前一条，若无则用今日净值
      let prevNav = nav;
      if (navInfo && navInfo.history && navInfo.history.length >= 2) {
        prevNav = navInfo.history[navInfo.history.length - 2].nav;
      }

      const todayValue = effectiveShares * nav;
      const yesterdayValue = effectiveShares * prevNav;

      fundToday += todayValue;
      fundYesterday += yesterdayValue;

      if (effectiveShares > 0 && nav > 0) {
        fundDetails.push({
          name: f.name || navInfo?.name || f.code,
          code: f.code,
          todayValue: parseFloat(todayValue.toFixed(2)),
          yesterdayValue: parseFloat(yesterdayValue.toFixed(2)),
          change: parseFloat((todayValue - yesterdayValue).toFixed(2)),
          changeRate: yesterdayValue > 0 ? parseFloat(((todayValue - yesterdayValue) / yesterdayValue * 100).toFixed(2)) : 0,
        });
      }
    }
  }

  // 现金资产（不随市场变化）
  let cashToday = 0;
  if (financeData.cashAccounts && Array.isArray(financeData.cashAccounts)) {
    for (const c of financeData.cashAccounts) {
      cashToday += (c.balance || c.amount || 0);
    }
  }
  let cashYesterday = cashToday; // 现金日变化为0（除非用户手动修改）

  // 公积金余额
  let providentFundToday = 0;
  let providentFundYesterday = 0;
  if (financeData._providentFundParams) {
    providentFundToday = financeData._providentFundParams.providentFundBalance || 0;
    const monthlyIncrease = financeData._providentFundParams.providentFundMonthly || 0;
    // 昨日余额 = 今日余额 - 每月增加/30（粗略估算日变化）
    providentFundYesterday = providentFundToday - (monthlyIncrease / 30);
  }

  // 其他资产
  let otherToday = 0;
  if (financeData.assets && Array.isArray(financeData.assets)) {
    for (const a of financeData.assets) {
      otherToday += (a.value || a.amount || 0);
    }
  }
  let otherYesterday = otherToday;

  // 总计
  const totalToday = stockToday + fundToday + cashToday + providentFundToday + otherToday;
  const totalYesterday = stockYesterday + fundYesterday + cashYesterday + providentFundYesterday + otherYesterday;
  const dailyChange = totalToday - totalYesterday;
  const dailyChangeRate = totalYesterday > 0 ? (dailyChange / totalYesterday * 100) : 0;

  // 涨跌幅排行（取变化最大的5个）
  const allMovers = [...stockDetails, ...fundDetails]
    .sort((a, b) => Math.abs(b.changeRate) - Math.abs(a.changeRate))
    .slice(0, 5);

  return {
    date: today,
    summary: {
      totalAssets: parseFloat(totalToday.toFixed(2)),
      totalYesterday: parseFloat(totalYesterday.toFixed(2)),
      dailyChange: parseFloat(dailyChange.toFixed(2)),
      dailyChangeRate: parseFloat(dailyChangeRate.toFixed(2)),
      breakdown: {
        stocks: {
          today: parseFloat(stockToday.toFixed(2)),
          yesterday: parseFloat(stockYesterday.toFixed(2)),
          change: parseFloat((stockToday - stockYesterday).toFixed(2)),
        },
        funds: {
          today: parseFloat(fundToday.toFixed(2)),
          yesterday: parseFloat(fundYesterday.toFixed(2)),
          change: parseFloat((fundToday - fundYesterday).toFixed(2)),
        },
        cash: {
          today: parseFloat(cashToday.toFixed(2)),
          yesterday: parseFloat(cashYesterday.toFixed(2)),
          change: 0,
        },
        providentFund: {
          today: parseFloat(providentFundToday.toFixed(2)),
          yesterday: parseFloat(providentFundYesterday.toFixed(2)),
          change: parseFloat((providentFundToday - providentFundYesterday).toFixed(2)),
        },
        other: {
          today: parseFloat(otherToday.toFixed(2)),
          yesterday: parseFloat(otherYesterday.toFixed(2)),
          change: 0,
        },
      },
      topMovers: allMovers,
    },
  };
}

module.exports = { parseFinanceData, calculateNetAssetBriefing };
