/**
 * CloudBase 云函数共享工具函数
 */

/**
 * 初始化 CloudBase node-sdk（云函数环境自动检测 env）
 */
function initDb() {
  const tcb = require('@cloudbase/node-sdk');
  const app = tcb.init();
  const db = app.database();
  return { app, db };
}

/**
 * 将内部股票代码转换为腾讯 API 代码
 * 与 PWA 客户端 _getTencentCode 逻辑一致
 */
function getTencentCode(code, market) {
  if (!code) return '';
  if (market === 'HK' || code.length === 5) return 'hk' + code;
  if (market === 'US') return 'us' + code.toUpperCase();
  // A股：6开头→沪市(sh)，其他→深市(sz)
  if (code.startsWith('6')) return 'sh' + code;
  return 'sz' + code;
}

/**
 * 解析腾讯财经 API 返回的字符串（JSONP 格式）
 * 腾讯 API 返回格式：v_xxx="1~名称~代码~当前价~昨收~..."
 * fields 索引：0:未知, 1:名称, 2:代码, 3:当前价, 4:昨收, 5:今开, ...
 * 
 * 在云函数中，HTTP fetch 直接返回原始文本（非 JSONP callback）
 * 返回格式：每行一个 v_xxx="字段1~字段2~..."
 */
function parseTencentStockData(text) {
  const stocks = {};
  if (!text || typeof text !== 'string') return stocks;

  // 按行分割（每行一个股票数据）
  const lines = text.split(';').filter(l => l.trim());
  
  for (const line of lines) {
    // 匹配 v_xxx="..." 格式
    const match = line.match(/v_(\w+)="([^"]*)"/);
    if (!match) continue;
    
    const tencentCode = match[1];
    const dataStr = match[2];
    const parts = dataStr.split('~');
    
    if (parts.length < 5) continue;

    const name = parts[1];
    const code = parts[2];
    const currentPrice = parseFloat(parts[3]) || 0;
    const prevClose = parseFloat(parts[4]) || 0;

    if (currentPrice > 0) {
      stocks[tencentCode] = {
        name: name,
        rawCode: code,
        price: currentPrice,
        prevClose: prevClose,
        change: currentPrice - prevClose,
        changeRate: prevClose > 0 ? ((currentPrice - prevClose) / prevClose * 100) : 0,
        source: 'tencent-live',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return stocks;
}

/**
 * 解析 pingzhongdata JS 文件（正则提取，不用 eval）
 * pingzhongdata 返回的 JS 文件包含：
 * - fS_name = "基金名称"
 * - Data_netWorthTrend = [{x:timestamp,y:nav},...]
 */
function parsePingzhongData(text) {
  const result = { nav: 0, name: '', history: [] };
  if (!text || typeof text !== 'string') return result;

  // 提取基金名称
  const nameMatch = text.match(/fS_name\s*=\s*"([^"]+)"/);
  if (nameMatch) {
    result.name = nameMatch[1];
  }

  // 提取净值历史
  const historyMatch = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (historyMatch) {
    try {
      const historyRaw = JSON.parse(historyMatch[1]);
      const history = [];
      for (const item of historyRaw) {
        const d = new Date(item.x);
        const dateStr = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        const nav = parseFloat(item.y) || 0;
        if (nav > 0) {
          history.push({ date: dateStr, nav: nav });
        }
      }
      if (history.length > 0) {
        result.history = history;
        result.nav = history[history.length - 1].nav;
      }
    } catch (e) {
      console.error('[pingzhong] JSON解析失败:', e.message);
    }
  }

  return result;
}

/**
 * 截取基金净值历史（保留最近 N 天）
 */
function trimFundHistory(history, days) {
  if (!history || history.length === 0) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.getFullYear() + '-' +
    String(cutoff.getMonth() + 1).padStart(2, '0') + '-' +
    String(cutoff.getDate()).padStart(2, '0');
  return history.filter(item => item.date >= cutoffStr);
}

/**
 * HTTP fetch 封装（带超时和错误处理）
 */
async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`Timeout after ${timeoutMs}ms for ${url}`);
    }
    throw e;
  }
}

/**
 * 生成日期字符串 YYYY-MM-DD
 */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * 生成简报文档 ID
 * 格式：briefing_{userDocId}_{YYYY-MM-DD}
 */
function makeBriefingDocId(userDocId, dateStr) {
  return `briefing_${userDocId}_${dateStr}`;
}

module.exports = {
  initDb,
  getTencentCode,
  parseTencentStockData,
  parsePingzhongData,
  trimFundHistory,
  fetchWithTimeout,
  formatDate,
  makeBriefingDocId,
};
