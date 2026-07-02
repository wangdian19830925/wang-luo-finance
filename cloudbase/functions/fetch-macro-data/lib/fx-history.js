/**
 * 汇率历史获取模块（宏观趋势专用）
 * 从 frankfurter.app 获取近6个月汇率历史
 */

const { DATA_SOURCES } = require('../../shared/constants');
const { fetchWithTimeout, formatDate } = require('../../shared/utils');

/**
 * 获取近6个月汇率历史
 * 返回 { usdCny: [{date, rate}], hkdCny: [{date, rate}], source, updatedAt }
 */
async function fetchFxHistoryForMacro() {
  console.log('[fx-history] 开始获取汇率历史（宏观趋势）');

  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - 6);

  const startStr = formatDate(start);
  const endStr = formatDate(now);

  const url = `${DATA_SOURCES.FRANKFURTER_HISTORY}${startStr}..${endStr}?from=USD&to=CNY,HKD,EUR`;

  try {
    const text = await fetchWithTimeout(url, 20000);
    const data = JSON.parse(text);

    if (!data.rates) {
      console.warn('[fx-history] 汇率历史无数据');
      return null;
    }

    const usdCny = [];
    const hkdCny = [];
    const eurCny = [];

    for (const [date, rates] of Object.entries(data.rates)) {
      const cny = rates.CNY;
      const hkd = rates.HKD;
      const eur = rates.EUR;
      if (cny) usdCny.push({ date, rate: cny });
      if (cny && hkd) hkdCny.push({ date, rate: parseFloat((cny / hkd).toFixed(4)) });
      if (cny && eur) eurCny.push({ date, rate: parseFloat((cny / eur).toFixed(4)) });
    }

    usdCny.sort((a, b) => a.date.localeCompare(b.date));
    hkdCny.sort((a, b) => a.date.localeCompare(b.date));
    eurCny.sort((a, b) => a.date.localeCompare(b.date));

    console.log('[fx-history] 获取成功: USDCNY', usdCny.length, '条, HKDCNY', hkdCny.length, '条');

    return {
      usdCny,
      hkdCny,
      eurCny,
      source: 'frankfurter.app',
      updatedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[fx-history] 获取失败:', e.message);
    return null;
  }
}

module.exports = { fetchFxHistoryForMacro };
