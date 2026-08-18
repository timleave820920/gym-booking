const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    course: null,
    order: null,
    memberLevel: null,     // 会员等级（折扣）
    balance: 0,            // 储值余额
    memberPrice: 0,        // 储值支付折扣价
    canBalancePay: false,  // 余额是否够
    totalPrice: 0,         // 当前选中支付方式的结算价
    payText: '含课程费用',   // 结算价说明
    payMethods: [
      { id: 2, name: '余额支付', desc: '余额 ¥ 0.00', icon: 'card', selected: false },
      { id: 1, name: '微信支付', desc: '推荐使用', icon: 'wallet', selected: true }
    ],
    // 候补自动取消节点：start=开课时 / 1h=课前1小时 / 2h=课前2小时
    expireModes: [
      { id: 'start', name: '开课时', desc: '排到开课' },
      { id: '1h', name: '课前 1 小时', desc: '提前 1 小时' },
      { id: '2h', name: '课前 2 小时', desc: '提前 2 小时' }
    ],
    selectedExpire: 'start',
    passHint: '',          // 次卡优先提示（有可用次卡时显示）
    usePass: false,        // 有可用次卡 → 强制次卡支付（支付方式区置灰、不默认选中）
    passRemaining: 0,      // 次卡剩余次数
    passExpired: false,    // 有卡但对所选场次日期不可用（次数包已过期）→ 只能用储值/微信支付
    wxpayEnabled: false    // 微信支付开通状态（商户号未配置 → 禁用微信支付选项，B2 2026-08-18）
  },

  onLoad() {
    const course = app.globalData.currentCourse || {
      name: 'HIIT 高强度燃脂训练',
      coach: '阿凯',
      coachAvatar: '',
      venue: 'A馆',
      time: '10:00-11:00',
      dateText: '',
      price: 68
    };
    this.setData({ course });
    // B2：查询微信支付开通状态（未开通 → 微信支付置灰「商户号配置后开放」）
    api.wxpayStatus().then((res) => {
      const enabled = !!(res && res.enabled);
      this.setData({
        wxpayEnabled: enabled,
        // 同步微信支付选项文案/禁用态（desc 后端 status 接口为准）
        payMethods: this.data.payMethods.map(m => m.id === 1
          ? { ...m, desc: enabled ? '推荐使用' : '商户号配置后开放', disabled: !enabled }
          : m)
      });
    }).catch(() => {
      // 查询失败保守处理：保持禁用（避免点击后被后端 400 拒绝的体验）
      this.setData({
        payMethods: this.data.payMethods.map(m => m.id === 1
          ? { ...m, desc: '商户号配置后开放', disabled: true }
          : m)
      });
    });
  },

  // 2026-08-15: 每次回到页面刷新余额/次卡——修复「充值返回后仍显示余额不足」
  // （原逻辑只在 onLoad 加载一次，充值返回后余额不更新导致无法继续支付）
  onShow() {
    this.loadMemberInfo();
    this.loadPassHint();
  },

  // 次卡：有可用次卡 → 加入「次卡抵扣」选项并默认选中；用户可切换储值/微信（2026-08-15）
  loadPassHint() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    // 2026-08-15: 传上课日期判断——卡今天过期不能订明天及以后场次
    const date = (this.data.course && this.data.course.date) || '';
    api.getPassAvailable(openid, date).then((res) => {
      if (res.available > 0) {
        // 加入次卡选项（若尚未存在）并默认选中
        const hasPassItem = this.data.payMethods.some(m => m.id === 3);
        const payMethods = hasPassItem
          ? this.data.payMethods.map(m => ({ ...m, selected: m.id === 3 }))
          : [
              ...this.data.payMethods.map(m => ({ ...m, selected: false })),
              { id: 3, name: '次卡抵扣', desc: `本次扣 1 次（剩余 ${res.available} 次）`, icon: 'pass', selected: true }
            ];
        this.setData({
          passHint: `已默认选择次卡抵扣（剩余 ${res.available} 次），可切换储值或微信支付`,
          usePass: true,
          passExpired: false,
          passRemaining: res.available,
          payMethods
        });
        this.computeTotal();
      } else if (res.expiredForDate) {
        // 有次卡但对本次场次不可用（已过期/不覆盖上课日）→ 提示只能用储值/微信
        this.setData({
          passHint: '次数包已过期，本次只能用储值或微信支付',
          usePass: false,
          passExpired: true,
          payMethods: this.data.payMethods.filter(m => m.id !== 3)
        });
        this.computeTotal();
      } else {
        // 无次卡：清除可能的次卡选项
        this.setData({
          passHint: '',
          usePass: false,
          passExpired: false,
          payMethods: this.data.payMethods.filter(m => m.id !== 3)
        });
      }
    }).catch(() => {});
  },

  // 加载会员等级 + 储值余额 → 计算折扣价；余额够则默认选中余额支付
  loadMemberInfo() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getMemberLevel(openid).then((res) => {
      const lv = res.level;
      const price = Number(this.data.course.price || 68);
      // 会员价 = 原价 × 折扣率，向下取整到元（无角分）
      const memberPrice = Math.floor(price * lv.discount);
      const balance = (lv.balanceFen / 100);
      // 余额足够 → 默认选中余额支付（订课与候补排位均享会员价，产品决策 2026-08-13，BUG-LEDGER #9）
      const canBalancePay = balance >= memberPrice;
      // 折扣文案：0.98 → 98折（整十转 X 折，如 0.9 → 9折）
      const dp = Math.round(lv.discount * 100);
      lv.discountText = dp % 10 === 0 ? (dp / 10) + '折' : dp + '折';
      this.setData({
        memberLevel: lv,
        balance,
        memberPrice,
        canBalancePay,
      // 有可用次卡 → 保持次卡默认选中（2026-08-15: 修复与 loadPassHint 的竞态——次卡已加载时
      // 不得被 loadMemberInfo 的选中逻辑覆盖成"全不选中"）；无次卡 → 余额足够默认选中余额支付
      payMethods: this.data.payMethods.map(m => {
        const keepPass = this.data.usePass && m.id === 3;
        return {
          ...m,
          selected: keepPass || (!this.data.usePass && m.id === (canBalancePay ? 2 : 1)),
          desc: m.id === 2 ? `余额 ¥ ${balance.toFixed(2)}` : m.desc
        };
      })
      });
      this.computeTotal();
    }).catch(() => {});
  },

  // 计算当前选中支付方式的结算价（余额支付 → 会员价；微信 → 原价；候补排位同样适用）
  // 有次卡 → 金额 0（后端 effMethod=pass，扣次不扣钱）
  computeTotal() {
    const price = Number(this.data.course.price || 68);
    if (this.data.usePass) {
      this.setData({ totalPrice: 0, payText: `次数包抵扣 · 剩余 ${this.data.passRemaining} 次` });
      return;
    }
    const selected = this.data.payMethods.find(m => m.selected);
    const useMember = selected && selected.id === 2
      && this.data.memberLevel && this.data.memberLevel.discount < 1;
    const total = useMember ? this.data.memberPrice : price;
    this.setData({
      totalPrice: total,
      payText: useMember ? `会员价 · 立省¥${price - total}` : '含课程费用'
    });
  },

  selectExpire(e) {
    this.setData({ selectedExpire: e.currentTarget.dataset.id });
  },

  selectMethod(e) {
    // 2026-08-15: 有次卡也可切换支付方式——次卡(3)/储值(2)/微信(1) 自由选择，默认选中次卡
    const id = e.currentTarget.dataset.id;
    const target = this.data.payMethods.find(m => m.id === id);
    // B2：微信支付未开通 → 选项置灰不可选（JS 拦截双保险，wxml 侧 pointer-events 已拦）
    if (target && target.disabled) {
      wx.showToast({ title: '微信支付暂未开通（商户号配置后开放）', icon: 'none' });
      return;
    }
    const payMethods = this.data.payMethods.map(m => ({
      ...m, selected: m.id === id
    }));
    const usePass = id === 3;
    this.setData({ payMethods, usePass });
    this.computeTotal();   // 切换方式 → 结算价联动
  },

  pay() {
    // 防连点锁（BUG-LEDGER #13）：支付中再次点击直接忽略，请求结束才解锁
    if (this._paying) return;
    const course = this.data.course;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录，请先登录', icon: 'none' });
      return;
    }
    // 余额支付预校验（余额不足拦截；有次卡时跳过——本次走次卡不扣余额）
    const selected = this.data.payMethods.find(m => m.selected);
    // B2：微信支付未开通 → 拦截（商户号配置后开放）
    if (!this.data.usePass && selected && selected.id === 1 && !this.data.wxpayEnabled) {
      wx.showModal({
        title: '微信支付暂未开通',
        content: '商户号配置后开放。当前可用储值余额或次卡支付。',
        confirmText: '知道了',
        showCancel: false
      });
      return;
    }
    if (!this.data.usePass && selected && selected.id === 2 && !this.data.canBalancePay) {
      wx.showModal({
        title: '余额不足',
        content: `当前余额 ¥${this.data.balance.toFixed(2)}，本次储值支付需 ¥${this.data.memberPrice || 0}。请先充值或改用微信支付。`,
        confirmText: '去充值',
        cancelText: '知道了',
        success: (r) => {
          if (r.confirm) wx.navigateTo({ url: '/pages/member-recharge/index' });
        }
      });
      return;
    }
    this._paying = true;
    wx.showLoading({ title: '下单中...' });

    // 第一步：创建待支付订单
    api.createOrder({
      openid,
      sessionId: course.session_id || course.id,
      amountFen: Math.round((course.price || 68) * 100),
      orderType: course.mode === 'waitlist' ? 'waitlist' : 'book',
      expireMode: course.mode === 'waitlist' ? this.data.selectedExpire : undefined
    }).then((res) => {
      this.setData({ order: res.order });
      wx.showLoading({ title: '支付中...' });
      // 第二步：余额/次卡支付回写落库（微信支付走 wxpayFlow 真实链路）
      setTimeout(() => this.confirmPay(res.order.id, openid), 800);
    }).catch((err) => {
      this._paying = false;
      wx.hideLoading();
      wx.showModal({
        title: '下单失败',
        content: err.message || '无法连接服务器，请稍后重试',
        showCancel: false,
        confirmText: '知道了'
      });
    });
  },

  // 支付回写：订单 pending → paid + 生成订课/候补
  // 微信支付走真实链路（统一下单 → wx.requestPayment → 轮询回调落库）；余额/次卡直接回写
  confirmPay(orderId, openid) {
    // 有可用次卡 → payMethod 传 pass（后端 effMethod=pass 强制次卡，金额 0）
    // 无次卡 → 按用户选中：微信=wxpay / 余额=balance
    const selected = this.data.payMethods.find(m => m.selected);
    const payMethod = this.data.usePass ? 'pass' : (selected && selected.id === 1 ? 'wxpay' : 'balance');
    if (payMethod === 'wxpay') {
      this.wxpayFlow(orderId, openid);
      return;
    }
    api.payOrder(orderId, { openid, payMethod }).then((res) => {
      this._paying = false;
      wx.hideLoading();
      this.finishPay(res.order);
    }).catch((err) => {
      this._paying = false;
      wx.hideLoading();
      wx.showModal({
        title: '支付失败',
        content: err.message || '无法连接服务器，请稍后重试',
        showCancel: false,
        confirmText: '知道了'
      });
    });
  },

  // B2（2026-08-18）：微信支付链路——统一下单 → wx.requestPayment → 轮询订单至 paid
  wxpayFlow(orderId, openid) {
    api.wxpayCreate({ orderId, openid }).then((res) => {
      const p = res.payParams;
      if (!p || !p.package) {
        this._paying = false;
        wx.hideLoading();
        wx.showModal({ title: '支付失败', content: '微信支付参数异常，请重试', showCancel: false, confirmText: '知道了' });
        return;
      }
      wx.requestPayment({
        timeStamp: p.timeStamp,
        nonceStr: p.nonceStr,
        package: p.package,
        signType: p.signType || 'RSA',
        paySign: p.paySign,
        success: () => this.pollPaid(orderId, openid, 0),
        fail: (e) => {
          this._paying = false;
          wx.hideLoading();
          if (e && (e.errMsg || '').indexOf('cancel') >= 0) {
            wx.showToast({ title: '已取消支付', icon: 'none' });
          } else {
            wx.showToast({ title: '支付未完成，请重试', icon: 'none' });
          }
        }
      });
    }).catch((err) => {
      this._paying = false;
      wx.hideLoading();
      wx.showModal({
        title: '支付失败',
        content: err.message || '无法连接服务器，请稍后重试',
        showCancel: false,
        confirmText: '知道了'
      });
    });
  },

  // B2：微信支付成功 → 轮询订单至 paid（微信回调落库有延迟）；10 次 × 1.5s 上限
  pollPaid(orderId, openid, tries) {
    api.getMyOrders(openid).then((res) => {
      const order = (res.orders || []).find(o => o.id === orderId);
      if (order && order.status === 'paid') {
        this._paying = false;
        wx.hideLoading();
        this.finishPay(order);
      } else if (tries < 10) {
        setTimeout(() => this.pollPaid(orderId, openid, tries + 1), 1500);
      } else {
        this._paying = false;
        wx.hideLoading();
        wx.showModal({
          title: '支付结果确认中',
          content: '支付已提交，稍后自动生效。可在「我的订单」查看结果。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
    }).catch(() => {
      if (tries < 10) {
        setTimeout(() => this.pollPaid(orderId, openid, tries + 1), 1500);
      } else {
        this._paying = false;
        wx.hideLoading();
        wx.showModal({
          title: '支付结果确认中',
          content: '支付已提交，稍后自动生效。可在「我的订单」查看结果。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  // 支付落地：写全局 payResult → 跳转成功页（balance/pass 用支付回写结果；wxpay 用轮询到的订单）
  finishPay(order) {
    const isWaitlist = this.data.course.mode === 'waitlist';
    // 实付金额落全局（后端支付回写时订单金额已修正为实付：次卡=0/余额=会员折扣价/微信=原价）
    // 注意：次卡支付 amount_fen=0 也是有效值，不能用 truthy 判断（BUG 修复：0 会被误判为缺失回退原价）
    const paidFen = order && order.amount_fen;
    const usedPass = order && order.pay_source === 'pass';
    app.globalData.payResult = {
      amount: paidFen != null ? String((paidFen / 100).toFixed(0)) : String(Number(this.data.course.price) || 0),
      paySource: usedPass ? 'pass' : (order && order.pay_source) || '',
      isWaitlist
    };
    // 跳转支付成功落地页（携带模式）
    wx.redirectTo({ url: '/pages/pay-success/index' + (isWaitlist ? '?mode=waitlist' : '') });
  }
});
