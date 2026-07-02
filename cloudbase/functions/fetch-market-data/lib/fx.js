/**
 * 汇率获取模块
 * 从 open.er-api.com 获取实时汇率，从 frankfurter.app 获取历史汇率
 */

const { DATA_SOURCES } = require('../../shared/constants');
const { fetchWithTimeout, formatDate } = require('../../shared/utils');

/**
 * 获取实时汇率（USD/CNY, HKD/CNY）
 */
async function fetchExchangeRates() {
  console.log('[fx] 开始获取实时汇率');

  try {
    const text = await fetchWithTimeout(DATA_SOURCES.EXCHANGE_RATE, 10000);
    const data = JSON.parse(text);
    
    const rates = data.rates || {};
    const cny = rates.CNY;
    const hkd = rates.HKD;
    const eur = rates.EUR;

    if (!cny) {
      console.warn('[fx] API 返回无 CNY 汇率');
      return null;
    }

    const result = {
      USDCNY: parseFloat(cny.toFixed(4)),
      HKDCNY: hkd ? parseFloat((cny / hkd).toFixed(4)) : 0,
      EURCNY: eur ? parseFloat((cny / eur).toFixed(4)) : 0,
      source: 'open.er-api.com',
      updatedAt: new Date().toISOString(),
    };

    console.log('[fx] 实时汇率:', JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('[fx] 实时汇率获取失败:', e.message);
    return null;
  }
}

/**
 * 获取近6个月汇率历史（用于走势图）
 * frankfurter.app 返回 { date: { USD: rate, HKD: rate, EUR: rate } } 格式
 */
async function fetchFxHistory() {
  console.log('[fx] 开始获取汇率历史');

  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - 6);

  const startStr = formatDate(start);
  const endStr = formatDate(now);

  // frankfurter.app 支持 CNY, HKD, EUR
  const url = `${DATA_SOURCES.FRANKFURTER_HISTORY}${startStr}..${endStr}?from=USD&to=CNY,HKD,EUR`;
  
  try {
    const text = await fetchWithTimeout(url, 20000);
    const data = JSON.parse(text);

    if (!data.rates) {
      console.warn('[fx] 汇率历史无数据');
      return null;
    }

    // 转换为客户端走势图格式
    const usdCny = [];
    const hkdCny = [];
    
    for (const [date, rates] of Object.entries(data.rates)) {
      const cny = rates.CNY;
      const hkd = rates.HKD;
      if (cny) {
        usdCny.push({ date, rate: cny });
      }
      if (cny && hkd) {
        hkdCny.push({ date, rate: parseFloat((cny / hkd).toFixed(4)) });
      }
    }

    // 按日期排序
    usdCny.sort((a, b) => a.date.localeCompare(b.date));
    hkdCny.sort((a, b) => a.date.localeCompare(b.date));

    console.log('[fx] 汇率历史:', usdCny.length, '条 USDCNY,', hkdCny.length, '条 HKDCNY');
    
    return {
      usdCny,
      hkdCny,
      source: 'frankfurter.app',
      updatedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[fx] 汇率历史获取失败:', e.message);
    return null;
  }
}

module.exports = { fetchExchangeRates, fetchFxHistory };
