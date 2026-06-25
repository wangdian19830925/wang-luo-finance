// 保险数据导入脚本 - 从 Excel 文件导入所有保单
// 在浏览器控制台运行此脚本，或在 app.js 初始化时调用

const InsuranceImport = {
  // 原始 Excel 数据映射
  policies: [
    // 典的保单
    {
      contractNo: 'C186709225',
      company: '友邦保险',
      product: '友邦优享年年金保险',
      person: '典',
      premium: 12000,
      freq: 'yearly',
      effectiveDate: '2023-10-10',
      payStart: 2023,
      payEnd: 2042,
      nextPayDate: '2026-10-10',
      expireDate: '2063-12-31',
      collectStart: 2043,
      collectEnd: 2063,
      collectAmount: 20551,
      account: '6847(养老金专用账号)'
    },
    {
      contractNo: 'C398208857',
      company: '友邦保险',
      product: '友邦自在宝终身寿险（万能型）',
      person: '典',
      premium: 100,
      freq: 'yearly',
      effectiveDate: '2023-01-01',
      payStart: 2023,
      payEnd: 2027,
      nextPayDate: '2026-01-01',
      expireDate: '终身',
      collectNote: '60岁起每年领取约3万，按需自提',
      account: '8150（招商）'
    },
    {
      contractNo: 'C181202361',
      company: '友邦保险',
      product: '友邦友未来年金保险',
      person: '典',
      premium: 32035,
      freq: 'yearly',
      effectiveDate: '2023-01-01',
      payStart: 2023,
      payEnd: 2032,
      nextPayDate: '2026-01-01',
      expireDate: '2068-12-31',
      collectStart: 2043,
      collectEnd: 2068,
      collectAmount: 2500,
      collectFreq: '每月',
      account: '8150（招商）'
    },
    {
      contractNo: 'H133022599',
      company: '友邦保险',
      product: '友邦长保康惠长期医疗保险（费率可调）',
      person: '典',
      premium: 920,
      freq: 'yearly',
      effectiveDate: '2023-12-16',
      payStart: 2023,
      payEnd: 9999,
      nextPayDate: '2026-12-16',
      expireDate: '终身',
      collectNote: '400万/年，1000万/20年，发票报销',
      account: '8150（招商）'
    },
    {
      contractNo: 'C390562708',
      company: '友邦保险',
      product: '友邦全佑惠享珍藏版重大疾病保险',
      person: '典',
      premium: 11263.77,
      freq: 'yearly',
      effectiveDate: '2020-12-16',
      payStart: 2020,
      payEnd: 2042,
      nextPayDate: '2026-12-16',
      expireDate: '2042-12-31',
      collectNote: '30万重疾给付，另有轻中症多次赔付',
      account: '8150（招商）'
    },
    // 典给木买的保单
    {
      contractNo: 'C182507751',
      company: '友邦保险',
      product: '友邦创赢未来年金保险（木）',
      person: '木',
      premium: 27939.6,
      freq: 'yearly',
      effectiveDate: '2023-01-01',
      payStart: 2023,
      payEnd: 2032,
      nextPayDate: '2026-01-01',
      expireDate: '2032-12-31',
      collectNote: '进入万能险，15年后可领取',
      account: '8150（招商）'
    },
    // 静的保单
    {
      contractNo: 'C185221966',
      company: '友邦保险',
      product: '友邦悦享年年金保险',
      person: '静',
      premium: 12000,
      freq: 'yearly',
      effectiveDate: '2023-04-24',
      payStart: 2023,
      payEnd: 2032,
      nextPayDate: '2026-04-24',
      expireDate: '2063-12-31',
      collectStart: 2043,
      collectEnd: 2063,
      collectAmount: 12564,
      account: '8679(养老金专用账号)'
    },
    {
      contractNo: 'C182507696',
      company: '友邦保险',
      product: '友邦友未来年金保险',
      person: '静',
      premium: 50305,
      freq: 'yearly',
      effectiveDate: '2023-01-01',
      payStart: 2023,
      payEnd: 2028,
      nextPayDate: '2026-01-01',
      expireDate: '2068-12-31',
      collectStart: 2043,
      collectEnd: 2068,
      collectAmount: 2500,
      collectFreq: '每月',
      account: '1109（招商）'
    },
    {
      contractNo: 'H98208831',
      company: '友邦保险',
      product: '友邦自在宝终身寿险（万能型）',
      person: '静',
      premium: 100,
      freq: 'yearly',
      effectiveDate: '2023-01-01',
      payStart: 2023,
      payEnd: 2027,
      nextPayDate: '2026-01-01',
      expireDate: '终身',
      collectNote: '60岁起每年领取约3万，按需自提',
      account: '1109（招商）'
    },
    {
      contractNo: 'C181202578',
      company: '友邦保险',
      product: '友邦双赢两全保险',
      person: '静',
      premium: 2720,
      freq: 'yearly',
      effectiveDate: '2022-01-28',
      payStart: 2022,
      payEnd: 2041,
      nextPayDate: '2026-01-28',
      expireDate: '2052-01-28',
      collectNote: '一次性领取104400元（2052年）',
      collectDate: '2052-01-28',
      collectAmount: 104400,
      account: '1109（招商）'
    },
    {
      contractNo: 'C395062711',
      company: '友邦保险',
      product: '友邦全佑惠享珍藏版重大疾病保险',
      person: '静',
      premium: 10230.59,
      freq: 'yearly',
      effectiveDate: '2020-12-23',
      payStart: 2020,
      payEnd: 2042,
      nextPayDate: '2026-12-23',
      expireDate: '2042-12-31',
      collectNote: '30万重疾给付，另有轻中症多次赔付',
      account: '1109（招商）'
    },
    {
      contractNo: 'H133022586',
      company: '友邦保险',
      product: '友邦智选康惠荣耀（2022）医疗保险',
      person: '静',
      premium: 920,
      freq: 'yearly',
      effectiveDate: '2022-12-23',
      payStart: 2022,
      payEnd: 9999,
      nextPayDate: '2026-12-23',
      expireDate: '终身',
      collectNote: '400万/年，发票报销',
      account: '1109（招商）'
    },
    // 静给木买的保单
    {
      contractNo: 'C82507780',
      company: '友邦保险',
      product: '友邦创赢未来年金保险（木）',
      person: '木',
      premium: 43572.6,
      freq: 'yearly',
      effectiveDate: '2023-01-01',
      payStart: 2023,
      payEnd: 2028,
      nextPayDate: '2026-01-01',
      expireDate: '2032-12-31',
      collectNote: '进入万能险，15年后可领取',
      account: '1109（招商）'
    },
    {
      contractNo: 'C181202659',
      company: '友邦保险',
      product: '友邦双赢两全保险（木）',
      person: '木',
      premium: 2715,
      freq: 'yearly',
      effectiveDate: '2022-01-28',
      payStart: 2022,
      payEnd: 2041,
      nextPayDate: '2026-01-28',
      expireDate: '2052-01-28',
      collectNote: '一次性领取104300元（2052年）',
      collectDate: '2052-01-28',
      collectAmount: 104300,
      account: '1109（招商）'
    },
    {
      contractNo: 'H133022531',
      company: '友邦保险',
      product: '友邦长保康惠长期医疗保险（费率可调）（木）',
      person: '木',
      premium: 490,
      freq: 'yearly',
      effectiveDate: '2023-12-17',
      payStart: 2023,
      payEnd: 9999,
      nextPayDate: '2026-12-17',
      expireDate: '终身',
      collectNote: '400万/年，1000万/20年，发票报销',
      account: '1109（招商）'
    },
    {
      contractNo: 'C395062737',
      company: '友邦保险',
      product: '友邦全佑倍呵护珍藏版重大疾病保险（木）',
      person: '木',
      premium: 5091.84,
      freq: 'yearly',
      effectiveDate: '2020-12-14',
      payStart: 2020,
      payEnd: 2042,
      nextPayDate: '2026-12-14',
      expireDate: '2042-12-31',
      collectNote: '30万重疾给付，另有轻中症多次赔付',
      account: '1109（招商）'
    }
  ],

  // 执行导入
  importAll() {
    if (!confirm('将导入 ' + this.policies.length + ' 条保单数据，是否继续？\n（现有数据不会被覆盖）')) {
      return;
    }

    let added = 0;
    const existing = Storage.get(Storage.keys.insurance);
    const existingContracts = new Set(existing.map(p => p.contractNo));

    this.policies.forEach(p => {
      if (existingContracts.has(p.contractNo)) {
        console.log('跳过已存在的保单:', p.contractNo, p.product);
        return;
      }

      Storage.add(Storage.keys.insurance, {
        contractNo: p.contractNo,
        company: p.company,
        product: p.product,
        person: p.person,
        premium: p.premium,
        freq: p.freq,
        effectiveDate: p.effectiveDate,
        payStart: p.payStart,
        payEnd: p.payEnd,
        nextPayDate: p.nextPayDate,
        expireDate: p.expireDate,
        collectStart: p.collectStart || null,
        collectEnd: p.collectEnd || null,
        collectAmount: p.collectAmount || null,
        collectFreq: p.collectFreq || null,
        collectNote: p.collectNote || null,
        collectDate: p.collectDate || null,
        account: p.account || ''
      });
      added++;
    });

    alert('导入完成！新增 ' + added + ' 条保单。\n请刷新保险管理页面查看。');
    return added;
  }
};

// 在控制台运行：InsuranceImport.importAll()
