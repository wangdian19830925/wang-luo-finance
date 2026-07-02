// 股票持仓数据
// code: 股票代码 | name: 名称 | shares: 持股数 | cost: 成本价
// currency: HKD/USD/CNY | broker: 券商 | market: HK/US/CN
// 注: 00992 联想集团成本更新为 4.02（2026-06-23 修正）
var STOCK_HOLDINGS = [
  {
    code: "00992",
    name: "联想集团",
    shares: 4000,
    cost: 4.02,
    currentPrice: 22.18,
    currency: "HKD",
    market: "HK",
    broker: "中银国际",
    accountNo: "8186053-2000"
  },
  {
    code: "NIO",
    name: "蔚来",
    shares: 0,
    cost: 0,
    currentPrice: 5.05,
    currency: "USD",
    market: "US",
    broker: "",
    accountNo: ""
  }
];

// 证券账户现金
var STOCK_CASH = {
  HKD: 10959.90,
  accountNo: "8186053-2000",
  broker: "中银国际"
};
