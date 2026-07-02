/**
 * 新闻获取模块
 * 从 CNBC RSS 和东方财富 RSS 获取财经新闻
 */

const { DATA_SOURCES } = require('../../shared/constants');
const { fetchWithTimeout } = require('../../shared/utils');

/**
 * 获取 CNBC 财经新闻（via rss2json API）
 * 返回 [{ title, link, description, pubDate, source }]
 */
async function fetchCNBCNews() {
  console.log('[news] 开始获取 CNBC 新闻');
  
  const apiUrl = DATA_SOURCES.RSS2JSON + encodeURIComponent(DATA_SOURCES.CNBC_RSS);
  
  try {
    const text = await fetchWithTimeout(apiUrl, 15000);
    const data = JSON.parse(text);
    
    if (!data || data.status !== 'ok' || !Array.isArray(data.items)) {
      console.warn('[news] CNBC RSS 返回异常');
      return [];
    }

    const news = data.items.slice(0, 10).map(item => ({
      title: item.title || '',
      link: item.link || '',
      description: (item.description || '').substring(0, 200),
      pubDate: item.pubDate || '',
      source: 'CNBC',
    }));

    console.log('[news] CNBC 新闻获取成功:', news.length, '条');
    return news;
  } catch (e) {
    console.error('[news] CNBC 新闻获取失败:', e.message);
    return [];
  }
}

/**
 * 获取东方财富国内财经新闻
 * 使用东方财富新闻 RSS feed
 */
async function fetchEastMoneyNews() {
  console.log('[news] 开始获取东方财富新闻');

  // 东方财富要闻 RSS
  const rssUrl = 'https://news.eastmoney.com/kuaixun.xml';
  const apiUrl = DATA_SOURCES.RSS2JSON + encodeURIComponent(rssUrl);
  
  try {
    const text = await fetchWithTimeout(apiUrl, 15000);
    const data = JSON.parse(text);

    if (!data || data.status !== 'ok' || !Array.isArray(data.items)) {
      console.warn('[news] 东方财富 RSS 返回异常');
      return [];
    }

    const news = data.items.slice(0, 10).map(item => ({
      title: item.title || '',
      link: item.link || '',
      description: (item.description || '').substring(0, 200),
      pubDate: item.pubDate || '',
      source: '东方财富',
    }));

    console.log('[news] 东方财富新闻获取成功:', news.length, '条');
    return news;
  } catch (e) {
    console.error('[news] 东方财富新闻获取失败:', e.message);
    return [];
  }
}

module.exports = { fetchCNBCNews, fetchEastMoneyNews };
