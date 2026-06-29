# “宏观趋势”二级菜单设计文档

## 1. 设计目标

在“家庭资产管理”PWA 中新增一个**“宏观趋势”**二级菜单（页面），集中展示影响退休计算和家庭资产规划的权威宏观数据：

- **人民币计价 CPI 及预测**（通货膨胀率参考）
- **LPR / 定期存款 / 大额存单利率**（稳定投资回报参考）
- **汇率**（ USD/CNY 等，影响海外资产、NIO 等美股估值）
- **权威机构预测**（IMF、世界银行、国内官方数据）

该页面提供的数据，将作为**退休计算**中 **“CPI（通货膨胀率）”** 与 **“年化收益（投资年化收益）”** 两个核心参数的**推荐值来源**。推荐值以**年度曲线**形式输出，即每一年对应一个 CPI 和一个年化收益预测值， retirement 模拟时逐年采用对应年份的数值，从而更贴近真实的经济周期波动。

> 注：退休计算页面中，原标签“通货膨胀率”将改为 **“CPI”**，原“投资年化收益”将改为 **“年化收益”**，以与宏观趋势菜单的表述保持一致。两者均采用**整行年度曲线**编辑方式，不再保留单一固定滑块模式。

## 2. 总体架构

由于本项目是**纯前端 PWA（GitHub Pages 静态托管）**，无后端或云函数，宏观数据的获取采用**“离线数据包 + 定时脚本更新 + 浏览器按需刷新”**的混合架构：

```
┌─────────────────────────────────────────────────────────────────┐
│                      宏观趋势数据流                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     │
│   │ 官方数据源    │────▶│ Python 更新  │────▶│ 静态 JSON 包  │     │
│   │ NBS / PBOC   │     │ 脚本         │     │ data/macro-  │     │
│   │ IMF / WB     │     │ (本地定时)    │     │ trends.json  │     │
│   └──────────────┘     └──────────────┘     └──────┬───────┘     │
│                                                     │              │
│                                                     ▼              │
│                                            ┌──────────────┐        │
│                                            │  GitHub Pages │        │
│                                            │  CDN 静态托管  │        │
│                                            └──────┬───────┘        │
│                                                   │                │
│                                                   ▼                │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                       浏览器端                            │   │
│   │  1. 读取 data/macro-trends.json（优先）                   │   │
│   │  2. 缓存到 localStorage: fm_macro_trends                  │   │
│   │  3. 按需刷新 CORS 友好接口（IMF、World Bank、汇率）       │   │
│   │  4. 渲染图表、推荐参数，并支持一键写入退休计算             │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 为什么不用纯浏览器端 API？

- **国家统计局新版 API**、**中国人民银行**等官方接口**未配置 CORS**，在浏览器 `fetch` 下会被同源策略拦截。
- **AKShare** 是 Python 库，无法在前端运行。
- 因此，**国内官方宏观数据**必须通过本地 Python 脚本抓取后打包进仓库；浏览器端仅作为展示和缓存层。

### 2.2 为什么保留浏览器端刷新能力？

- **IMF DataMapper**、**World Bank API**、**Open Exchange Rates** 等接口支持 CORS，可在浏览器直接调用。
- 用户在国际网络环境下（如 iPhone 海外访问）可以**即时刷新**汇率和 IMF 预测，无需等待重新部署。

## 3. 数据源选型与调用策略

| 指标 | 首选来源 | 浏览器可调用 | 本地脚本 | 说明 |
|------|---------|------------|----------|------|
| 中国 CPI 实际值 | 国家统计局新版 API | 否 | 是 | 官方月度数据，需 Python 抓取后拼接多 cid |
| 中国 CPI 预测 | IMF DataMapper API | 是 | 是 | WEO 半年更新，预测未来 5 年 |
| 中国 CPI 历史 | World Bank API | 是 | 是 | 年度历史，作为图表回填 |
| LPR 利率 | 中国人民银行官网 / AKShare | 否 | 是 | 官方源，每月 20 日左右更新 |
| 存款/大额存单利率 | 各银行官网 / 融 360 | 否 | 是 | 无统一官方 API，采用脚本聚合 |
| 汇率 USD/CNY | 国家外汇管理局 / Open Exchange Rates | 是 | 是 | 现有 app 已使用 `open.er-api.com` |
| 海外 CPI（美国） | FRED API | 需 API Key | 是 | 可选，用户可配置 Key 后启用 |

### 3.1 浏览器端刷新优先级（CORS 友好）

```
汇率：open.er-api.com → 缓存汇率 → 静态包
CPI 预测：IMF DataMapper API → 静态包
CPI 历史：World Bank API → 静态包
LPR/CPI 官方：仅读取静态包（无法浏览器直接刷新）
```

### 3.2 本地脚本更新优先级

```
中国 CPI：NBS API → IMF 预测 → World Bank 历史 → 静态包
LPR：PBOC / AKShare → 静态包
存款利率：AKShare 基准利率 + 银行官网聚合 → 静态包
汇率：SAFE / 央行 → 静态包
```

## 4. 数据模型（data/macro-trends.json）

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-06-29T08:00:00+08:00",
  "nextScheduledUpdate": "2026-07-15T09:00:00+08:00",
  "sources": {
    "cpi": { "name": "国家统计局 / IMF / World Bank", "url": "..." },
    "lpr": { "name": "中国人民银行", "url": "..." },
    "exchangeRate": { "name": "Open Exchange Rates / 外汇管理局", "url": "..." },
    "depositRate": { "name": "AKShare / 银行官网", "url": "..." }
  },
  "cpi": {
    "latest": {
      "month": "2026-05",
      "value": 100.2,
      "yoy": 0.2,
      "mom": -0.1,
      "source": "NBS"
    },
    "history": [
      { "month": "2025-06", "value": 100.1, "yoy": 0.1 },
      { "month": "2025-07", "value": 100.3, "yoy": 0.3 }
    ],
    "forecast": [
      { "year": 2026, "value": 1.2, "source": "IMF-WEO" },
      { "year": 2027, "value": 1.8, "source": "IMF-WEO" }
    ]
  },
  "lpr": {
    "latest": { "date": "2026-06-20", "oneYear": 3.10, "fiveYear": 3.55, "source": "PBOC" },
    "history": [ ... ]
  },
  "depositRate": {
    "latest": { "oneYear": 1.45, "threeYear": 1.95, "fiveYear": 2.0, "source": "聚合" },
    "history": [ ... ]
  },
  "exchangeRate": {
    "latest": { "date": "2026-06-29", "USD_CNY": 7.24, "EUR_CNY": 7.75, "HKD_CNY": 0.928 },
    "history": [ ... ]
  },
  "retirementSuggestions": {
    "curve": {
      "startYear": 2026,
      "endYear": 2050,
      "inflation": [
        { "year": 2026, "value": 1.2, "source": "IMF-WEO" },
        { "year": 2027, "value": 1.8, "source": "IMF-WEO" },
        { "year": 2028, "value": 2.0, "source": "IMF-WEO" }
      ],
      "investmentReturn": [
        { "year": 2026, "value": 3.0, "source": "3年期定存 + 1% 溢价" },
        { "year": 2027, "value": 3.1, "source": "3年期定存 + 1% 溢价" },
        { "year": 2028, "value": 3.2, "source": "3年期定存 + 1% 溢价" }
      ]
    },
    "notes": "年度曲线更贴近经济周期，但预测不确定性更高。退休计算中可基于该推荐曲线手动微调。"
  }
}
```

### 4.1 退休计算用户参数的数据模型（fm_retirement_params）

CPI 与年化收益统一采用**年度曲线**存储。为保持旧版本兼容，保留 `inflation` / `investmentReturn` 作为**全局默认值**，当某一年份在曲线中未显式设置时，回退到该默认值。

```json
{
  "annualExpense": 20,
  "annualEducation": 10,
  "educationEndYear": 2035,
  "inflation": 3.0,
  "investmentReturn": 2.0,
  "inflationCurve": {
    "2026": 1.2,
    "2027": 1.8,
    "2028": 2.0
  },
  "investmentReturnCurve": {
    "2026": 3.0,
    "2027": 3.1,
    "2028": 3.2
  }
}
```

- `inflation` / `investmentReturn`：全局默认值，用于旧版本兼容和未覆盖年份回退。
- `inflationCurve` / `investmentReturnCurve`：对象，key 为年份字符串，value 为当年的 CPI / 年化收益值。每一年均优先从曲线取值；未覆盖年份使用全局默认值。
- 退休计算页面**不再显示固定滑块**，只显示年度曲线编辑器。全局默认值可在曲线编辑器的“批量设置”或“恢复默认值”操作中调整。

### 4.2 计算引擎取值规则

在 `_simulateRetirement` 中，每一年的取值逻辑统一为**曲线优先，默认回退**：

```javascript
var inflationRate = (params.inflationCurve && params.inflationCurve[year] !== undefined)
  ? params.inflationCurve[year]
  : params.inflation;

var investmentReturnRate = (params.investmentReturnCurve && params.investmentReturnCurve[year] !== undefined)
  ? params.investmentReturnCurve[year]
  : params.investmentReturn;
```

- expense 按当年 `inflationRate` 递增。
- investmentGain 按当年 `investmentReturnRate` 计算。
- 未显式设置的年份，统一回退到全局默认值 `params.inflation` / `params.investmentReturn`。

## 5. UI 设计

### 5.1 导航入口

在侧边栏 `nav-list` 中，将“宏观趋势”置于“退休计算”之后或之前，形成逻辑关联：

```html
<li class="nav-item" data-page="macro-trends">
  <span class="nav-icon"><svg class="icon"><use href="#icon-trend"/></svg></span>宏观趋势
</li>
```

新增图标 `icon-trend`（折线图样式）。

### 5.2 页面布局（宏观趋势页）

宏观趋势页只展示**不可编辑的推荐曲线**，并提供“应用到退休计算”按钮：

```
┌──────────────────────────────────────────┐
│ 宏观趋势                    [刷新]        │
├──────────────────────────────────────────┤
│  summary-cards                            │
│  ┌────────┐ ┌────────┐ ┌────────┐     │
│  │CPI同比   │ │LPR 1Y  │ │USD/CNY │     │
│  │ +0.2%   │ │ 3.10%  │ │ 7.240  │     │
│  └────────┘ └────────┘ └────────┘     │
│  ┌────────┐ ┌────────┐ ┌────────┐     │
│  │建议CPI曲线│ │建议收益曲线│ │数据更新  │     │
│  │ 1.2-2.0 │ │ 3.0-3.2 │ │06-29   │     │
│  └────────┘ └────────┘ └────────┘     │
├──────────────────────────────────────────┤
│ CPI 走势（历史 + IMF 预测）                │
│ [折线图]                                  │
├──────────────────────────────────────────┤
│ 利率走势（LPR / 定存）                    │
│ [折线图]                                  │
├──────────────────────────────────────────┤
│ 汇率走势（USD/CNY）                        │
│ [折线图]                                  │
├──────────────────────────────────────────┤
│ 退休计算推荐曲线（只读）                    │
│ CPI  2026──2027──2028──...               │
│ 1.2%  1.8%  2.0%  ...      [应用到退休计算] │
│ 年化收益 2026──2027──2028──...             │
│ 3.0%  3.1%  3.2%  ...      [查看退休计算]   │
├──────────────────────────────────────────┤
│ 数据来源与说明                             │
│ 国家统计局、IMF、人民银行、OpenER...      │
└──────────────────────────────────────────┘
```

### 5.3 交互设计

- **刷新按钮**：
  - 优先刷新 CORS 友好的数据（汇率、IMF、World Bank）。
  - 国内 CPI / LPR 仅能从静态包读取，按钮显示“已是最新静态包”或“静态包日期”。
  - 刷新失败时回退到本地缓存或静态包，不阻塞页面。
- **推荐曲线区域（只读）**：
  - 宏观趋势页的 CPI / 年化收益曲线**仅用于展示推荐值，不允许拖拽或编辑**。
  - 曲线下方标注数据来源（IMF-WEO、PBOC 等）和置信度。
- **“应用到退休计算”按钮**：
  - 将 `retirementSuggestions.curve.inflation` / `investmentReturn` 写入 `fm_retirement_params.inflationCurve` / `investmentReturnCurve`。
  - 同时更新 `params.inflation` / `params.investmentReturn` 为曲线起始年或全局平均值，作为未覆盖年份的默认值。
  - 跳转至“退休计算”页面并重新计算。
- **“查看退休计算”按钮**：
  - 仅跳转，不覆盖用户已设置的曲线，方便用户查看当前退休计算中的手动调整结果。

### 5.4 退休计算页面：年度曲线编辑器

退休计算页面中，**CPI** 与 **年化收益** 各占一整行，均使用**可编辑的年度曲线**。曲线初始值与宏观趋势页的推荐曲线完全同步；用户可手动拖拽调整，也可一键恢复为宏观推荐。

#### 整体布局（参数卡片）

根据截图反馈，退休计算参数卡片重新排布如下：

```
┌──────────────────────────────────────────┐
│ 房贷处理方式              额外收支 [图例]   │
│ ○ 立即还清   ● 继续按月还款   [蓝色虚线框按钮]│
├──────────────────────────────────────────┤
│ CPI                                      │
│  2026  2027  2028  2029  ...             │
│  [可拖拽波浪曲线]                          │
│  [恢复宏观推荐] [整体+0.5%] [整体-0.5%]    │
├──────────────────────────────────────────┤
│ 年化收益                                  │
│  2026  2027  2028  2029  ...             │
│  [可拖拽波浪曲线]                          │
│  [恢复宏观推荐] [整体+0.5%] [整体-0.5%]    │
├──────────────────────────────────────────┤
│ 每年家庭消费        │  每年子女教育         │
│ [══════════●══════]│ [════════●════════]  │
│ 20 万               │  10 万                │
├──────────────────────────────────────────┤
│ 教育结束年份        │  预计寿命             │
│ [══════════════●══]│ [══════════════●══]  │
│ 2035 年             │  90 岁                │
└──────────────────────────────────────────┘
```

#### 曲线编辑器（SVG 可拖拽折线）

- **横轴**：年份（从当前年份到预计寿命年份，若超过 2050 则以 2050 为展示上限，计算时仍使用实际年份）。
- **纵轴**：百分比（CPI：0% ~ 8%；年化收益：0% ~ 10%）。
- **交互**：
  - **拖拽数据点**：在手机上长按并拖动圆点，可上下调整该年份的值。
  - **点击添加点**：在折线上点击空白处，可在该年份添加一个新的控制点。
  - **双击删除点**：移除已添加的控制点（至少保留 2 个点）。
  - **平滑插值**：两个控制点之间的年份采用线性插值，形成连续波浪曲线。
  - **恢复宏观推荐**：一键将当前 CPI / 年化收益曲线重置为宏观趋势页推送的推荐曲线。
  - **整体 +/-0.5%**：所有控制点同步平移，快速表达乐观/悲观预期。

#### 移动端优化

- **表格视图开关**：在曲线下方提供“表格视图”切换，每个年份一行，显示数值输入框和 +/- 按钮，方便精确输入。
- **双指/捏合缩放**：年份跨度大时，允许横向缩放曲线区域（可选，首期可先横向滚动）。

#### 与宏观趋势页的联动

- 宏观趋势页点击“应用到退休计算”后，将推荐曲线写入 `fm_retirement_params`，退休计算页面自动加载并显示该曲线。
- 退休计算页面点击“恢复宏观推荐”，重新从 `fm_retirement_params` 中读取（或直接从 `data/macro-trends.json` 读取）推荐曲线。
- 用户手动调整后的曲线**不会反向同步**到宏观趋势页，仅保存在本地退休计算参数中。

## 6. 与退休计算的集成

### 6.1 参数重命名

退休计算页面中的两个参数标签做如下调整：

| 原标签 | 新标签 | 说明 |
|--------|--------|------|
| 通货膨胀率 | **CPI** | 更直观，与宏观趋势页统一 |
| 投资年化收益 | **年化收益** | 涵盖投资、存款、债券等综合收益预期 |

所有代码中的变量名（如 `inflation`、`investmentReturn`）保持不变，以确保数据兼容性和最小改动范围。

### 6.2 参数映射

| 退休计算参数 | 宏观趋势来源 | 默认值 | 应用方式 |
|-------------|-------------|--------|----------|
| CPI（年度曲线） | IMF WEO 逐年预测 + NBS 实际值外推 | 逐年变化 | 写入 `inflationCurve`；未覆盖年份回退到 `inflation` |
| 年化收益（年度曲线） | LPR/定存利率 + 逐年风险溢价 | 逐年变化 | 写入 `investmentReturnCurve`；未覆盖年份回退到 `investmentReturn` |

> 退休计算中不再区分“固定值”与“年度曲线”两种模式。`inflation` / `investmentReturn` 仅作为曲线未覆盖年份的全局默认值保留。

### 6.3 退休计算页面增强

在退休计算页面的参数卡片中，为 **CPI** 和 **年化收益** 两个参数各分配一整行，展示可编辑的年度曲线，并提供宏观推荐入口：

```
CPI                              [恢复宏观推荐]
[══════════════●══════════●═══════●═══════]  2026-2050

年化收益                         [恢复宏观推荐]
[══════════●════════════════●══════●═══════]  2026-2050
```

- CPI 与年化收益各占一整行，使用波浪曲线展示多年预测/假设。
- 点击“恢复宏观推荐”直接应用宏观趋势页的推荐曲线。
- 曲线支持长按拖拽、点击加点、双击删点、线性插值。

### 6.4 额外收支位置调整与状态提示

根据截图反馈，对参数卡片做如下调整：

1. **文案修改**：将“额外收入/支出”按钮文案改为 **“额外收支”**。
2. **位置移动**：将“额外收支”按钮从参数网格左下角，移动到**房贷处理方式右侧**（即原黄色框“通货膨胀率”所在位置）。
3. **状态图例**：当用户已录入额外收入/支出记录时，在“额外收支”按钮旁显示一个**彩色小圆点/徽章**：
   - 绿色圆点：存在额外收入记录
   - 红色圆点：存在额外支出记录
   - 双色圆点（半绿半红）：同时存在收入和支出记录
   - 数字徽章：显示记录条数（可选，首期可用颜色图例即可）
4. **不展示明细**：参数卡片上只通过图例提示“存在记录”，具体明细仍通过点击按钮进入弹窗查看和编辑。

## 7. 代码模块规划

### 7.1 新增文件

| 文件 | 说明 |
|------|------|
| `docs/macro-trends-design.md` | 本设计文档 |
| `scripts/update_macro_trends.py` | 本地 Python 数据更新脚本 |
| `data/macro-trends.json` | 生成的宏观趋势静态数据包 |
| `tests/macro_trends_tests.js` | 数据格式与接口测试 |

### 7.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `index.html` | 新增侧边栏入口、新增 `page-macro-trends` 页面、新增 `icon-trend` SVG；重构退休计算参数卡片：CPI/年化收益各占一整行并替换为曲线编辑器容器；移动“额外收支”按钮到房贷处理方式右侧 |
| `css/style.css` | 新增宏观趋势卡片、图表、推荐参数样式；新增曲线编辑器、数据点、表格视图样式；新增“额外收支”图例徽章样式 |
| `js/app.js` | 新增 `loadMacroTrendsPage`、`renderMacroTrendsPage`、`fetchMacroTrendsData`、`applyMacroCurveToRetirement`；修改 `navigateTo`、`loadPageData` 映射；修改 `_simulateRetirement` 支持年度曲线；新增 `_bindRetirementCurveEditors`、`renderRetirementCurveEditor`、`applyRecommendedCurve`、`resetCurveToMacro` 等曲线编辑函数；修改退休计算参数绑定；修改额外收支按钮位置与状态图例渲染 |
| `js/storage.js` | 可选：新增 `macroTrends` key，纳入 CloudBase 同步（ debated，见 8.2） |
| `service-worker.js` | 将 `data/macro-trends.json` 加入缓存列表 |

### 7.3 核心函数草案

```javascript
// App 对象新增
_macroTrendsCache: null,

loadMacroTrendsPage() {
  this.fetchMacroTrendsData((data) => {
    this._macroTrendsCache = data;
    this.renderMacroTrendsPage();
  });
},

fetchMacroTrendsData(callback) {
  // 1. 读本地缓存
  // 2. 读静态包 data/macro-trends.json
  // 3. 并行刷新 CORS 友好接口（汇率、IMF、World Bank）
  // 4. 合并后回调
},

renderMacroTrendsPage() {
  // 渲染 summary-cards、图表、推荐曲线（只读）、数据源
},

applyMacroCurveToRetirement() {
  // 将 retirementSuggestions.curve.inflation / investmentReturn
  // 写入 fm_retirement_params.inflationCurve / investmentReturnCurve
  // 跳转 retirement 页面并重新计算
},

// 退休计算页面曲线编辑相关
_bindRetirementCurveEditors() {
  // 绑定 SVG 拖拽、表格输入、批量操作、恢复宏观推荐
},

renderRetirementCurveEditor(container, type, params) {
  // 渲染 SVG 折线图，type = 'inflation' | 'investmentReturn'
  // 支持拖拽、插值、添加/删除控制点
},

resetCurveToMacro(type) {
  // type = 'inflation' | 'investmentReturn'
  // 从 data/macro-trends.json 读取推荐曲线并覆盖当前曲线
},

_getCurveValueForYear(curve, year, defaultValue) {
  // 曲线取值，线性插值（curve 为 {year: value} 对象）
}

// 额外收支状态渲染
_updateExtraTransactionBadge() {
  // 读取 fm_retirement_extra_transactions，根据收入/支出存在性渲染图例
}

// 计算引擎修改
_simulateRetirement(initialCash, currentYear, currentAge, endYear, params, schedules) {
  // ...
  for (var year = currentYear; year <= endYear; year++) {
    var inflationRate = (params.inflationCurve && params.inflationCurve[year] !== undefined)
      ? params.inflationCurve[year]
      : params.inflation;
    var investmentReturnRate = (params.investmentReturnCurve && params.investmentReturnCurve[year] !== undefined)
      ? params.investmentReturnCurve[year]
      : params.investmentReturn;
    // 后续使用 inflationRate / investmentReturnRate 替代 params.inflation / params.investmentReturn
  }
}
```

## 8. 关键决策与待确认事项

### 8.1 是否将宏观数据纳入 CloudBase 同步？

**建议：不纳入用户业务数据同步**，理由：

- 宏观数据是**公共数据**，所有用户一致，无需跨设备同步。
- 静态包 `data/macro-trends.json` 会随版本部署自动更新，用户无需手动同步。
- 浏览器端缓存 `fm_macro_trends` 仅用于离线展示，过期后自动重新拉取静态包。

### 8.2 更新频率

| 数据 | 更新频率 | 触发方式 |
|------|----------|----------|
| CPI 官方 | 月度（次月 9-15 日） | Python 脚本手动或 cron |
| LPR | 月度（每月 20 日左右） | Python 脚本手动或 cron |
| 汇率 | 日度 | 浏览器端每次进入页面刷新，或每 24h 刷新一次 |
| IMF 预测 | 半年度 | Python 脚本 + 浏览器端按需 |

### 8.3 数据质量与置信度

- 在 UI 中明确标注每个推荐值的**数据来源**和**置信度**（高/中/低）。
- 对“投资年化收益”等涉及主观判断的指标，提供**区间建议**（如 2.5% - 3.5%），而非单一数字。

### 8.4 大额存单/定期利率数据难点

- 央行只公布基准利率，各银行实际挂牌利率差异大。
- **方案一**：用 AKShare `ak.deposit_rate()` 获取基准利率作为锚。
- **方案二**：针对常用银行（如工行、招行）编写简单爬虫，定期更新。
- **建议先实现方案一**，后续根据需求扩展方案二。

## 9. 实施计划（建议版本 v157）

1. **Step 1**: 创建 `scripts/update_macro_trends.py` 抓取 CPI / LPR / 汇率，生成 `data/macro-trends.json`（只包含 `retirementSuggestions.curve`，移除 fixed 模式）。
2. **Step 2**: 在 `index.html` 新增“宏观趋势”页面和侧边栏入口；重构退休计算页面参数卡片：CPI/年化收益各占一整行并替换为曲线编辑器；将“额外收支”按钮移动到房贷处理方式右侧。
3. **Step 3**: 在 `js/app.js` 实现宏观趋势数据读取、渲染、只读推荐曲线、应用到退休计算（仅曲线）。
4. **Step 4**: 修改 `_simulateRetirement` 支持 `inflationCurve` / `investmentReturnCurve` 逐年取值，移除 `curveMode` 判断。
5. **Step 5**: 实现退休计算页面的曲线编辑器（SVG 可拖拽、表格视图、批量操作、恢复宏观推荐）。
6. **Step 6**: 实现“额外收支”按钮状态图例（绿/红/双色圆点）。
7. **Step 7**: 更新 CSS 样式和 service-worker 缓存。
8. **Step 8**: 编写测试 `tests/macro_trends_tests.js` 和退休计算曲线测试，运行全量测试。
9. **Step 9**: 版本号升级到 v157，部署 GitHub Pages。

### 9.1 工作量评估（参考）

| 模块 | 预计复杂度 | 说明 |
|------|----------|------|
| Python 数据脚本 | 中 | 需对接多个 API，处理官方 API 拼接 |
| 宏观趋势页面 | 中 | 主要展示图表和推荐参数 |
| 退休计算参数重命名 | 低 | 仅改标签文案 |
| 计算引擎支持曲线 | 低 | 改动小，兼容旧数据 |
| 曲线编辑器 UI | 高 | SVG 拖拽、移动端适配、插值计算 |
| 测试覆盖 | 中 | 新增曲线模式测试 |

## 10. 风险与降级方案

| 风险 | 影响 | 降级方案 |
|------|------|----------|
| NBS API 限流或改版 | 无法更新 CPI | 使用 IMF 预测 + World Bank 历史填充 |
| PBOC 官网改版 | 无法更新 LPR | 使用 AKShare 其他接口或手动维护 |
| 浏览器端 CORS 限制 | 无法在线刷新 | 始终使用静态包 + 本地缓存 |
| 数据文件体积过大 | 首次加载慢 | 仅保留最近 10 年历史 + 5 年预测，压缩 JSON |

---

**下一步**：请确认以上设计思路，特别是数据源选型、UI 布局、与退休计算的集成方式。确认后进入 v157 实现。