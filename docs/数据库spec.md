# 家庭资产管理工具 — 数据库 Spec

> 版本：v56 | 更新：2026-06-25
> 当前架构：纯前端 PWA，数据存 `localStorage`（无后端数据库）
> 本文档定义：① 当前 localStorage 数据结构 ② 未来若引入后端 DB 的 Schema 设计

---

## 目录

1. [当前架构：localStorage 数据规范](#1-当前架构-localstorage-数据规范)
2. [未来架构：后端数据库 Schema 设计](#2-未来架构后端数据库-schema-设计)
3. [数据迁移方案](#3-数据迁移方案)

---

## 1. 当前架构：localStorage 数据规范

### 1.1 存储键值总览

| Key | 值类型 | 大小估算 | 说明 |
|-----|--------|----------|------|
| `fm_income` | `Income[]` | <10KB | 收入记录 |
| `fm_expense` | `Expense[]` | <10KB | 支出记录 |
| `fm_cash_accounts` | `CashAccount[]` | <2KB | 现金账户（v56 新增） |
| `fm_assets` | `Asset[]` | <1KB | 资产（预留） |
| `fm_insurance` | `Insurance[]` | <20KB | 保单（16 条） |
| `fm_stocks` | `StockHolding[]` | <5KB | 股票持仓 |
| `fm_rsu` | `RSUGrant[]` | <5KB | RSU 授予 |
| `fm_funds` | `FundHolding[]` | <5KB | 基金持仓 |
| `fm_loans` | `Loan[]` | <5KB | 房贷 |
| `fm_annuities` | `Annuity[]` | <5KB | 企业年金 |
| `fm_notifications` | `Notification[]` | <1KB | 通知记录 |
| `fm_exchange_rates` | `FxRates` | <1KB | 汇率缓存 |
| `fm_stock_price_last_refresh` | string | <1KB | 股价刷新时间戳 |
| `fm_stock_price_{code}` | `PriceCache` | <1KB/只 | 单只股票价格缓存 |
| `fm_stock_hist_{code}` | `HistoryCache` | <5KB/只 | 单只股票历史 K 线缓存（已禁用持久化） |
| `fm_*_imported` | string | <1KB | 各模块数据导入标记 |

**总大小**：<80KB，远低于 localStorage 5MB 限制。

---

### 1.2 数据结构详细定义

#### `CashAccount`（现金账户）

```typescript
interface CashAccount {
  id: string;           // 如 "cmb_8150", "yuebao"
  name: string;         // 如 "招商银行", "余额宝"
  icon: string;         // "bank" | "yuebao" | "alipay" | "wechat"
  label: string;        // 显示名称
  balance: number;      // 当前余额（CNY）
  updated: string;      // 更新日期 YYYY-MM-DD
  note: string;         // 备注
}
```

#### `Income`（收入记录）

```typescript
interface Income {
  id: string;
  amount: number;        // 金额（CNY）
  date: string;          // YYYY-MM-DD
  incomeType: string;    // salary | bonus | investment | rent | other
  source: string;        // 来源
  method: string;        // alipay | wechat | bankcard
  note: string;
  createdAt: string;     // ISO 8601
}
```

#### `Expense`（支出记录）

```typescript
interface Expense {
  id: string;
  amount: number;        // 金额（CNY）
  date: string;          // YYYY-MM-DD
  category: string;      // food | shopping | housing | transport | education | medical | entertainment | other
  method: string;        // alipay | wechat | bankcard
  note: string;
  csvSource?: string;    // CSV 导入来源
  createdAt: string;     // ISO 8601
}
```

#### `Insurance`（保单）

```typescript
interface Insurance {
  id: string;
  contractNo: string;            // 合同号
  company: string;               // 保险公司
  product: string;               // 产品名
  person: string;                // 被保险人
  premium: number;               // 年保费（CNY）
  freq: string;                  // yearly | monthly | quarterly
  payPeriod: string;             // 缴费区间 "2023-2032 · 10年"
  baseNextPayDate: string|null;  // Excel 原始扣款日
  nextPayDate: string|null;      // 当前实际下次缴费日
  expireDate: string|null;       // 到期日或"终身"
  collectNote: string;           // 领取说明
  collectDate?: string;          // 一次性领取日期
  collectAmount?: number;        // 领取金额
  collectStart?: number;         // 领取起始年
  collectEnd?: number;           // 领取结束年
  collectFreq?: string;          // 领取频率
  account?: string;              // 扣款账号
  createdAt: string;             // ISO 8601
}
```

#### `StockHolding`（股票持仓）

```typescript
interface StockHolding {
  id: string;
  code: string;         // "00992" | "NIO" | "689009"
  name: string;
  shares: number;       // 持股数
  cost: number;         // 成本价（原币种）
  currentPrice: number; // 当前价（原币种）
  currency: string;     // "CNY" | "HKD" | "USD"
  market: string;       // "CN" | "HK" | "US"
  broker: string;       // 券商
  accountNo: string;    // 资金账号
  createdAt: string;
}
```

#### `RSUGrant`（RSU 授予）

```typescript
interface RSUGrant {
  id: string;
  code: string;              // "689009"
  name: string;
  totalShares: number;       // 授予总股数
  perYearShares: number;     // 每年归属股数
  grantPrice: number;        // 授予价
  fairPrice: number;         // 公允价
  currentPrice: number;      // 当前市价
  grantDate: string;         // 授予日
  vestingYears: number;      // 归属年数
  vesting: {date: string, shares: number}[];
  vested: number;            // 已解禁股数
  locked: number;            // 锁定中股数
  longCash: {total: number, perYear: number} | null;
  currency: string;
  market: string;
  plan: string;
  grantor: string;
  createdAt: string;
}
```

#### `FundHolding`（基金持仓）

```typescript
interface FundHolding {
  id: string;
  code: string;         // "013126"
  name: string;
  holdValue: number;    // 持仓金额（当前市值）
  costValue: number;    // 投入本金
  nav: number;          // 最新净值
  shares: number;       // 持有份额
  market: string;       // "CN"
  currency: string;     // "CNY"
  parentCode?: string;  // 母基金代码
  createdAt: string;
}
```

#### `Loan`（房贷）

```typescript
interface Loan {
  id: string;
  bank: string;              // 银行
  property: string;          // 贷款用途
  total: number;             // 贷款总额
  paid: number;              // 已还本金
  balance: number;           // 剩余本金
  rate: number;              // 年利率（%）
  rateType: string;          // 利率类型
  term: number;              // 年限
  months: number;            // 总月数
  startDate: string;         // 放款日
  endDate: string;           // 到期日
  payCycle: string;          // "month"
  loanType: string;          // "公积金" | "商业贷款"
  contractNo: string;        // 合同号
  accountNo: string;         // 还款账号
  nextRateDate: string;      // 下次利率重定价日
  currentInterest: number;   // 当期月利息
  mode?: string;             // 还款方式
  payDay?: number;           // 每月还款日
  autoProgress?: boolean;    // 是否自动计算进度
  createdAt: string;
}
```

#### `Annuity`（企业年金）

```typescript
interface Annuity {
  id: string;
  code: string;         // "LENOVO-TK-ZQ"
  name: string;         // 组合名称
  planName: string;     // 计划名称
  manager: string;      // 管理人
  balance: number;      // 当前余额
  category: string;     // 分类
  risk: string;         // 风险等级
  lastUpdate: string;   // 更新日期
  createdAt: string;
}
```

#### `FxRates`（汇率缓存）

```typescript
interface FxRates {
  USDCNY: number;   // 美元兑人民币
  HKDCNY: number;   // 港币兑人民币
  updatedAt: string; // 更新时间戳
}
```

---

## 2. 未来架构：后端数据库 Schema 设计

> 若后续接入后端（如 PostgreSQL / MySQL），推荐 Schema 如下。

### 2.1 表结构

| 表名 | 说明 | 主键 |
|------|------|------|
| `users` | 用户 | `id` |
| `cash_accounts` | 现金账户 | `id` |
| `income_records` | 收入记录 | `id` |
| `expense_records` | 支出记录 | `id` |
| `insurance_policies` | 保单 | `id` |
| `stock_holdings` | 股票持仓 | `id` |
| `rsu_grants` | RSU 授予 | `id` |
| `fund_holdings` | 基金持仓 | `id` |
| `loans` | 房贷 | `id` |
| `annuity_portfolios` | 企业年金组合 | `id` |
| `market_prices` | 市场价格快照 | `id` |
| `fx_rates` | 汇率快照 | `id` |
| `notifications` | 通知 | `id` |

### 2.2 关键表字段示例

#### `users`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `username` | VARCHAR | 用户名 |
| `email` | VARCHAR | 邮箱 |
| `created_at` | TIMESTAMP | 创建时间 |
| `updated_at` | TIMESTAMP | 更新时间 |

#### `stock_holdings`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 外键 |
| `code` | VARCHAR | 股票代码 |
| `name` | VARCHAR | 名称 |
| `shares` | INT | 持股数 |
| `cost` | DECIMAL | 成本价 |
| `currency` | VARCHAR | 币种 |
| `market` | VARCHAR | 市场 |
| `created_at` | TIMESTAMP | 创建时间 |

#### `market_prices`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `code` | VARCHAR | 代码 |
| `price` | DECIMAL | 价格 |
| `currency` | VARCHAR | 币种 |
| `fetched_at` | TIMESTAMP | 获取时间 |

---

## 3. 数据迁移方案

### 3.1 localStorage → 后端

1. 用户登录后，前端读取 localStorage 全部数据
2. 调用后端 API `/api/migrate` 批量导入
3. 后端校验数据格式，写入对应表
4. 迁移成功后前端清空 localStorage 业务数据，保留版本号

### 3.2 导出/导入 JSON

前端已支持：
- 数据导出：可将 localStorage 数据序列化为 JSON 下载
- 数据导入：上传 JSON 恢复 localStorage

推荐格式：

```json
{
  "version": "v56",
  "exportedAt": "2026-06-25T21:00:00+08:00",
  "data": {
    "cashAccounts": [...],
    "insurance": [...],
    "stocks": [...],
    "funds": [...],
    "loans": [...],
    "annuities": [...]
  }
}
```
