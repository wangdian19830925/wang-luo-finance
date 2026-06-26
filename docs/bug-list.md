# 家庭资产管理工具 — Bug List

> 版本：v57 | 更新：2026-06-26

---

## 图例
- 🔴 P0：阻塞功能，必须立即修复
- 🟠 P1：影响主要功能，需要修复
- 🟡 P2：体验/代码质量问题，建议修复
- 🟢 P3：可接受，排期优化
- ✅ 已修复
- ⏳ 待修复

---

## 已修复

| # | 等级 | 问题 | 位置 | 修复内容 | 状态 |
|---|------|------|------|----------|------|
| FIX-01 | 🔴 P0 | 现金资产首次加载显示为 0 | `js/app.js` `init()` / `loadDashboard()` | 初始化默认现金账户，dashboard 加载时兜底 | ✅ |
| FIX-02 | 🟠 P1 | `js/parser.js` 中 `const result` 重赋值 | `js/parser.js` | `const` 改为 `let` | ✅ |
| FIX-03 | 🟠 P1 | `tests/run_tests.js` 在 vm 中无法读取 `Storage` / `Parser` | `tests/run_tests.js` | 将顶层 `const` 替换为 `var` | ✅ |
| FIX-04 | 🟠 P1 | `js/storage.js` 缺少 `cashAccounts` key 和相关方法 | `js/storage.js` | 新增 `cashAccounts` key、`getCashAccounts()`、`calcCashTotal()` | ✅ |
| BUG-01 | 🟡 P2 | 导入 banner 显示 "18 条保单" 与实际 16 条不符 | `js/app.js` L234 | 改为动态读取 `INSURANCE_POLICIES.length` | ✅ |
| BUG-03 | 🟠 P1 | `calcLoanProgress` 直接修改传入 `today` 参数 | `js/app.js` L3453 | 使用 `new Date(today)` 创建副本，避免副作用 | ✅ |
| BUG-04 | 🟠 P1 | `storage.js` 的 `_getFxRates` 缺少汇率有效性校验 | `js/storage.js` L74 | 增加 `< 6` / `< 0.5` 阈值校验，与 app.js 一致 | ✅ |
| BUG-07 | 🟡 P2 | `showToast` 每次调用创建新 `<style>` 元素 | `js/app.js` L4738 | 使用 `_toastStyleAdded` 标志，仅创建一次 | ✅ |
| BUG-08 | 🟠 P1 | Service Worker 缓存列表不完整，无旧缓存清理 | `service-worker.js` | 补充 import-insurance.js/manifest.json/data 文件；activate 时清理旧缓存 | ✅ |
| BUG-09 | 🟡 P2 | 版本号标记不一致（v32/v33/v55/v56/v75 混用） | `index.html`, `service-worker.js` | 统一升级到 v57 | ✅ |
| BUG-10 | 🟠 P1 | `loadInsuranceList` 中 innerHTML 未转义用户输入 | `js/app.js` L2934/L2958 | 所有用户输入字段使用 `escapeHtml()` 转义 | ✅ |
| BUG-11 | 🟠 P1 | `manifest.json` icons 为空 | `manifest.json` | 使用内嵌 SVG data URI 作为图标 | ✅ |
| BUG-12 | 🟠 P1 | `_findClosestClose` 使用 UTC 日期匹配本地历史数据 | `js/app.js` L2299 | 改用 `getFullYear()/getMonth()/getDate()` 本地日期 | ✅ |

---

## 待修复（低优先级）

| # | 等级 | 问题 | 位置 | 说明 | 状态 |
|---|------|------|------|------|------|
| BUG-02 | 🟡 P2 | `_drawAssetTrendChart` 中 `firstV/change` 等变量重复声明 | `js/app.js` L2317-2386 | 代码重复，维护隐患 | ⏳ |
| BUG-05 | 🟠 P1 | `_loadAllHistoryData` 硬编码股票代码，新增股票不进入曲线 | `js/app.js` L2097 | 资产曲线对新增股票不准确 | ⏳ |
| BUG-06 | 🟠 P1 | `import-insurance.js` 数据结构与 `insurance-data.js` 不兼容 | `js/import-insurance.js` | 死代码，导入后沉淀资产计算失效 | ⏳ |
| BUG-13 | 🟡 P2 | `history-data.js` 日期与 `data/stock-history.json` 可能不同步 | `js/history-data.js` / `data/stock-history.json` | 曲线数据源不一致 | ⏳ |
