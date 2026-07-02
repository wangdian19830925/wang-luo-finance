# CloudBase 云函数架构设计文档

## 1. 概述

将当前 PWA 客户端实时获取的市场数据（股价、汇率、基金净值、宏观趋势）迁移到 CloudBase 云函数定时获取，写入云端数据库。PWA 打开时直接从云端读取预计算的数据和内容（净资产简报、每日新闻），不再依赖客户端实时拉取。

### 核心目标

| # | 目标 | 当前痛点 |
|---|------|----------|
| 1 | 定时获取股价、汇率、基金净值、宏观趋势数据 | 客户端 JSONP/fetch 获取，受 CORS 限制，file: 协议下无法在线获取 |
| 2 | 写入云端数据库 | 市场数据仅存 localStorage，不跨设备同步 |
| 3 | 云端生成"净资产简报"、"每日新闻" | 简报和新闻在客户端实时计算，依赖客户端数据拉取 |
| 4 | PWA 打开时直接同步 | 需等客户端逐个 API 拉取完才能渲染 |

## 2. 数据源与获取策略

### 2.1 股票价格

| 数据 | 当前客户端实现 | 云函数迁移 |
|------|---------------|-----------|
| A股实时价格 | `_tryFetchLivePrices()` → 腾讯财经 JSONP `qt.gtimg.cn` | HTTP fetch `qt.gtimg.cn/q=sStockList`（云函数无 CORS 限制） |
| 港股实时价格 | 同上（腾讯财经 JSONP，港股代码前缀 `r_HK`） | 同上 |
| 美股实时价格 | 同上（腾讯财经 JSONP，美股代码前缀 `m_US`） | 同上 |
| A股K线历史 | `_fetchEastMoneyHistory()` → 东方财富 API | HTTP fetch 东方财富 K线 API |
| 美股K线历史 | `_fetchEastMoneyHistory()` → 东方财富 API（6个月窗口） | 同上 |

**A股解析格式**（腾讯财经返回的字符串字段顺序）：
```
0: 名称, 1: 代码, 2: 当前价, 3: 昨收, 4: 今开, 5: 成交量, 6: 外盘, 7: 内盘, 8: 买一价, ...
```
提取 `fields[2]`（当前价）和 `fields[3]`（昨收）。

### 2.2 汇率

| 数据 | 当前客户端实现 | 云函数迁移 |
|------|---------------|-----------|
| 实时汇率 | `_fetchLiveFxRates()` → `open.er-api.com/v6/latest/USD` | HTTP fetch 同 URL |
| 历史汇率曲线 | `frankfurter.dev` (CORS friendly) | HTTP fetch `frankfurter.app/v1/2024-01-01..?from=USD&to=CNY,HKD,EUR` |

**提取字段**：`rates.CNY`（USDCNY）、`rates.HKD` → `CNY / rates.HKD`（HKDCNY）、`rates.EUR` → `CNY / rates.EUR`（EURCNY）

### 2.3 基金净值

| 数据 | 当前客户端实现 | 云函数迁移 |
|------|---------------|-----------|
| 最新净值+历史 | `_fetchFundPingzhongData()` → `fund.eastmoney.com/pingzhongdata/{code}.js` | HTTP fetch 同 URL，正则提取 `Data_netWorthTrend` 和 `fS_name` |
| 多基金批量 | `_fetchLiveFundPricesOnly()` → 逐个 pingzhongdata | 逐个 fetch，存入 DB |

**pingzhongdata JS 文件提取逻辑**（云函数中不能 eval，需正则）：
- `fS_name = "基金名称"` → 正则 `/fS_name\s*=\s*"([^"]+)"/`
- `Data_netWorthTrend = [{x:timestamp,y:nav},...]` → 正则 `/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/`
- 最新净值取 `Data_netWorthTrend` 最后一条的 `y` 值

### 2.4 宏观趋势

| 数据 | 当前客户端实现 | 云函数迁移 |
|------|---------------|-----------|
| CPI/LPR/利率等 | `./data/macro-trends.json`（静态包，手动更新） | 云函数从权威源 fetch 最新数据 |
| 每日新闻 | `_fetchMacroNews()` → CNBC RSS via `api.rss2json.com` | HTTP fetch CNBC RSS + 东方财富新闻 RSS |
| 汇率走势 | `frankfurter.dev` 30天历史 | 同上汇率历史 fetch |

**宏观数据权威源**（云函数可直连，无 CORS）：
- CPI: `data.stats.gov.cn` 或 IMF WEO API
- LPR/存款利率: `pbc.gov.cn`
- 10年国债: `yield.chinabond.com.cn`
- 沪深300: 东方财富指数 API
- 新闻: CNBC RSS + 东方财富 RSS

### 2.5 需要获取的基金代码列表

云函数需要知道哪些基金需要获取净值。方案：
- 从 `finance_data` 文档中提取所有基金的 `code` 字段
- 或使用固定列表 + DB 中动态列表

## 3. 云函数模块设计

### 3.1 函数列表

| 函数名 | 功能 | 触发方式 | 执行频率 |
|--------|------|----------|----------|
| `fetch-market-data` | 获取股价+汇率+基金净值 | 定时触发器 | 每交易日 9:15/9:30/10:00/11:30/13:00/14:30/15:00 (A股交易时段) |
| `fetch-macro-data` | 获取宏观趋势数据+新闻 | 定时触发器 | 每日 8:00 (开盘前) |
| `generate-briefing` | 生成净资产简报+每日新闻 | 定时触发器 | 每交易日 15:30 (收盘后) |
| `get-cloud-data` | PWA 获取云端市场数据 | 客户端 callFunction | 每次打开 PWA 时调用 |

### 3.2 fetch-market-data

**入口文件**: `cloudbase/functions/fetch-market-data/index.js`

**流程**:
```
1. 从 finance_data 文档中读取用户持仓的股票/基金代码列表
2. 逐个 fetch 腾讯财经 API 获取股价（A/H/US）
3. fetch open.er-api.com 获取汇率
4. 逐个 fetch pingzhongdata 获取基金净值+历史
5. 写入 market_prices 集合（固定 doc: latest_prices）
6. 写入 exchange_rates 集合（固定 doc: latest_rates）
7. 写入 fund_navs 集合（按 code 为 doc ID）
```

**定时触发器 config.json**:
```json
{
  "triggers": [
    {
      "name": "marketDataTrigger",
      "type": "timer",
      "config": "0 15,30 9 1-5 * 1-12 2026-2030"
    },
    {
      "name": "marketDataTrigger2",
      "type": "timer",
      "config": "0 0,30 10 1-5 * 1-12 2026-2030"
    },
    {
      "name": "marketDataTrigger3",
      "type": "timer",
      "config": "0 0,30 13-14 1-5 * 1-12 2026-2030"
    },
    {
      "name": "marketDataTrigger4",
      "type": "timer",
      "config": "0 0,30 15 1-5 * 1-12 2026-2030"
    }
  ]
}
```

### 3.3 fetch-macro-data

**入口文件**: `cloudbase/functions/fetch-macro-data/index.js`

**流程**:
```
1. fetch CNBC RSS → 提取财经新闻 top 10
2. fetch 东方财富新闻 RSS → 提取国内财经新闻
3. fetch frankfurter.dev → 获取30天汇率历史
4. 更新 macro_trends 集合（固定 doc: latest_macro）
   - 新增 dailyNews 字段（新闻列表）
   - 新增 fxHistory 字段（汇率走势数据）
   - 更新 exchangeRate.latest 字段
5. CPI/LPR/利率等静态数据仍由手动更新（权威源无公开 API）
```

**定时触发器 config.json**:
```json
{
  "triggers": [
    {
      "name": "macroDataTrigger",
      "type": "timer",
      "config": "0 0 8 * * MON-FRI 2026-2030"
    }
  ]
}
```

### 3.4 generate-briefing

**入口文件**: `cloudbase/functions/generate-briefing/index.js`

**流程**:
```
1. 从 market_prices 集合读取最新股价
2. 从 exchange_rates 集合读取最新汇率
3. 从 fund_navs 集合读取最新基金净值
4. 从 finance_data 文档读取用户持仓数据
5. 计算净资产变化：
   - 今日总资产 = Σ(股票市值) + Σ(基金市值) + 现金 + 公积金 + 其他资产
   - 昨日总资产 = 用昨收价/昨日净值推算
   - 日变化 = 今日 - 昨日
   - 日变化率 = 日变化 / 昨日总资产
6. 计算各资产类别变化（股票/基金/现金/公积金）
7. 生成"净资产简报"文本内容
8. 生成"每日新闻"摘要
9. 写入 daily_briefing 集合（doc ID 按日期: 2026-07-01）
```

**简报格式**:
```json
{
  "date": "2026-07-01",
  "summary": {
    "totalAssets": 1234567.89,
    "totalYesterday": 1230000.00,
    "dailyChange": 4567.89,
    "dailyChangeRate": 0.37,
    "breakdown": {
      "stocks": { "today": 500000, "yesterday": 498000, "change": 2000 },
      "funds": { "today": 200000, "yesterday": 198000, "change": 2000 },
      "cash": { "today": 50000, "yesterday": 50000, "change": 0 },
      "providentFund": { "today": 30000, "yesterday": 29800, "change": 200 },
      "other": { "today": 10000, "yesterday": 10000, "change": 0 }
    },
    "topMovers": [
      { "name": "蔚来", "change": 3.2, "changeRate": 5.1 },
      { "name": "沪深300ETF", "change": -0.5, "changeRate": -0.8 }
    ]
  },
  "newsSummary": [
    { "title": "...", "source": "CNBC", "link": "...", "summary": "..." },
    { "title": "...", "source": "东方财富", "link": "...", "summary": "..." }
  ],
  "generatedAt": "2026-07-01T15:30:00+08:00"
}
```

**定时触发器 config.json**:
```json
{
  "triggers": [
    {
      "name": "briefingTrigger",
      "type": "timer",
      "config": "0 30 15 * * MON-FRI 2026-2030"
    }
  ]
}
```

### 3.5 get-cloud-data（客户端调用）

**入口文件**: `cloudbase/functions/get-cloud-data/index.js`

**流程**:
```
1. 接收客户端参数：{ types: ['prices', 'rates', 'navs', 'macro', 'briefing'] }
2. 从对应集合读取数据
3. 返回合并的数据包
```

**客户端调用方式**:
```javascript
app.callFunction({
  name: 'get-cloud-data',
  data: { types: ['prices', 'rates', 'navs', 'macro', 'briefing'] }
}).then(res => {
  // res.result = { prices: {...}, rates: {...}, navs: {...}, macro: {...}, briefing: {...} }
  self._applyCloudMarketData(res.result);
});
```

## 4. 云端数据库 Schema

### 4.1 新增集合（market data）

| 集合名 | 文档结构 | 说明 |
|--------|----------|------|
| `market_prices` | doc `latest_prices`: `{ stocks: {code: {price, prevClose, change, changeRate, source, updatedAt}}, updatedAt }` | 最新股价 |
| `exchange_rates` | doc `latest_rates`: `{ rates: {USDCNY, HKDCNY, EURCNY}, source, updatedAt }` | 最新汇率 |
| `fund_navs` | doc `{code}`: `{ code, name, nav, source, history: [{x,y}], updatedAt }` | 基金净值+历史 |
| `macro_trends_cloud` | doc `latest_macro`: `{ news: [...], fxHistory: {...}, updatedAt }` | 宏观趋势云端补充 |
| `daily_briefing` | doc `{YYYY-MM-DD}`: `{ date, summary, newsSummary, generatedAt }` | 每日简报 |

### 4.2 权限配置

| 集合 | 读权限 | 写权限 |
|------|--------|--------|
| `market_prices` | 所有用户（包括匿名） | 仅云函数 |
| `exchange_rates` | 所有用户（包括匿名） | 仅云函数 |
| `fund_navs` | 所有用户（包括匿名） | 仅云函数 |
| `macro_trends_cloud` | 所有用户（包括匿名） | 仅云函数 |
| `daily_briefing` | 所有用户（包括匿名） | 仅云函数 |
| `finance_data`（已有） | 创建者可读写 | 创建者可读写 |

> **注意**: CloudBase 安全规则需在控制台配置。市场数据集合设置 `read: true, write: "cloudfunction"` 即可。

### 4.3 数据大小考虑

| 数据 | 预估大小 | CloudBase 单文档限制 |
|------|----------|---------------------|
| 股价（10-20只股票） | ~2KB | 无问题 |
| 汇率 | ~1KB | 无问题 |
| 基金净值（5-10只，含6个月历史） | ~50KB/只 | 需按基金代码拆分文档 |
| 宏观趋势+新闻 | ~10KB | 无问题 |
| 每日简报 | ~5KB | 无问题 |

> CloudBase 单文档最大 16MB，但单个基金完整历史可能较大（pingzhongdata 含数年数据），建议只保留6个月历史。

## 5. PWA 客户端改造

### 5.1 新增同步流程

**当前流程（v209）**:
```
PWA 打开 → initCloud → anonymousLogin → syncWithCloud(业务数据)
           → _tryFetchLivePrices(JSONP)
           → _fetchLiveFxRates(fetch)
           → _fetchLiveFundPricesOnly(JSONP)
           → fetchMacroTrendsData(静态包)
```

**改造后流程（v210+）**:
```
PWA 打开 → initCloud → anonymousLogin → syncWithCloud(业务数据)
           → callFunction('get-cloud-data') → _applyCloudMarketData
           → (fallback: 客户端直接读 DB 集合)
           → 客户端 fetch 仅作离线兜底（DB 无数据时）
```

### 5.2 storage.js 新增方法

```javascript
// 从云端获取市场数据
async fetchCloudMarketData() {
  if (!this.cloudSyncEnabled || !this.cloudApp) return null;
  try {
    const result = await this.cloudApp.callFunction({
      name: 'get-cloud-data',
      data: { types: ['prices', 'rates', 'navs', 'macro', 'briefing'] }
    });
    if (result && result.result) {
      return result.result;
    }
    return null;
  } catch (e) {
    console.warn('[CloudBase] 获取云端市场数据失败:', e);
    return null;
  }
},

// 或直接从数据库读取（不经过云函数）
async fetchMarketDataFromDB() {
  if (!this.cloudSyncEnabled || !this.cloudDb) return null;
  const data = {};
  try {
    // 读取股价
    const pricesDoc = await this.cloudDb.collection('market_prices').doc('latest_prices').get();
    if (pricesDoc.data) data.prices = pricesDoc.data;
  } catch(e) {}
  try {
    // 读取汇率
    const ratesDoc = await this.cloudDb.collection('exchange_rates').doc('latest_rates').get();
    if (ratesDoc.data) data.rates = ratesDoc.data;
  } catch(e) {}
  // ... 类似读取基金净值、宏观趋势、简报
  return data;
}
```

### 5.3 app.js 改造点

| 方法 | 改造内容 |
|------|----------|
| `_tryFetchLivePrices()` | 优先从云端数据读取股价，失败时才 JSONP 获取 |
| `_fetchLiveFxRates()` | 优先从云端数据读取汇率，失败时才 fetch |
| `_fetchLiveFundPricesOnly()` | 优先从云端数据读取基金净值 |
| `fetchMacroTrendsData()` | 优先从云端读取 macro_trends_cloud + 简报 |
| 新增 `_applyCloudMarketData()` | 将云端数据包应用到本地 |
| 新增 `_renderDailyBriefing()` | 渲染净资产简报卡片 |
| 新增 `_renderDailyNews()` | 渲染每日新闻卡片（替代当前客户端实时拉取） |

### 5.4 简报渲染设计

**净资产简报卡片**（显示在资产总览顶部）:
```
┌──────────────────────────────────────┐
│ 📊 净资产日报 · 2026-07-01           │
│                                      │
│ 总资产: ¥1,234,567    ↑ ¥4,567 (0.37%)│
│ ┌──────┬──────┬──────┬──────┬──────┐│
│ │股票  │基金  │现金  │公积金│其他  ││
│ │500K↑ │200K↑ │50K→  │30K↑  │10K→  ││
│ └──────┴──────┴──────┴──────┴──────┘│
│                                      │
│ 📰 每日财经                           │
│ • 美联储暗示年内可能再加息...          │
│ • 沪深300指数收涨0.5%...              │
│ • 更多 →                             │
└──────────────────────────────────────┘
```

## 6. 云函数代码结构

### 6.1 目录结构

```
cloudbase/
├── cloudbaserc.json          # CLI 部署配置
└── functions/
    ├── fetch-market-data/
    │   ├── index.js          # 主入口
    │   ├── package.json      # 依赖（@cloudbase/node-sdk, axios）
    │   ├── config.json       # 定时触发器配置
    │   └── lib/
    │       ├── stock.js      # 股价获取逻辑
    │       ├── fx.js         # 汇率获取逻辑
    │       ├── fund.js       # 基金净值获取逻辑
    │       └── db.js         # 数据库写入逻辑
    ├── fetch-macro-data/
    │   ├── index.js
    │   ├── package.json
    │   ├── config.json
    │   └── lib/
    │       ├── news.js       # 新闻获取逻辑
    │       ├── fx-history.js # 汇率历史获取
    │       └── db.js
    ├── generate-briefing/
    │   ├── index.js
    │   ├── package.json
    │   ├── config.json
    │   └── lib/
    │       ├── calculator.js # 净资产计算
    │       ├── formatter.js  # 简报格式化
    │       └── db.js
    └── get-cloud-data/
    │   ├── index.js
    │   ├── package.json
    │   └── lib/
    │       └ db.js          # 数据库读取逻辑
    └── shared/
        ├── constants.js     # 共享常量（env, 集合名等）
        └── utils.js         # 共享工具函数
```

### 6.2 cloudbaserc.json

```json
{
  "envId": "wang-luo-finance-d6enmg07a198e20",
  "functionRoot": "./functions",
  "functions": [
    {
      "name": "fetch-market-data",
      "timeout": 60,
      "envVariables": {},
      "runtime": "Nodejs18.15",
      "triggers": [
        {
          "name": "marketDataTrigger",
          "type": "timer",
          "config": "0 15,30 9 * * MON-FRI *"
        },
        {
          "name": "marketDataTrigger2",
          "type": "timer",
          "config": "0 0,30 10 * * MON-FRI *"
        },
        {
          "name": "marketDataTrigger3",
          "type": "timer",
          "config": "0 0,30 13-14 * * MON-FRI *"
        },
        {
          "name": "marketDataTrigger4",
          "type": "timer",
          "config": "0 0,30 15 * * MON-FRI *"
        }
      ]
    },
    {
      "name": "fetch-macro-data",
      "timeout": 30,
      "runtime": "Nodejs18.15",
      "triggers": [
        {
          "name": "macroDataTrigger",
          "type": "timer",
          "config": "0 0 8 * * MON-FRI *"
        }
      ]
    },
    {
      "name": "generate-briefing",
      "timeout": 30,
      "runtime": "Nodejs18.15",
      "triggers": [
        {
          "name": "briefingTrigger",
          "type": "timer",
          "config": "0 30 15 * * MON-FRI *"
        }
      ]
    },
    {
      "name": "get-cloud-data",
      "timeout": 10,
      "runtime": "Nodejs18.15"
    }
  ]
}
```

## 7. 部署方案

### 7.1 部署步骤

```bash
# 1. 安装 CLI
npm i -g @cloudbase/cli

# 2. 登录
tcb login

# 3. 部署云函数
cd cloudbase
tcb fn deploy fetch-market-data -e wang-luo-finance-d6enmg07a198e20
tcb fn deploy fetch-macro-data -e wang-luo-finance-d6enmg07a198e20
tcb fn deploy generate-briefing -e wang-luo-finance-d6enmg07a198e20
tcb fn deploy get-cloud-data -e wang-luo-finance-d6enmg07a198e20

# 4. 配置数据库权限（在 CloudBase 控制台操作）
# market_prices / exchange_rates / fund_navs / macro_trends_cloud / daily_briefing
# 设置: read=true, write=cloudfunction
```

### 7.2 权限配置（CloudBase 控制台）

需要在 CloudBase 控制台为每个新集合配置安全规则：

```json
{
  "read": true,
  "write": "auth.openId == 'cloudfunction'"
}
```

> 实际配置可能需要使用 CloudBase 安全规则 DSL，具体格式需在控制台确认。

## 8. 风险与注意事项

### 8.1 腾讯财经 JSONP 在云函数中

腾讯财经 API 返回的是 JSONP 格式（`v_sStockList=...`），不是标准 JSON。云函数中需要：
- 直接 HTTP fetch 返回的字符串
- 用正则或字符串解析提取价格数据
- 不依赖浏览器 JSONP callback

### 8.2 pingzhongdata JS 文件在云函数中

pingzhongdata 返回的是 JS 文件（包含全局变量赋值），不是 JSON。云函数中：
- HTTP fetch 获取完整 JS 文本
- 用正则提取 `fS_name` 和 `Data_netWorthTrend`（不能用 eval）
- 正则模式：`/fS_name\s*=\s*"([^"]+)"/` 和 `/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/`

### 8.3 基金代码列表动态获取

云函数需要知道要获取哪些基金的净值。方案：
1. 从 `finance_data` 文档的 `funds` 字段中提取所有 code
2. 添加一个 `config` 集合存储基金代码列表（云函数+客户端均可写入）
3. 在云函数中硬编码初始列表 + 从 DB 动态补充

**推荐方案**: 从 `finance_data` 文档读取基金列表。但注意匿名登录下有多个文档（每个匿名用户一个），需要遍历所有 `finance_data` 文档。

### 8.4 净资产简报的 per-user 问题

- 匿名登录下每个设备有独立身份和 `finance_data` 文档
- `generate-briefing` 需要为每个有 `finance_data` 的用户生成简报
- 简报 doc ID = `briefing_{用户docId}_{日期}`
- 客户端读取简报时按自己的 docId 查询

### 8.5 CloudBase 免费额度

| 资源 | 免费额度 | 预估用量 |
|------|----------|----------|
| 云函数调用 | 4万次/月 | ~200次/月（4函数 × ~50触发/月） |
| 云函数执行时间 | 4万GBs/月 | 远低于限制 |
| 数据库读 | 5万次/月 | 客户端每次打开读5-6个集合 |
| 数据库写 | 3万次/月 | 云函数写入远低于限制 |

> **当前用量预估在免费额度内**，无需付费。

## 9. 实现优先级

| 阶段 | 任务 | 优先级 |
|------|------|--------|
| Phase 1 | fetch-market-data + 云端DB + PWA读取 | **最高** |
| Phase 2 | fetch-macro-data + 新闻 | 中 |
| Phase 3 | generate-briefing + 简报渲染 | 中 |
| Phase 4 | get-cloud-data (callFunction) | 低（可先用直读DB） |

> Phase 1 即可实现核心需求：PWA 打开时从云端读取股价/汇率/基金净值，不再依赖客户端 JSONP。
