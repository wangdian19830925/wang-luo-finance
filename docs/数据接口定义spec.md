# 家庭资产管理工具 — 数据接口定义 Spec

> 版本：v32 baseline | 更新：2026-06-24
> 协议：所有时间戳用 ISO 8601（UTC+8 显式标出）

---

## 目录

1. [外部 API（在线获取）](#1-外部-api)
2. [内部 JS 模块接口](#2-内部-js-模块接口)
3. [localStorage 键值规范](#3-localstorage-键值规范)
4. [文件接口（静态资源）](#4-文件接口)

---

## 1. 外部 API

### 1.1 股票实时价格

#### 腾讯财经 API（主用）

```
GET https://web.ifzq.gtimg.cn/appstock/app/fqkline/get
  ?param={tc},day,{start},{end},120,qfq
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `tc` | string | 腾讯股票代码，如 `hk00992`（港股前缀 `hk`），`us.nio`（美股前缀 `us.`） |
| `start` | YYYY-MM-DD | 起始日期 |
| `end` | YYYY-MM-DD | 结束日期 |
| `120` | int | 最�¡�120 个交易日 |
| `qfq` | string | 前复权 |

**响应示例**：
```json
{
  "code": 0,
  "data": {
    "hk00992": {
      "qfqday": [
        ["2025-12-24", "4.02", "4.15", "4.20", "3.98", "1234567"],
        ["2025-12-25", "4.15", "4.22", "4.30", "4.10", "2345678"]
      ]
    }
  }
}
```

**字段顺序**：`[日期, 开盘, 收盘, 最高, 最低, 成交量]`

**CORS**：支持跨域。

---

#### 新浪财经 API（备用）

```
GET https://hq.sinajs.cn/list={tc}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `tc` | string | `hk00992`, `gb_nio` |

**响应**：JSONP，`window.jsonpgz` 回调。

---

### 1.2 基金净值

#### 天天基金网 API

```
GET https://fundgz.1234567.com.cn/js/{code}.js
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `code` | string | 基金代码，如 `013126` |

**响应**：JSONP，`window.jsonpgz` 回调。

```json
{
  "fundcode": "013126",
  "name": "华夏食品饮料ETF发起联接C",
  "jzrzl": "+1.23%",
  "gsz": "0.5321",
  "gszzl": "+0.85%",
  "gztime": "2026-06-24 15:00"
}
```

**字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `fundcode` | string | 基金代码 |
| `name` | string | 基金名称 |
| `jzrzl` | string | 日涨�·率（含百分号） |
| `gsz` | string | 估算净值 |
| `gszzl` | string | 估算涨�·率 |
| `gztime` | string | 估值时间 |

---

### 1.3 汇率

#### 免费 API（兼容 CORS）

```
GET https://api.exchangerate-api.com/v4/latest/USD
```

**响应**：
```json
{
  "base": "USD",
  "rates": { "CNY": 7.2, "HKD": 7.8 }
}
```

**备选**：`https://open.er-api.com/v6/latest/USD`

---

## 2. 内部 JS 模块接口

### 2.1 `Storage` 模块

```javascript
const Storage = {
  // 键值常量
  keys: {
    income: 'fm_income',       // 收入记录
    expense: 'fm_expense',     // 支出记录
    assets: 'fm_assets',       // 资产（预留）
    insurance: 'fm_insurance',  // 保单
    stocks: 'fm_stocks',       // 股票持仓
    rsu: 'fm_rsu',            // RSU 授予
    funds: 'fm_funds',         // 基金持仓
    loans: 'fm_loans',         // 房贷
    annuities: 'fm_annuities',// 企业年金
    notifications: 'fm_notifications' // 提醒（预留）
  },

  // CRUD
  get(key: string): any[],
  set(key: string, data: any[]): bolian,
  add(key: string, item: object): object,    // 自动生成 id/createdAt
  update(key: string, id: string, updates: object): object | null,
  delete(key: string, id: string): bolian,

  // 计算
  calcTotalAssets(): number,       // 总资产（CNY）
  calcTotalDebts(): number,       // 总负债（CNY）
  calcNetWorth(): number,         // 净资产
  calcRsuVestedValue(): number,   // RSU 已解禁价值
  calcRsuLockedValue(): number,   // RSU 未解禁价值（最大可能收益）
  calcTotalAnnuities(): number,   // 年金总额
  calcInsuranceSettledValue(): number,   // 保险沉淀资产（累计已缴）
  calcInsuranceSettledValueAt(date: Date|string): number, // 历史时点沉淀
  calcInsuranceContingentAsset(): number,  // 或有资产（重疾给付）
  calcInsuranceContingentLiability(): number, // 或有负债（未来保费承诺）

  // 提醒
  getInsuranceReminders(daysAhead=30): array,

  // 最近记录
  getRecentRecords(limit=10): array
};
```

---

### 2.2 `App` 模块（主逻辑）

```javascript
const App = {
  // 初始化
  init(): void,
  setupNavigation(): void,
  setupForms(): void,
  setupParser(): void,
  setupInlineEditDelegation(): void,

  // 刷新
  refreshAll(): void,
  fetchStockPrices(): void,
  _loadPricesFromJson(callback: function): void,
  _fetchLiveFxRates(): void,

  // 渲染
  renderDashboard(): void,
  renderStockTrend(): void,
  renderFundTrend(): void,
  renderStockCharts(): void,

  // 保险
  renderInsuranceList(): void,
  importInsuranceFromExcel(data: array): number,

  // 股价历史
  fetchStockHistoryData(code: string, market: string, callback: function): void,
  _getInlineHistory(code: string): array | null,

  // 显示
  showToast(msg: string, duration=2000): void,
  showLoading(msg: string): void,
  hideLoading(): void
};
```

---

### 2.3 `Parser` 模块（通知解析）

```javascript
const Parser = {
  parse(text: string): { success: bolian, data: object, error: string },

  // 内部
  _isIncome(content: string): bolian,
  _isExpense(content: string): bolian,
  _isTransfer(content: string): bolian,
  _parseIncome(content: string): object,
  _parseExpense(content: string): object,
  _calcConfidence(result: object): number
};
```

**输出 `data` 结构**：

```javascript
{
  type: 'income' | 'expense' | 'transfer' | 'unknown',
  amount: number,
  date: string,        // YYYY-MM-DD
  incomeType: string,   // salary | bonus | investment | rent | other
  category: string,     // food | shopping | housing | transport | ...
  method: string,       // alipay | wechat | bankcard | credit
  source: string,       // 商家/来源
  note: string,
  confidence: number    // 0-100
}
```

---

### 2.4 `StockApi`（股价获取，app.js 内部类）

```javascript
// 在 app.js 中以 this 上下文调用
_fetchStockPriceFromSina(code: string, market: string, callback: function): void
// callback(err, { price, currency, name, source })

// 腾讯 API 获取历史
fetchStockHistoryData(code: string, market: string, callback: function): void
// callback(data: [{ date, open, close, high, low, volume }] | null)
```

---

## 3. localStorage 键值规范

| Key | 值类型 | 说明 | 示例 |
|-----|--------|------|------|
| `fm_income` | `object[]` | 收入记录 | `[{ id, amount, date, incomeType, method, source, note, createdAt }]` |
| `fm_expense` | `object[]` | 支出记录 | `[{ id, amount, date, category, method, source, note, createdAt }]` |
| `fm_assets` | `object[]` | 资产（预留） | `[]` |
| `fm_insurance` | `object[]` | 保单 | `[{ id, contractNo, company, product, person, premium, freq, payPeriod, nextPayDate, expireDate, ... }]` |
| `fm_stocks` | `object[]` | 股票持仓 | `[{ id, code, name, shares, cost, currentPrice, currency, market, broker, accountNo }]` |
| `fm_rsu` | `object[]` | RSU 授予 | `[{ id, code, name, totalShares, perYearShares, grantPrice, currentPrice, grantDate, vestingYears, vesting, longCash, ... }]` |
| `fm_funds` | `object[]` | 基金持仓 | `[{ id, code, name, holdValue, costValue, nav, shares, market, currency }]` |
| `fm_loans` | `object[]` | 房贷 | `[{ id, bank, property, total, paid, balance, rate, rateType, term, startDate, endDate, ... }]` |
| `fm_annuities` | `object[]` | 企业年金 | `[{ id, code, name, planName, manager, balance, category, risk, lastUpdate }]` |
| `fm_notifications` | `object[]` | 提醒（预留） | `[]` |
| `fm_exchange_rates` | `object` | 汇率 | `{"USDCNY": 7.2, "HKDCNY": 0.92, "_updated": "2026-06-24T08:00:00.000Z"}` |
| `fm_stock_price_{code}` | `object` | 单只股票价格缓存 | `{"price": 22.18, "currency": "HKD", "name": "LENOVO GROUP", "source": "sina", "_cachedAt": 1719216000000}` |

**缓存 TTL**：股票价格缓存 30 分钟（`_cachedAt` 判断）。

---

## 4. 文件接口

### 4.1 `data/stock-prices.json`（自动生成）

```json
{
  "fetchTime": "2026-06-24 08:42:13",
  "stocks": {
    "00992": { "price": 22.18, "currency": "HKD", "name": "LENOVO GROUP", "source": "sina" },
    "NIO": { "price": 5.09, "currency": "USD", "name": "蔚来", "source": "sina" },
    "689009": { "price": 33.01, "currency": "CNY", "name": "九号公司", "source": "sina" }
  },
  "funds": {
    "013126": { "nav": 0.5321, "estNav": 0.5252, "name": "华夏食品饮料ETF联接C", "navDate": "2026-06-22", "estTime": "2026-06-23 15:00", "source": "tiantian" }
  },
  "fxRates": { "USDCNY": 7.2, "HKDCNY": 0.92 }
}
```

**生成脚本**：`scripts/fetch_stock_prices.py`

---

### 4.2 `js/history-data.js`（自动生成）

```javascript
// Auto-generated from data/stock-history.json by scripts/update_history.py
// DO NOT EDIT MANUALLY.
window.STOCK_HISTORY_DATA = {
  "NIO": [
    { "date": "2025-12-24", "open": 7.4, "close": 7.42, "high": 7.44, "low": 7.37 },
    ...
  ],
  "00992": [ ... ],
  "515170": [ ... ]
};
```

**生成脚本**：`scripts/update_history.py`

---

### 4.3 `data/stock-history.json`（中间产物）

同 `js/history-data.js` 的 JSON 格式，用于脚本间数据交换。

---

## 5. 错误码规范（待实现）

| 码 | 含义 | 处理 |
|-----|------|------|
| `E_API_TIMEOUT` | 外部 API 超时（>10s） | 回退到缓存/内联数据 |
| `E_API_NO_DATA` | API 返回空数据 | 回退到缓存/内联数据 |
| `E_PARSE_FAIL` | 解析通知失败 | 提示用户手动输入 |
| `E_STORAGE_FULL` | localStorage 满（>5MB） | 提示用户导出数据 |
| `E_NETWORK` | 网络不可用 | PWA 离线提示 |

---

## 6. 安全规范

1. **API Key**：无（所有外部 API 为免费公开接口，无需 Key）
2. **敏感数据**：保单号、银行账号存储在 localStorage，**不**上传云端
3. **CSP**：`netlify.toml` 已配置 `script-src 'self' 'unsafe-inline' *.sina.com.cn *.gtimg.cn`
4. **CORS**：静态 JSON 文件需通过 HTTP 访问（不能用 `file://`），v32 改为内联 JS 解决。
