# 家庭资产管理工具 — 测试方案与测试用例

> 版本：v32 baseline | 更新：2026-06-25
> 项目类型：纯前端 PWA（无后端），测试以 **Node.js 单元测试** + **浏览器手动验收** 为主

---

## 目录

1. [测试策略](#1-测试策略)
2. [测试 1：数据库测试（localStorage）](#2-测试1数据库测试)
3. [测试 2：接口规范测试](#3-测试2接口规范测试)
4. [测试 3：UI 交互测试](#4-测试3ui-交互测试)
5. [测试 4：功能验收测试](#5-测试4功能验收测试)
6. [Bug List](#6-bug-list)

---

## 1. 测试策略

### 1.1 测试金字塔

```
        /\
       /  \  手动验收测试（Step 4）
      /____\
     /      \    UI 交互测试（jsdom 模拟）
    /__________\  接口规范测试（Node.js）
   /____________\ 数据库测试（localStorage mock）
```

### 1.2 环境说明

| 测试类型 | 运行环境 | 工具 |
|-----------|-----------|------|
| 数据库测试 | Node.js | `node:test` + `mock-localstorage` |
| 接口规范测试 | Node.js | `node:test` |
| UI 交互测试 | 浏览器手动 | Checklist |
| 功能验收测试 | 浏览器手动 | Checklist |

### 1.3 文件组织

```
tests/
  run_tests.js          # 测试入口（Node.js）
  test_storage.test.js  # 数据库测试
  test_parser.test.js   # 接口规范测试（Parser）
  test_app_pure.js     # 纯函数单元测试
  TEST_CHECKLIST.md     # 手动测试 Checklist
docs/
  bug-list.md           # Bug List（含修复状态）
```

---

## 2. 测试 1：数据库测试（localStorage）

### 2.1 测试范围

- `Storage` 模块的全部方法
- 数据完整性约束
- 边界条件（空数组、非法输入、localStorage 满）

### 2.2 测试用例

#### `Storage.get / set / add / update / delete`

| ID | 用例 | 输入 | 预期输出 |
|----|------|------|----------|
| DB-01 | `get` 空 key | 不存在的 key | `[]` |
| DB-02 | `get` 有效 key | 已存入的数组 | 相同数组 |
| DB-03 | `set` 正常 | 有效数组 | `true` |
| DB-04 | `set` 非法值（无法 stringify） | 循环引用对象 | `false` |
| DB-05 | `add` 自动生成 id | 一个对象 | 对象带 `id`（长度 > 0）|
| DB-06 | `add` 自动生成 createdAt | 一个对象 | `createdAt` 为 ISO 8601 |
| DB-07 | `update` 存在 id | 有效 id + 更新字段 | 更新后的对象 |
| DB-08 | `update` 不存在 id | 无效 id | `null` |
| DB-09 | `delete` 存在 id | 有效 id | `true` |
| DB-10 | `delete` 不存在 id | 无效 id | `true`（幂等）|

#### `Storage.calcTotalAssets`

| ID | 用例 | 输入 | 预期输出 |
|----|------|------|----------|
| DB-11 | 空持仓 | `[]` 所有类别 | `0` |
| DB-12 | 只有股票（人民币）| 1 只 CNY 股票 | `shares * price` |
| DB-13 | 股票（港币）| 1 只 HKD 股票 | `shares * price * 0.92` |
| DB-14 | 股票（美元）| 1 只 USD 股票 | `shares * price * 7.2` |
| DB-15 | RSU 已解禁 | 1 条 RSU，vested > 0 | `vested * price` |
| DB-16 | RSU 未解禁 | 1 条 RSU，vested = 0 | `0`（不计入）|
| DB-17 | 基金 | 1 条基金 | `holdValue` |
| DB-18 | 保险沉淀 | 1 条保单，已缴 3 年 | `premium * 3` |

#### `Storage.calcTotalDebts`

| ID | 用例 | 输入 | 预期输出 |
|----|------|------|----------|
| DB-19 | 空贷款 | `[]` | `0` |
| DB-20 | 有余额 | 1 条贷款，balance = 100000 | `100000` |
| DB-21 | balance 为负数 | balance = -1000 | `0`（Math.max）|

#### 边界条件

| ID | 用例 | 输入 | 预期输出 |
|----|------|------|----------|
| DB-22 | `shares` 为 0 | 股票 shares=0 | `0` |
| DB-23 | `currentPrice` 为 0 | 股票 price=0 | `0` |
| DB-24 | `currentPrice` 为 `undefined` | 不传 currentPrice |  fallback 到 `cost`，仍为 0 则计 `0` |
| DB-25 | localStorage 满 | 模拟 `setItem` 抛异常 | `set` 返回 `false`，不崩溃 |

---

## 3. 测试 2：接口规范测试

### 3.1 测试范围

- `Parser.parse()` 输出格式符合 Spec
- `Storage` 方法签名符合 Spec
- 外部 API 响应格式符合 Spec（Mock 测试）

### 3.2 测试用例

#### `Parser.parse()`

| ID | 用例 | 输入文本 | 预期输出 |
|----|------|----------|----------|
| API-01 | 收入-工资 | `"工资到账 12800 元 支付宝"` | `{ type:'income', amount:12800, incomeType:'salary', method:'alipay' }` |
| API-02 | 收入-奖金 | `"2026年奖金 50000 元到账"` | `{ type:'income', amount:50000, incomeType:'bonus' }` |
| API-03 | 支出-餐饮 | `"支付宝付款 35.5 元 盒马"` | `{ type:'expense', amount:35.5, category:'food', method:'alipay' }` |
| API-04 | 支出-房贷 | `"银行扣款 5800 元 房贷还款"` | `{ type:'expense', amount:5800, category:'housing' }` |
| API-05 | 空输入 | `""` | `{ success: false }` |
| API-06 | 无法识别 | `"你好世界"` | `{ type:'unknown', confidence: 0 }` |
| API-07 | 日期提取 | `"6月15日 收款 1000 元"` | `{ date: '2026-06-15' }` |

#### `Storage` 方法签名

| ID | 用例 | 检查项 | 预期 |
|----|------|--------|------|
| API-08 | `Storage.get` 签名 | 接受 1 个参数（key）| 符合 Spec |
| API-09 | `Storage.calcTotalAssets` 签名 | 接受 0 个参数 | 符合 Spec |
| API-10 | `Storage.keys` 枚举 | 包含所有 9 个 key | 无遗漏 |

---

## 4. 测试 3：UI 交互测试

### 4.1 测试范围

- 导航切换
- 内联编辑
- Toast 提示
- 图表渲染（Canvas）

### 4.2 测试用例（手动验收清单）

> 详细清单见 `tests/TEST_CHECKLIST.md`

| ID | 用例 | 操作步骤 | 预期结果 |
|----|------|----------|----------|
| UI-01 | 导航切换 | 点击"股票管理" | 页面切换，URL hash 变化 |
| UI-02 | 内联编辑-股数 | 点击股票"持股数" | 出现输入框，回车保存 |
| UI-03 | 内联编辑-取消 | 编辑中按 Esc | 恢复原值 |
| UI-04 | Toast 显示 | 任意保存操作 | 右下角出现提示，2 秒后消失 |
| UI-05 | 股票走势图 | 进入股票页面 | Canvas 渲染面积图 |
| UI-06 | 基金走势图 | 进入基金管理页面 | SVG 折线图渲染 |
| UI-07 | 保险提醒横幅 | 有 30 天内缴费 | 顶部出现黄色横幅 |
| UI-08 | PWA 安装 | 浏览器地址栏点"安装" | 应用可独立运行 |

---

## 5. 测试 4：功能验收测试

### 5.1 验收场景

#### 场景 1：首次使用（空 localStorage）

1. 清除 localStorage
2. 刷新页面
3. 检查：自动导入股票/基金/RSU/保险/房贷/年金数据
4. 检查：Dashboard 显示正确总资产

#### 场景 2：每日刷新

1. 打开页面
2. 点击"刷新全部"
3. 检查：股票价格更新
4. 检查：汇率更新
5. 检查：资产曲线重绘

#### 场景 3：file:// 协议

1. 双击 `index.html`（file:// 协议）
2. 检查：无 `fetch` 报错（Console）
3. 检查：股票/基金曲线正常显示

#### 场景 4：保险缴费提醒

1. 设置某保单 `nextPayDate` 为明天
2. 刷新页面
3. 检查：顶部横幅显示提醒

#### 场景 5：RSU 归属进度

1. 设置系统日期为 2027-07-01（未来）
2. 刷新 RSU 页面
3. 检查：归属进度更新

---

## 6. Bug List

> 详见 `docs/bug-list.md`

---

## 7. 自动化建议

### 7.1 每日回归

```bash
# 每晚 23:00 自动运行（已配置 WorkBuddy 自动化）
cd "/Users/wangdian/WorkBuddy/2026-06-24-13-33-38/资产管理工具开发"
node tests/run_tests.js
```

### 7.2 部署前检查

```bash
# 部署前手动运行
node tests/run_tests.js
# 全部通过后，再 deploy
```
