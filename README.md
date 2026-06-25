# 家庭资产管理 PWA

> 私人专属的家庭/个人资产管理工具，覆盖收入、支出、保险、股票、RSU、基金、房贷、年金八大模块，支持通知解析、缴费日历订阅、深色主题 UI，可作为 iPhone Web App 安装到桌面。

## 一、核心特性

- **资产负债总览 Dashboard** — 一屏看到总资产 ¥693,436.49 / 总负债 ¥619,940.40 / 净资产 ¥73,496.09
- **8 大资产管理模块**：收入记录、支出记录、保险、股票、基金、房贷、年金、股权激励 (RSU)
- **多币种支持** — 港股、美股、A股、人民币混合持仓，自动汇率换算
- **通知解析** — 支付宝/微信账单文本粘贴即可识别金额、类型、时间
- **缴费日历订阅** — 自动生成 `.ics` 日历文件，可导入 iOS 日历自动提醒
- **离线支持** — PWA + Service Worker，断网也能查看
- **深色主题 UI** — 扁平化 SVG 图标系统，专为夜间使用优化
- **响应式布局** — 完美适配 iPhone

## 二、技术栈

| 类别 | 选型 | 说明 |
|---|---|---|
| 前端框架 | 原生 HTML + CSS + JavaScript | 零依赖、零打包 |
| 存储 | localStorage | 用户数据存浏览器本地 |
| 静态数据 | JSON 文件 | 股票/基金/保单数据 |
| PWA | Service Worker | network-first 缓存策略 |
| 股票数据 | Python 脚本 | 抓取 Yahoo Finance / Sina / 腾讯 |
| 部署 | CloudStudio 静态服务 | 一键部署云端 |

## 三、项目结构

```
资产管理工具开发/
├── index.html              # 主入口（795 行）
├── manifest.json           # PWA 配置
├── service-worker.js       # 离线缓存（Network-first）
│
├── css/
│   └── style.css           # 深色主题样式（1536 行）
│
├── js/                     # 前端逻辑（2750 行主逻辑）
│   ├── app.js              # 主控制器 + 路由 + 状态管理
│   ├── storage.js          # localStorage 封装
│   ├── parser.js           # 通知文本解析（支付宝/微信）
│   ├── import-insurance.js # 保险 Excel 导入
│   │
│   ├── insurance-data.js   # 16 份保单数据
│   ├── stock-data.js       # 股票持仓（联想 00992 / 蔚来 NIO）
│   ├── loan-data.js        # 房贷（公积金 + 商业贷款）
│   ├── rsu-data.js         # 股权激励（九号公司 689009）
│   ├── fund-data.js        # 基金（华夏食品饮料 ETF）
│   ├── annuity-data.js     # 年金（4 个投资组合）
│   │
│   ├── components/         # 可复用 UI 组件
│   └── pages/              # 页面级组件
│
├── data/                   # 静态数据
│   ├── stock-prices.json   # 实时股价 + 汇率（每日更新）
│   └── stock-history.json  # 6 个月历史价格（趋势图）
│
├── scripts/                # 自动化脚本
│   ├── fetch_stock_prices.py  # 抓取股价 + 汇率
│   └── generate_calendar.py   # 生成 .ics 日历
│
├── assets/
│   └── icons/              # PWA 图标
│
└── 家庭资产管理-缴费还款日历.ics  # 日历订阅文件
```

## 四、本地启动

### 方式 1：Python HTTP 服务（推荐）

```bash
cd /Users/wangdian/Workbuddy/2026-06-25-18-41-23/asset-management-tool
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765/
```

### 方式 2：Node.js HTTP 服务

```bash
cd /Users/wangdian/Workbuddy/2026-06-25-18-41-23/asset-management-tool
npx http-server -p 8765
```

### 方式 3：直接打开 index.html

部分浏览器限制 `file://` 协议的 localStorage 和 Service Worker，建议用 HTTP 协议。

## 五、稳定部署（GitHub Pages）

### 主访问地址（推荐）

**访问链接**：https://wangdian19830925.github.io/wang-luo-finance/

> 该地址由 GitHub Pages 托管，长期稳定，不会像 CloudStudio 沙箱那样被回收。
>
> 只要仓库存在，该 URL 就一直可用。

### 部署方式

每次更新代码后，推送到 GitHub 仓库即可自动部署：

```bash
cd /Users/wangdian/Workbuddy/2026-06-25-18-41-23/asset-management-tool
git add .
git commit -m "更新说明"
git push origin main
```

GitHub Pages 会自动重新构建并发布新版本，通常 1-2 分钟内生效。

## 六、云端部署（CloudStudio，备用）

### 当前在线版本

**访问链接**：https://e4b5fbbf0f5d422db3081da24f383186.app.codebuddy.work

> 旧链接（已弃用）：https://bb5f22c465b348cca2ac06cae2c5fd29.app.codebuddy.work
> 更旧链接（已弃用）：https://74420e2839cf4dd281b5eee53110c2ff.app.codebuddy.work

### 重新部署

在 WorkBuddy 对话中说"部署到 CloudStudio"即可，工具会自动把当前目录部署到沙箱。

或者手动调用：

```bash
# 工具调用（推荐）
workbuddy_cloudstudio_deploy --directory /Users/wangdian/Workbuddy/2026-06-25-18-41-23/asset-management-tool
```

### iPhone 安装到桌面

1. Safari 打开上面的链接
2. 点击底部分享按钮
3. 选择"添加到主屏幕"
4. 应用会出现在桌面，像原生 App 一样启动

## 六、数据更新

### 每日自动更新（已配置）

WorkBuddy 自动化任务 `automation-1782204782359`：

- **时间**：每天 16:30
- **执行**：`python3 scripts/fetch_stock_prices.py`
- **作用**：抓取港股/美股股价、汇率，保存到 `data/stock-prices.json`
- **数据源**：Yahoo Finance → Sina（备用）→ 腾讯（备用）
- **汇率源**：exchangerate-api.com → Yahoo Finance（备用）

### 手动更新

```bash
cd scripts
python3 fetch_stock_prices.py
```

### 重新生成日历

```bash
cd scripts
python3 generate_calendar.py
# 输出的 ics 文件会覆盖项目根目录的同名文件
```

## 七、核心数据流

```
用户操作
  ↓
app.js (路由 + 状态管理)
  ↓
pages/ (页面渲染)
  ↓
components/ (复用 UI)
  ↓
storage.js (localStorage 持久化)

外部数据：
  fetch_stock_prices.py → data/stock-prices.json
                         → data/stock-history.json
                         ↓
                       app.js 拉取并展示
```

## 八、已实现的功能清单

| 模块 | 状态 | 说明 |
|---|---|---|
| 资产负债总览 | ✅ | 8 个子卡片，可点击跳转 |
| 收入记录 | ✅ | 月度统计 + 分类 |
| 支出记录 | ✅ | 月度统计 + 分类 |
| 保险管理 | ✅ | 16 份保单 + 缴费进度 SVG 图 |
| 股票管理 | ✅ | 联想 00992 / 蔚来 NIO + 6 个月走势图 |
| 基金管理 | ✅ | 华夏食品饮料 ETF + 净值更新 |
| 房贷追踪 | ✅ | 公积金 + 商业贷款 + 等额本息月供 |
| 年金管理 | ✅ | 年度对账单风格 + 4 个投资组合 |
| 股权激励 RSU | ✅ | 九号公司 4 年归属计划 + 进度条 |
| 通知解析 | ✅ | 支付宝/微信账单文本解析 |
| 通知管理 | ✅ | .ics 日历下载 + iOS 导入指引 |
| 缴费提醒 Banner | ✅ | Dashboard 顶部显示 |
| 深色主题 | ✅ | 统一暗色 UI |
| PWA 离线 | ✅ | Service Worker 缓存 |

## 九、版本历史

| 日期 | 版本 | 主要变更 |
|---|---|---|
| 2026-06-22 | v1.0 | 初版 PWA 框架 + 8 大模块 |
| 2026-06-23 | v2.0 ~ v5.0 | 图标重构、保险数据导入、RSU、基金、房贷 |
| 2026-06-23 | v5.0 | 深色主题 + .ics 日历 + 通知管理 |
| 2026-06-24 | v6.0 | UI 优化 + iPhone 适配 + 汇率刷新 |
| 2026-06-25 | v75 | 迁移到新 CloudStudio 沙箱，修复 parser 模块 const 重赋值 bug，测试 31/31 通过 |
| 2026-06-25 | v55 | 按用户提供的 index.html / style.css / app.js 重新部署，保留其余模块文件，统一缓存版本到 v55 |

## 十、待办（可继续优化）

详见每次开发后的 `.workbuddy/memory/YYYY-MM-DD.md` 记录。

主要方向：
- 多用户/家庭成员支持
- 数据导出 (CSV / Excel)
- 图表库升级 (ECharts / Chart.js)
- 单元测试 (Jest)
- TypeScript 改造
- Git 版本控制（推荐先用 GitHub 私有仓库托管）

## 十一、WorkBuddy 存档策略

| 存档层 | 内容 | 位置 |
|---|---|---|
| 工作区代码 | 当前最新代码 | `~/Workbuddy/2026-06-25-18-41-23/asset-management-tool/` |
| 文件版本历史 | 每次修改的快照 | `~/.workbuddy/file-history/` |
| 任务清单 | 每次开发的 TODO | `~/.workbuddy/tasks/` |
| 对话日志 | 完整开发过程 | `~/.workbuddy/projects/*.jsonl` |
| 部署历史 | CloudStudio 部署记录 | `~/.workbuddy/cloudstudio-deploy-history/` |
| 自动化备份 | 定时任务配置 | `~/.workbuddy/automation-backups/` |
| 开发记忆 | 每日开发日志 | `~/Workbuddy/2026-06-25-18-41-23/.workbuddy/memory/` |
| 云端副本 | 最新部署版本 | CloudStudio 沙箱 |

**强烈建议**：将本项目接入 Git + GitHub 私有仓库，实现跨设备、跨地域备份。
