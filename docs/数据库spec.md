# 家庭资产管理工具 — 数据库 Spec

> 版本：v32 baseline | 更新：2026-06-24
> 当前架构：纯前端 PWA，数据存 `localStorage`（无后端数据库）
> 本文档定义：① 当前 localStorage 数据结构  ② 未来若引入后端 DB 的 Schema 设计

---

## 目录

1. [当前架构：localStorage 数据规范](#1-当前架构-localstorage-数据规范)
2. [未来架构：后端数据库 Schema 设计（备选）](#2-未来架构-后端数据库-schema-设计)
3. [数据迁移方案](#3-数据迁移方案)

---

## 1. 当前架构：localStorage 数据规范

### 1.1 存储键值总览

| Key | 值类型 | 大小估算 | 说明 |
|-----|--------|----------|------|
| `fm_income` | `Income[]` | <10KB | 收入记录 |
| `fm_expense` | `Expense[]` | <10KB | 支出记录 |
| `fm_assets` | `Asset[]` | <1KB | 资产（预留） |
| `fm_insurance` | `Insurance[]` | <20KB | 保单（16 条） |
| `fm_stocks` | `StockHolding[]` | <5KB | 股票持仓 |
| `fm_rsu` | `RSUGrant[]` | <5KB | RSU 授予 |
| `fm_funds` | `FundHolding[]` | <5KB | 基金持仓 |
| `fm_loans` | `Loan[]` | <5KB | 房贷 |
| `fm_annuities` | `Annuity[]` | <5KB | 企业年金 |
| `fm_notifications` | `Notification[]` | <1KB | 提醒（预留） |
| `fm_exchange_rates` | `FxRates` | <1KB | 汇率缓存 |
| `fm_stock_price_{code}` | `PriceCache` | <1KB/只 | 单只股票价格缓存（30min TTL） |

**总大小**：<70KB，远低于 localStorage 5MB 限制。

---

### 1.2 数据结构详细定义

#### `Income`（收入记录）

```typescript
interface Income {
  id: string;           // 唯一 ID（Date.now().toString(36) + 随机 5 位）
  amount: number;        // 金额（CNY）
  date: string;          // 收入日期（YYYY-MM-DD）
  incomeType: string;    // 收入类型：salary | bonus | investment | rent | other
  source: string;        // 来源（如"支付宝"、"工资"）
  method: string;        // 支付方式：alipay | wechat | bankcard
  note: string;          // 备注
  createdAt: string;     // 创建时间（ISO 8601）
}
```

---

#### `Expense`（支出记录）

```typescript
interface Expense {
  id: string;
  amount: number;
  date: string;
  category: string;     // 分类：food | shopping | housing | transport | education | medical | entertainment | other
  method: string;       // alipay | wechat | bankcard | credit
  source: string;       // 商家/来源
  note: string;
  createdAt: string;
  refundable?: boolean;  // 是否可报销（预留）
}
```

---

#### `Insurance`（保单）

```typescript
interface Insurance {
  id: string;
  contractNo: string;   // 合同号（唯一业务标识）
  company: string;      // 保险公司
  product: string;      // 产品名称
  person: string;       // 被保险人：典 | 静 | 木
  premium: number;      // 年保费（CNY）
  freq: string;         // 缴费频率：yearly | monthly
  payPeriod: string;    // 缴费区间（文本）："2023-2032 · 10年" 或 "每年单独购买"
  baseNextPayDate: string | null;  // Excel 原始扣款日（YYYY-MM-DD）
  nextPayDate: string | null;     // 当前实际下次缴费日（YYYY-MM-DD）
  expireDate: string | null;      // 保单到期日（YYYY-MM-DD 或 "终身"）
  effectiveDate?: string; // 生效日（YYYY-MM-DD）
  collectStart?: number; // 领取起始年
  collectEnd?: number;   // 领取结束年
  collectAmount?: number;// 年领取金额
  collectFreq?: string;  // 领取频率："每月" | "每年"
  collectDate?: string;  // 一次性领取日期（YYYY-MM-DD）
  collectNote: string;  // 领取说明
  account: string;      // 扣款账号（后4位+银行）
  createdAt: string;
}
```

**索引**：`contractNo`（唯一）

---

#### `StockHolding`（股票持仓）

```typescript
interface StockHolding {
  id: string;
  code: string;         // 股票代码：00992 | NIO | 689009
  name: string;         // 名称
  shares: number;       // 持股数
  cost: number;         // 成本价
  currentPrice: number; // 当前价（由 fetch 更新）
  currency: string;      // 币种：CNY | HKD | USD
  market: string;       // 市场：HK | US | CN
  broker: string;       // 券商
  accountNo: string;    // 资金账号
  updatedAt?: string;   // 价格最后更新时间
}
```

---

#### `RSUGrant`（RSU 授予）

```typescript
interface RSUGrant {
  id: string;
  code: string;         // 股票代码：689009
  name: string;
  totalShares: number;  // 授予总股数
  perYearShares: number; // 每年归属股数
  grantPrice: number;    // 授予价
  fairPrice: number;     // 授予时公允价
  currentPrice: number; // 当前价
  grantDate: string;    // 授予日（YYYY-MM-DD）
  vestingYears: number; // 归属年数（通常 4）
  vesting: {            // 归属计划
    date: string;       // 归属日
    shares: number;
  }[];
  longCash?: {         // 长期现金（可选）
    total: number;
    perYear: number;
  };
  currency: string;
  market: string;
  plan: string;         // 激励计划名称
  grantor: string;      // 授予方
  createdAt: string;
}
```

---

#### `FundHolding`（基金持仓）

```typescript
interface FundHolding {
  id: string;
  code: string;         // 基金代码：013126
  name: string;
  holdValue: number;    // 持仓金额（当前市值）
  costValue: number;    // 投入本金
  nav: number;          // 最新净值
  shares: number;       // 持有份额 = holdValue / nav
  market: string;       // CN
  currency: string;     // CNY
  updatedAt?: string;   // 净值更新时间
}
```

---

#### `Loan`（房贷）

```typescript
interface Loan {
  id: string;
  bank: string;         // 银行
  property: string;     // 贷款用途
  total: number;        // 贷款总额
  paid: number;         // 已还总额
  balance: number;      // 剩余本金
  rate: number;         // 当前利率（%）
  rateType: string;     // 利率类型："公积金基准利率" | "LPR-0.3%"
  term: number;         // 贷款年限
  months: number;       // 总月数
  startDate: string;    // 放款日（YYYY-MM-DD）
  endDate: string;      // 到期日（YYYY-MM-DD）
  payCycle: string;     // 还款周期："month"
  loanType: string;     // "公积金" | "商业贷款"
  contractNo: string;   // 合同号
  accountNo: string;    // 还款账号
  nextRateDate: string; // 下次利率重定价日（YYYY-MM-DD）
  currentInterest: number; // 当期利息（元/月）
}
```

---

#### `Annuity`（企业年金）

```typescript
interface Annuity {
  id: string;
  code: string;         // 组合代码：LENOVO-TK-ZQ 等
  name: string;         // 组合名称
  planName: string;     // 计划名称
  manager: string;      // 管理人
  balance: number;      // 当前余额
  category: string;     // 类别："固定收益类" | "混合类"
  risk: string;         // 风险等级："R2-中低风险" | "R3-中等风险"
  lastUpdate: string;   // 余额更新日期（YYYY-MM-DD）
}
```

---

#### `FxRates`（汇率缓存）

```typescript
interface FxRates {
  USDCNY: number;
  HKDCNY: number;
  _updated: string;    // 更新时间（ISO 8601）
}
```

---

## 2. 未来架构：后端数据库 Schema 设计

> 当数据量超出 localStorage 限制，或多设备同步需求出现时，可迁移到后端数据库。
> 以下为 **SQLite**（本地）/ **PostgreSQL**（云端）兼容 Schema。

### 2.1 关系图

```
User (用户)
 ├── Person (家庭成员：典/静/木)
 ├── StockHolding (股票持仓)
 ├── FundHolding (基金持仓)
 ├── RSUGrant (RSU 授予)
 ├── Insurance (保单)
 ├── Loan (房贷)
 ├── Annuity (企业年金)
 ├── Income (收入记录)
 ├── Expense (支出记录)
 └── PriceHistory (价格历史——每日快照)
```

---

### 2.2 表定义

#### `users`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `name` | TEXT | NOT NULL | 用户名 |
| `role` | TEXT | DEFAULT 'admin' | 角色 |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

---

#### `persons`（家庭成员）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `name` | TEXT | UNIQUE NOT NULL | 典 / 静 / 木 |
| `color` | TEXT | | UI 显示色 |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

---

#### `stock_holdings`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `code` | TEXT | NOT NULL | 股票代码 |
| `name` | TEXT | | 名称 |
| `shares` | INTEGER | NOT NULL | 持股数 |
| `cost` | REAL | | 成本价 |
| `current_price` | REAL | | 当前价 |
| `currency` | TEXT | DEFAULT 'CNY' | 币种 |
| `market` | TEXT | | HK / US / CN |
| `broker` | TEXT | | 券商 |
| `account_no` | TEXT | | 资金账号 |
| `person_id` | INTEGER | FK → persons.id | 持有人 |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

**索引**：`UNIQUE(code, person_id, broker)`

---

#### `fund_holdings`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `code` | TEXT | NOT NULL | 基金代码 |
| `name` | TEXT | | 名称 |
| `hold_value` | REAL | | 持仓金额 |
| `cost_value` | REAL | | 投入本金 |
| `nav` | REAL | | 最新净值 |
| `shares` | REAL | | 持有份额 |
| `person_id` | INTEGER | FK → persons.id | |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

---

#### `rsu_grants`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `code` | TEXT | NOT NULL | 股票代码 |
| `name` | TEXT | | 名称 |
| `total_shares` | INTEGER | | 授予总股数 |
| `per_year_shares` | INTEGER | | 每年归属 |
| `grant_price` | REAL | | 授予价 |
| `current_price` | REAL | | 当前价 |
| `grant_date` | DATE | | 授予日 |
| `vesting_years` | INTEGER | DEFAULT 4 | |
| `person_id` | INTEGER | FK → persons.id | |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

**归属计划** 另存 `rsu_vesting` 子表：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `rsu_id` | INTEGER | FK → rsu_grants.id | |
| `vest_date` | DATE | | 归属日 |
| `shares` | INTEGER | | 归属股数 |
| `status` | TEXT | DEFAULT 'pending' | pending / vested |

---

#### `insurance_policies`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `contract_no` | TEXT | UNIQUE NOT NULL | 合同号 |
| `company` | TEXT | | 保险公司 |
| `product` | TEXT | | 产品名称 |
| `person_id` | INTEGER | FK → persons.id | |
| `premium` | REAL | | 年保费 |
| `freq` | TEXT | | yearly / monthly |
| `pay_start` | INTEGER | | 缴费起始年 |
| `pay_end` | INTEGER | | 缴费结束年 |
| `next_pay_date` | DATE | | 下次缴费日 |
| `expire_date` | DATE | | 到期日（NULL=终身） |
| `collect_start` | INTEGER | | 领取起始年 |
| `collect_end` | INTEGER | | 领取结束年 |
| `collect_amount` | REAL | | 年领取金额 |
| `account` | TEXT | | 扣款账号 |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

---

#### `loans`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `bank` | TEXT | | 银行 |
| `property` | TEXT | | 贷款用途 |
| `total` | REAL | | 贷款总额 |
| `paid` | REAL | | 已还总额 |
| `balance` | REAL | | 剩余本金 |
| `rate` | REAL | | 利率（%） |
| `rate_type` | TEXT | | 利率类型 |
| `term` | INTEGER | | 年限 |
| `start_date` | DATE | | 放款日 |
| `end_date` | DATE | | 到期日 |
| `next_rate_date` | DATE | | 下次重定价日 |
| `person_id` | INTEGER | FK → persons.id | |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

---

#### `incomes`（收入记录）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `amount` | REAL | NOT NULL | 金额 |
| `date` | DATE | NOT NULL | 收入日期 |
| `income_type` | TEXT | | salary / bonus / investment / rent / other |
| `source` | TEXT | | 来源 |
| `method` | TEXT | | alipay / wechat / bankcard |
| `note` | TEXT | | 备注 |
| `person_id` | INTEGER | FK → persons.id | |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

---

#### `expenses`（支出记录）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `amount` | REAL | NOT NULL | 金额 |
| `date` | DATE | NOT NULL | 支出日期 |
| `category` | TEXT | | food / shopping / housing / ... |
| `method` | TEXT | | alipay / wechat / bankcard / credit |
| `source` | TEXT | | 商家 |
| `note` | TEXT | | 备注 |
| `person_id` | INTEGER | FK → persons.id | |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

---

#### `price_history`（每日价格快照）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `code` | TEXT | NOT NULL | 股票/基金代码 |
| `date` | DATE | NOT NULL | 快照日期 |
| `price` | REAL | | 收盘价 |
| `nav` | REAL | | 净值（基金） |
| `source` | TEXT | | 数据来源 |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

**索引**：`UNIQUE(code, date)`

---

## 3. 数据迁移方案

### 3.1 localStorage → SQLite（本地迁移）

```javascript
// 迁移脚本伪代码
function migrateLocalStorageToSQLite() {
  const db = new SQL.JS.Database('family-finance.db');
  // 1. 创建表（见 2.2）
  // 2. 读取 localStorage
  const stocks = JSON.parse(localStorage.getItem('fm_stocks'));
  // 3. 写入 SQLite
  const stmt = db.prepare(`INSERT INTO stock_holdings (code, name, ...) VALUES (?, ?, ...)`);
  stocks.forEach(s => stmt.run(s.code, s.name, ...));
  // 4. 验证行数一致
  // 5. 备份 localStorage（改名 `fm_stocks_bak`）
}
```

---

### 3.2 字段映射表

| localStorage Key | SQLite 表 | 主键 |
|----------------|-----------|------|
| `fm_stocks` | `stock_holdings` | `code + person_id` |
| `fm_funds` | `fund_holdings` | `code + person_id` |
| `fm_rsu` | `rsu_grants` + `rsu_vesting` | `code` |
| `fm_insurance` | `insurance_policies` | `contract_no` |
| `fm_loans` | `loans` | `contract_no` |
| `fm_annuities` | `annuity_holdings`（新表） | `code` |
| `fm_income` | `incomes` | `id` |
| `fm_expense` | `expenses` | `id` |

---

## 4. 数据一致性约束

### 4.1 当前（localStorage）

- **无事务**：每次 `setItem` 覆盖整个数组
- **无外键**：`person` 字段为字符串（"典"），无引用约束
- **无并发控制**：单用户，无冲突

### 4.2 未来（后端 DB）

| 约束 | 实现 |
|------|------|
| 唯一性 | `UNIQUE(code, person_id)` |
| 外键 | `FOREIGN KEY(person_id) REFERENCES persons(id)` |
| 并发 | `updated_at` 乐观锁 |
| 审计 | 所有表加 `created_at`, `updated_at` |

---

## 5. 备份策略

| 层级 | 方案 | 频率 |
|------|------|------|
| 应用层 | 导出 JSON（`Storage.get(key)` → 下载） | 手动 |
| 浏览器层 | localStorage 随浏览器配置文件备份 | 自动 |
| 云端 | CloudStudio 部署包含 `data/` 目录 | 每次部署 |
| 未来 | SQLite WAL 模式 + 定时 `.backup` | 每天 |
