/**
 * 基金净值获取模块
 * 从东方财富 pingzhongdata API 获取基金最新净值和历史净值
 */

const { DATA_SOURCES, FUND_HISTORY_DAYS } = require('../../shared/constants');
const { parsePingzhongData, trimFundHistory, fetchWithTimeout } = require('../../shared/utils');

/**
 * 从 finance_data 文档中提取所有基金代码（去重）
 */
function extractFundCodes(financeData) {
  const codes = new Set();
  if (financeData.funds && Array.isArray(financeData.funds)) {
    for (const f of financeData.funds) {
      if (f.code) codes.add(f.code);
    }
  }
  return Array.from(codes);
}

/**
 * 获取所有用户持仓的基金净值
 * 1. 从 finance_data 集合提取所有基金代码
 * 2. 逐个 fetch pingzhongdata（JS 文件，正则提取）
 * 3. 截取近6个月历史，写入 fund_navs 集合
 */
async function fetchFundNavs(db) {
  console.log('[fund] 开始获取基金净值');

  // 读取所有 finance_data 文档获取基金代码列表
  const financeCollection = db.collection('finance_data');
  const allCodes = new Set();

  try {
    const res = await financeCollection.limit(100).get();
    if (res.data && Array.isArray(res.data)) {
      for (const doc of res.data) {
        let financeData = doc.data || {};
        if (doc.jsonData && typeof doc.jsonData === 'string') {
          try {
            financeData = JSON.parse(doc.jsonData);
          } catch (e) {
            console.warn('[fund] jsonData 解析失败:', doc._id);
          }
        }
        const codes = extractFundCodes(financeData);
        for (const c of codes) {
          allCodes.add(c);
        }
      }
    }
  } catch (e) {
    console.error('[fund] 读取 finance_data 失败:', e.message);
    return {};
  }

  const fundCodeList = Array.from(allCodes);
  if (fundCodeList.length === 0) {
    console.log('[fund] 无基金代码需要获取');
    return {};
  }

  console.log('[fund] 需获取基金代码:', fundCodeList.join(','));

  // 逐个获取 pingzhongdata（与客户端逻辑一致，避免并发问题）
  const results = {};
  
  for (const code of fundCodeList) {
    const url = DATA_SOURCES.FUND_PINGZHONGDATA + code + '.js';
    console.log('[fund] 请求:', url);

    try {
      const text = await fetchWithTimeout(url, 15000);
      const parsed = parsePingzhongData(text);

      if (parsed.nav > 0) {
        // 截取近6个月历史
        const trimmedHistory = trimFundHistory(parsed.history, FUND_HISTORY_DAYS);
        
        results[code] = {
          code: code,
          name: parsed.name,
          nav: parsed.nav,
          history: trimmedHistory,
          source: 'eastmoney-pingzhong',
          updatedAt: new Date().toISOString(),
        };
        console.log('[fund] ' + code + ' (' + parsed.name + ') 最新净值:', parsed.nav, '历史条数:', trimmedHistory.length);
      } else {
        console.warn('[fund] ' + code + ' 净值获取失败');
        results[code] = {
          code: code,
          name: parsed.name || code,
          nav: 0,
          history: [],
          source: 'eastmoney-pingzhong',
          updatedAt: new Date().toISOString(),
          error: 'nav=0',
        };
      }
    } catch (e) {
      console.error('[fund] ' + code + ' pingzhongdata 请求失败:', e.message);
      results[code] = {
        code: code,
        name: code,
        nav: 0,
        history: [],
        source: 'eastmoney-pingzhong',
        updatedAt: new Date().toISOString(),
        error: e.message,
      };
    }

    // 间隔 200ms 避免被限流
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('[fund] 获取完成:', Object.keys(results).length, '只基金');
  return results;
}

module.exports = { fetchFundNavs, extractFundCodes };
