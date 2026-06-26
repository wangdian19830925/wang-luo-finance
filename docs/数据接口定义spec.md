# 家庭资产管理工具 — 数据接口定义 Spec

> 版本：v56 | 更新：2026-06-25
> 协议：时间戳采用 ISO 8601（UTC+8 实际使用）

---

## 目录

1. [外部 API（在线获取）](#1-外部-api)
2. [内部 JS 模块接口](#2-内部-js-模块接口)
3. [localStorage 键值规范](#3-localstorage-键值规范)
4. [文件接口（静态资源）](#4-文件接口)
5. [模块间数据流](#5-模块间数据流)

---

## 1. 外部 API

### 1.1 股票实时价格

#### 腾讯财经 API（主用）

```
GET https://qt.gtimg.cn/q={codes}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `codes` | string | 逗号分隔，如 `hk00992,usNIO` |

**响应**：通过 `<script>` 注入全局变量 `v_hk00992`、`v_usNIO` 等，字段以 `~` 分隔。

#### 股票 K 线历史

```
GET https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={tc},day,{start},{end},120,qfq
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `tc` | string | `hk00992`、`us.nio`、`sh600519` 等 |
| `start` | YYYY-MM-DD | 起始日期 |
| `end` | YYYY-MM-DD | 结束日期 |

**响应示例**：

```json
{
  "code": 0,
  "data": {
    "hk00992": {
      "qfqday": [
        ["2025-12-24", "4.02", "4.15", "4.20", "3.98", "1234567"]
      ]
    }
  }
}
```

字段顺序：`[日期, 开盘, 收盘, 最高, 最低, 成交量]`

---

### 1.2 基金实时净值

#### 天天基金 API

```
GET https://fundgz.1234567.com.cn/js/{code}.js
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `code` | string | 基金代码，如 `013126` |

**响应**：JSONP 回调 `window.jsonpgz({ ... })`

```json
{
  "fundcode": "013126",
  "name": "华夏食品饮料ETF联接C",
  "jzrq": "2026-06-24",
  "dwjz": "1.2345",
  "gzrq": "2026-06-25",
  "gsz": "1.2350"
}
```

字段说明：
- `jzrq`：净值日期
- `dwjz`：单位净值
- `gzrq`：估算日期
- `gsz`：估算净值

---

### 1.3 实时汇率

```
GET https://open.er-api.com/v6/latest/USD
```

**响应**：

```json
{
  "rates": {
    "CNY": 7.2345,
    "HKD": 7.8234
  }
}
```

**处理方式**：
- `USDCNY = rates.CNY`
- `HKDCNY = rates.CNY / rates.HKD`

缓存：localStorage `fm_exchange_rates`，TTL 1 小时。

---

## 2. 内部 JS 模块接口

### 2.1 Storage 模块（`js/storage.js`）

#### CRUD 接口

| 方法 | 签名 | 说明 |
|------|------|------|
| `get` | `(key: string) => any[] \| object` | 读取 localStorage，失败返回 `[]` |
| `set` | `(key: string, data: any) => boolean` | 写入 localStorage |
| `add` | `(key: string, item: object) => object` | 新增一条记录，自动生成 id/createdAt |
| `update` | `(key: string, id: string, updates: object) => object \| null` | 更新记录 |
| `delete` | `(key: string, id: string) => boolean` | 删除记录 |

#### 快捷读取接口

| 方法 | 说明 |
|------|------|
| `getIncome()` | 收入记录 |
| `getExpense()` | 支出记录 |
| `getAssets()` | 资产预留 |
| `getInsurance()` | 保单 |
| `getStocks()` | 股票持仓 |
| `getRsu()` | RSU 授予 |
| `getFunds()` | 基金持仓 |
| `getLoans()` | 房贷 |
| `getAnnuities()` | 企业年金 |

#### 计算接口

| 方法 | 说明 |
|------|------|
| `calcTotalAssets()` | 总资产（CNY） |
| `calcTotalDebts()` | 总负债（CNY） |
| `calcNetWorth()` | 净资产 |
| `calcCashTotal()` | 现金账户总余额 |
| `calcInsuranceSettledValue()` | 保险沉淀资产 |
| `calcInsuranceContingentAsset()` | 保险或有资产（重疾给付） |
| `calcInsuranceContingentLiability()` | 保险或有负债（未来保费） |
| `getInsuranceReminders()` | 30 天内到期提醒 |
| `getRecentRecords()` | 最近 10 条记录 |

### 2.2 App 模块（`js/app.js`）

| 方法 | 说明 |
|------|------|
| `init()` | 初始化应用 |
| `navigateTo(page)` | 路由切换 |
| `loadDashboard()` | 渲染资产总览 |
| `refreshAllData()` | 刷新所有在线数据 |
| `saveStock()` / `saveFund()` / `saveInsurance()` / `saveLoan()` | 保存表单数据 |
| `setupCSVImport()` | 账单 CSV 导入 |
| `downloadCalendar()` | 导出 .ics 日历 |
| `showToast()` | 提示条 |

### 2.3 Parser 模块（`js/parser.js`）

| 方法 | 说明 |
|------|------|
| `parse(text)` | 解析通知文本，返回 `{ type, amount, source, method, date, confidence }` |

---

## 3. localStorage 键值规范

| Key | 值类型 | 说明 |
|------|--------|------|
| `fm_income` | `Income[]` | 收入记录 |
| `fm_expense` | `Expense[]` | 支出记录 |
| `fm_cash_accounts` | `CashAccount[]` | 现金账户 |
| `fm_assets` | `Asset[]` | 预留资产 |
| `fm_insurance` | `Insurance[]` | 保单 |
| `fm_stocks` | `StockHolding[]` | 股票持仓 |
| `fm_rsu` | `RSUGrant[]` | RSU 授予 |
| `fm_funds` | `FundHolding[]` | 基金持仓 |
| `fm_loans` | `Loan[]` | 房贷 |
| `fm_annuities` | `Annuity[]` | 企业年金 |
| `fm_notifications` | `Notification[]` | 通知记录 |
| `fm_exchange_rates` | `FxRates` | 汇率缓存 |
| `fm_stock_price_last_refresh` | string | 股价刷新时间戳 |
| `fm_stock_price_{code}` | `PriceCache` | 单只股票价格缓存 |
| `fm_stock_hist_{code}` | `HistoryCache` | 单只股票历史 K 线缓存（当前已禁用持久化） |
| `fm_insurance_imported` | string | 保险导入标记 |
| `fm_stock_imported` | string | 股票导入标记 |
| `fm_rsu_imported` | string | RSU 导入标记 |
| `fm_fund_imported` | string | 基金导入标记 |
| `fm_loan_imported` | string | 房贷导入标记 |
| `fm_annuity_imported` | string | 年金导入标记 |

---

## 4. 文件接口（静态资源）

| 文件 | 类型 | 说明 |
|------|------|------|
| `data/stock-prices.json` | JSON | 实时股价 + 汇率 + 基金净值（Python 脚本生成） |
| `data/stock-history.json` | JSON | 6 个月历史 K 线（中间产物） |
| `js/history-data.js` | JS | 内联历史 K 线全局变量（`window.STOCK_HISTORY_DATA`） |
| `js/insurance-data.js` | JS | 预设保单数据（`INSURANCE_POLICIES`） |
| `js/stock-data.js` | JS | 预设股票数据（`STOCK_HOLDINGS`, `STOCK_CASH`） |
| `js/rsu-data.js` | JS | 预设 RSU 数据（`RSU_GRANTS`） |
| `js/fund-data.js` | JS | 预设基金数据（`FUND_HOLDINGS`） |
| `js/loan-data.js` | JS | 预设房贷数据（`LOAN_HOLDINGS`） |
| `js/annuity-data.js` | JS | 预设年金数据（`ANNUITY_HOLDINGS`） |
| `家庭资产管理-缴费还款日历.ics` | ICS | 生成的日历文件 |

---

## 5. 模块间数据流

### 5.1 初始化流程

```
JS 数据文件 (insurance-data.js / stock-data.js 等)
    ↓
App.init() → checkXxxImportStatus()
    ↓
Storage.add() / Storage.set()
    ↓
localStorage
```

### 5.2 股价更新流程

```
data/stock-prices.json (fetch) → _loadPricesFromJson()
    ↓
_tryFetchLivePrices() → 腾讯 API / 天天基金 API
    ↓
_fetchLiveFxRates() → open.er-api.com
    ↓
Storage.update() → localStorage
    ↓
loadDashboard() 重新渲染
```

### 5.3 资产曲线流程

```
data/stock-history.json (fetch) / window.STOCK_HISTORY_DATA
    ↓
_loadAllHistoryData()
    ↓
_appendTodayIfMissing()
    ↓
_estimateAssetsAt() / _estimateDebtsAt()
    ↓
_drawAssetTrendChart()
```
