// 保险数据 - 来自 Excel "保险统计汇总-核算.xlsx" / "保险信息" Sheet
// 最后更新: 2026-06-23
// baseNextPayDate = Excel原始扣款日期; nextPayDate = 当前实际下次缴费日期
// payPeriod = 缴费区间 (Excel 区间列，1年保单显示"每年单独购买")
var INSURANCE_POLICIES = [
  {contractNo:"C186709225",company:"友邦保险",product:"友邦优享年年金保险",person:"典",premium:12000,freq:"yearly",payPeriod:"每年单独购买（仅2023年购买）",baseNextPayDate:null,nextPayDate:null,expireDate:"2023-12-31",collectNote:"仅缴1年已失效，现金价值约3600~7200元锁定在个人养老金账户，退休后方可取；2025年前可申请复效补缴恢复保单"},
  {contractNo:"C398208857",company:"友邦保险",product:"友邦自在宝终身寿险（万能型）",person:"典",premium:100,freq:"yearly",payPeriod:"2023-2027 · 5年",baseNextPayDate:"2026-01-01",nextPayDate:"2027-01-01",collectNote:"60岁起每年领取约3万，按需自提"},
  {contractNo:"C181202361",company:"友邦保险",product:"友邦友未来年金保险",person:"典",premium:32035,freq:"yearly",payPeriod:"2023-2032 · 10年",baseNextPayDate:"2026-01-01",nextPayDate:"2027-01-01",expireDate:"2068-12-31",collectNote:"2043-2068年每月领取2500元"},
  {contractNo:"H133022599",company:"友邦保险",product:"友邦长保康惠长期医疗保险",person:"典",premium:920,freq:"yearly",payPeriod:"每年单独购买",baseNextPayDate:"2026-12-16",nextPayDate:"2026-12-16",collectNote:"400万/年，1000万/20年，发票报销"},
  {contractNo:"C390562708",company:"友邦保险",product:"友邦全佑惠享珍藏版重大疾病保险",person:"典",premium:11263.77,freq:"yearly",payPeriod:"2020-2042 · 23年",baseNextPayDate:"2026-12-16",nextPayDate:"2026-12-16",expireDate:"2042-12-31",collectNote:"30万重疾给付，另有轻中症多次赔付"},
  {contractNo:"C182507751",company:"友邦保险",product:"友邦创赢未来年金保险（木）",person:"木",premium:27939.6,freq:"yearly",payPeriod:"2023-2032 · 10年",baseNextPayDate:"2026-01-01",nextPayDate:"2027-01-01",expireDate:"2032-12-31",collectNote:"进入万能险，15年后可领取"},
  {contractNo:"C185221966",company:"友邦保险",product:"友邦悦享年年金保险",person:"静",premium:12000,freq:"yearly",payPeriod:"2023-2032 · 10年",baseNextPayDate:"2026-04-24",nextPayDate:"2027-04-24",expireDate:"2063-12-31",collectNote:"2043-2063年每年领取约12564元"},
  {contractNo:"C182507696",company:"友邦保险",product:"友邦友未来年金保险（静）",person:"静",premium:50305,freq:"yearly",payPeriod:"2023-2028 · 6年",baseNextPayDate:"2026-01-01",nextPayDate:"2027-01-01",expireDate:"2068-12-31",collectNote:"2043-2068年每月领取2500元"},
  {contractNo:"H98208831",company:"友邦保险",product:"友邦自在宝终身寿险（万能型）（静）",person:"静",premium:100,freq:"yearly",payPeriod:"2023-2027 · 5年",baseNextPayDate:"2026-01-01",nextPayDate:"2027-01-01",collectNote:"60岁起每年领取约3万，按需自提"},
  {contractNo:"C181202578",company:"友邦保险",product:"友邦双赢两全保险（静）",person:"静",premium:2720,freq:"yearly",payPeriod:"2022-2041 · 20年",baseNextPayDate:"2026-01-28",nextPayDate:"2027-01-28",expireDate:"2052-01-28",collectDate:"2052-01-28",collectAmount:104400,collectNote:"2052年一次性领取104400元"},
  {contractNo:"C395062711",company:"友邦保险",product:"友邦全佑惠享珍藏版重大疾病保险（静）",person:"静",premium:10230.59,freq:"yearly",payPeriod:"2020-2042 · 23年",baseNextPayDate:"2026-12-23",nextPayDate:"2026-12-23",expireDate:"2042-12-31",collectNote:"30万重疾给付，另有轻中症多次赔付"},
  {contractNo:"H133022586",company:"友邦保险",product:"友邦智选康惠荣耀（2022）医疗保险",person:"静",premium:920,freq:"yearly",payPeriod:"每年单独购买",baseNextPayDate:"2026-12-23",nextPayDate:"2026-12-23",collectNote:"400万/年，发票报销"},
  {contractNo:"C82507780",company:"友邦保险",product:"友邦创赢未来年金保险（木·静买）",person:"木",premium:43572.6,freq:"yearly",payPeriod:"2023-2028 · 6年",baseNextPayDate:"2026-01-01",nextPayDate:"2027-01-01",expireDate:"2032-12-31",collectNote:"进入万能险，15年后可领取"},
  {contractNo:"C181202659",company:"友邦保险",product:"友邦双赢两全保险（木）",person:"木",premium:2715,freq:"yearly",payPeriod:"2022-2041 · 20年",baseNextPayDate:"2026-01-28",nextPayDate:"2027-01-28",expireDate:"2052-01-28",collectDate:"2052-01-28",collectAmount:104300,collectNote:"2052年一次性领取104300元"},
  {contractNo:"H133022531",company:"友邦保险",product:"友邦长保康惠长期医疗保险（木）",person:"木",premium:490,freq:"yearly",payPeriod:"每年单独购买",baseNextPayDate:"2026-12-17",nextPayDate:"2026-12-17",collectNote:"400万/年，1000万/20年，发票报销"},
  {contractNo:"C395062737",company:"友邦保险",product:"友邦全佑倍呵护珍藏版重大疾病保险（木）",person:"木",premium:5091.84,freq:"yearly",payPeriod:"2020-2042 · 23年",baseNextPayDate:"2026-12-14",nextPayDate:"2026-12-14",expireDate:"2042-12-31",collectNote:"30万重疾给付，另有轻中症多次赔付"}
];
console.log('[保险数据] 已加载 ' + INSURANCE_POLICIES.length + ' 条保单');
