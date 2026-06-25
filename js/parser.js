// 通知解析模块
const Parser = {
  // 解析通知内容
  parse(text) {
    if (!text || !text.trim()) {
      return { success: false, error: '请输入通知内容' };
    }

    const content = text.trim();
    let result = {
      type: 'unknown',
      amount: 0,
      source: '',
      method: '',
      date: new Date().toISOString().split('T')[0],
      confidence: 0
    };

    // 尝试提取金额
    const amountPatterns = [
      /[¥￥]?\s*([\d,]+\.?\d*)/,
      /(\d+\.?\d*)\s*[元块]/,
      /金额[:：]\s*([\d,]+\.?\d*)/,
      /([\d,]+\.?\d*)\s*元/
    ];

    for (const pattern of amountPatterns) {
      const match = content.match(pattern);
      if (match) {
        result.amount = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
    }

    // 判断交易类型
    if (this._isIncome(content)) {
      result.type = 'income';
      result = { ...result, ...this._parseIncome(content) };
    } else if (this._isExpense(content)) {
      result.type = 'expense';
      result = { ...result, ...this._parseExpense(content) };
    } else if (this._isTransfer(content)) {
      result.type = 'transfer';
    }

    // 尝试提取日期
    const datePattern = /(\d{1,2})[月\-](\d{1,2})[日\-]/;
    const dateMatch = content.match(datePattern);
    if (dateMatch) {
      const now = new Date();
      result.date = `${now.getFullYear()}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
    }

    result.confidence = this._calcConfidence(result);
    return { success: true, data: result };
  },

  // 判断是否为收入
  _isIncome(content) {
    const incomeKeywords = ['收款', '到账', '收入', '工资', '奖金', '退款', '返还', '利息', '分红'];
    return incomeKeywords.some(kw => content.includes(kw));
  },

  // 判断是否为支出
  _isExpense(content) {
    const expenseKeywords = ['付款', '消费', '支付', '扣款', '支出', '购买', '还款', '缴费'];
    return expenseKeywords.some(kw => content.includes(kw));
  },

  // 判断是否为转账
  _isTransfer(content) {
    const transferKeywords = ['转账', '转入', '转出'];
    return transferKeywords.some(kw => content.includes(kw));
  },

  // 解析收入详情
  _parseIncome(content) {
    const result = {};

    // 识别收入类型
    if (content.includes('工资') || content.includes('薪资')) {
      result.incomeType = 'salary';
      result.source = this._extractSource(content, ['工资', '薪资']);
    } else if (content.includes('奖金')) {
      result.incomeType = 'bonus';
    } else if (content.includes('利息') || content.includes('分红')) {
      result.incomeType = 'investment';
    } else if (content.includes('租金') || content.includes('房租')) {
      result.incomeType = 'rent';
    } else {
      result.incomeType = 'other';
    }

    // 识别支付方式
    if (content.includes('支付宝') || content.includes('Alipay')) {
      result.method = 'alipay';
    } else if (content.includes('微信') || content.includes('WeChat')) {
      result.method = 'wechat';
    } else if (content.includes('银行') || content.includes('卡')) {
      result.method = 'bankcard';
    }

    return result;
  },

  // 解析支出详情
  _parseExpense(content) {
    const result = {};

    // 识别支出类别
    if (this._containsAny(content, ['餐饮', '午餐', '晚餐', '外卖', '美团', '饿了么', '盒马', '超市', '买菜'])) {
      result.category = 'food';
    } else if (this._containsAny(content, ['购物', '淘宝', '京东', '天猫', '拼多多', '衣服', '鞋'])) {
      result.category = 'shopping';
    } else if (this._containsAny(content, ['水电', '燃气', '物业', '房租', '房贷'])) {
      result.category = 'housing';
    } else if (this._containsAny(content, ['打车', '滴滴', '地铁', '公交', '火车', '飞机', '加油'])) {
      result.category = 'transport';
    } else if (this._containsAny(content, ['教育', '培训', '课程', '书本', '学费'])) {
      result.category = 'education';
    } else if (this._containsAny(content, ['医院', '药店', '体检', '医疗'])) {
      result.category = 'medical';
    } else if (this._containsAny(content, ['电影', '游戏', '旅游', '娱乐'])) {
      result.category = 'entertainment';
    } else {
      result.category = 'other';
    }

    // 识别支付方式
    if (content.includes('支付宝')) {
      result.method = 'alipay';
      result.source = this._extractSource(content, ['支付宝']);
    } else if (content.includes('微信支付') || content.includes('微信')) {
      result.method = 'wechat';
      result.source = this._extractSource(content, ['微信支付', '微信']);
    } else if (content.includes('银行') || content.includes('尾号')) {
      result.method = 'bankcard';
      result.source = this._extractSource(content, ['银行']);
    } else if (content.includes('信用卡')) {
      result.method = 'credit';
    }

    // 提取商家/备注
    result.note = this._extractMerchant(content);

    return result;
  },

  // 辅助方法
  _containsAny(text, keywords) {
    return keywords.some(kw => text.includes(kw));
  },

  _extractSource(content, prefixes) {
    for (const prefix of prefixes) {
      const idx = content.indexOf(prefix);
      if (idx !== -1) {
        const after = content.substring(idx + prefix.length);
        const end = after.search(/[：:，,\n]/);
        if (end !== -1) {
          return after.substring(0, end).trim();
        }
      }
    }
    return '';
  },

  _extractMerchant(content) {
    const patterns = [
      /对方[：:]\s*([^\n,，]+)/,
      /商户[：:]\s*([^\n,，]+)/,
      /([^支付付款消费]+)(店|超市|餐厅|医院|公司)/
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) return match[1].trim();
    }

    return '';
  },

  _calcConfidence(result) {
    let score = 0;
    if (result.amount > 0) score += 50;
    if (result.type !== 'unknown') score += 30;
    if (result.source || result.note) score += 20;
    return Math.min(100, score);
  }
};
