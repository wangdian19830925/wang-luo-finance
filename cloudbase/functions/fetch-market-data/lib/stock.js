/**
 * 股价获取模块
 * 从腾讯财经 API 获取 A股/港股/美股 实时价格
 */

const { DATA_SOURCES } = require('../../shared/constants');
const { getTencentCode, parseTencentStockData, fetchWithTimeout } = require('../../shared/utils');

/**
 * 从 finance_data 文档中提取所有股票/RSU代码
 * 返回格式：[{ code, market, tencentCode }]
 */
function extractStockCodes(financeData) {
  const codes = [];
  const codeSet = new Set();

  // 从股票列表提取
  if (financeData.stocks && Array.isArray(financeData.stocks)) {
    for (const s of financeData.stocks) {
      if (s.code && !codeSet.has(s.code)) {
        const tc = getTencentCode(s.code, s.market);
        codes.push({ code: s.code, market: s.market, tencentCode: tc });
        codeSet.add(s.code);
      }
    }
  }

  // 从 RSU 列表提取
  if (financeData.rsu && Array.isArray(financeData.rsu)) {
    for (const r of financeData.rsu) {
      if (r.code && !codeSet.has(r.code)) {
        const tc = getTencentCode(r.code, 'CN');
        codes.push({ code: r.code, market: 'CN', tencentCode: tc });
        codeSet.add(r.code);
      }
    }
  }

  return codes;
}

/**
 * 获取所有用户持仓的股票实时价格
 * 1. 从 finance_data 集合读取所有文档，提取股票代码
 * 2. 批量 fetch 腾讯财经 API（云函数无 CORS 限制）
 * 3. 解析返回数据
 */
async function fetchStockPrices(db) {
  console.log('[stock] 开始获取股价数据');
  
  // 读取所有 finance_data 文档获取股票代码列表
  const financeCollection = db.collection('finance_data');
  let allCodes = [];
  
  try {
    const res = await financeCollection.limit(100).get();
    if (res.data && Array.isArray(res.data)) {
      for (const doc of res.data) {
        // 解析 jsonData
        let financeData = doc.data || {};
        if (doc.jsonData && typeof doc.jsonData === 'string') {
          try {
            financeData = JSON.parse(doc.jsonData);
          } catch (e) {
            console.warn('[stock] jsonData 解析失败:', doc._id);
          }
        }
        const codes = extractStockCodes(financeData);
        allCodes = allCodes.concat(codes);
      }
    }
  } catch (e) {
    console.error('[stock] 读取 finance_data 失败:', e.message);
    return { stocks: {}, tencentCodes: [] };
  }

  // 去重
  const uniqueCodes = [];
  const seenTc = new Set();
  for (const c of allCodes) {
    if (!seenTc.has(c.tencentCode)) {
      uniqueCodes.push(c);
      seenTc.add(c.tencentCode);
    }
  }

  if (uniqueCodes.length === 0) {
    console.log('[stock] 无股票代码需要获取');
    return { stocks: {}, tencentCodes: [] };
  }

  // 批量获取：腾讯财经支持多代码查询（逗号分隔）
  const tencentCodeList = uniqueCodes.map(c => c.tencentCode);
  const codeMap = {};  // tencentCode → { code, market }
  for (const c of uniqueCodes) {
    codeMap[c.tencentCode] = { code: c.code, market: c.market };
  }

  const url = DATA_SOURCES.TENCENT_STOCK + tencentCodeList.join(',');
  console.log('[stock] 请求 URL:', url, '代码数:', tencentCodeList.length);

  try {
    const text = await fetchWithTimeout(url, 15000);
    const parsed = parseTencentStockData(text);

    // 将腾讯代码映射回内部代码
    const stocks = {};
    for (const tc of Object.keys(parsed)) {
      const mapping = codeMap[tc];
      if (mapping) {
        stocks[mapping.code] = {
          ...parsed[tc],
          market: mapping.market,
        };
      } else {
        // 无法映射时用原始 tencentCode
        stocks[tc] = parsed[tc];
      }
    }

    console.log('[stock] 获取成功:', Object.keys(stocks).length, '只股票');
    return { stocks, tencentCodes: tencentCodeList };
  } catch (e) {
    console.error('[stock] 腾讯财经 API 请求失败:', e.message);
    return { stocks: {}, tencentCodes: tencentCodeList };
  }
}

module.exports = { fetchStockPrices, extractStockCodes };
