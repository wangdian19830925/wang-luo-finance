// 股权激励/RSU 数据
// 九号公司(689009) 2026年长期激励计划 — 方案二(RSU+长期现金)
// 授予日: 2026-06-30 | 分4年归属，每年25%(3,371股)
// 授予价: 24.50元/份 | 授予时市场公允价: 44.50元/份
// 归属条件: 公司营收&净利达成 + 组织绩效 + 个人绩效
// 长期现金: 330,320元总额，每年82,580元
var RSU_GRANTS = [
  {
    code: "689009",
    name: "九号公司",
    totalShares: 13484,
    perYearShares: 3371,
    grantPrice: 24.50,          // 授予/购买价格
    fairPrice: 44.50,           // 授予时市场公允价
    currentPrice: 33.01,        // 当前市价（由 fetch_stock_prices.py 每日更新）
    grantDate: "2026-06-30",
    vestingYears: 4,
    vesting: [
      { date: "2027-06-30", shares: 3371 },
      { date: "2028-06-30", shares: 3371 },
      { date: "2029-06-30", shares: 3371 },
      { date: "2030-06-30", shares: 3371 }
    ],
    longCash: { total: 330320, perYear: 82580 },
    currency: "CNY",
    market: "CN",
    plan: "方案二: RSU + 长期现金",
    grantor: "九号有限公司"
  }
];
