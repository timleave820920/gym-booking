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
      { id: 1, name: '微信支付', desc: '推荐使用', icon: 'wallet', selected: true },
      { id: 2, name: '余额支付', desc: '余额 ¥ 0.00', icon: 'card', selected: false }
    ]
  },

  onLoad() {
    const course = app.globalData.currentCourse || {
      name: 'HIIT 高强度燃脂训练',
      coach: '阿凯',
      venue: 'A馆',
      time: '10:00-11:00',
      price: 68,
      img: '/images/3_24.png'
    };
    this.setData({ course });
    this.loadMemberInfo();
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
      // 候补排位不享会员折扣，不自动选余额
      const isWaitlist = this.data.course.mode === 'waitlist';
      const canBalancePay = !isWaitlist && balance >= memberPrice;
      // 折扣文案：0.98 → 98折（整十转 X 折，如 0.9 → 9折）
      const dp = Math.round(lv.discount * 100);
      lv.discountText = dp % 10 === 0 ? (dp / 10) + '折' : dp + '折';
      this.setData({
        memberLevel: lv,
        balance,
        memberPrice,
        canBalancePay,
        // 余额足够 → 默认选中余额支付（享受会员价）
        payMethods: this.data.payMethods.map(m => ({
          ...m,
          selected: m.id === (canBalancePay ? 2 : 1),
          desc: m.id === 2 ? `余额 ¥ ${balance.toFixed(2)}` : m.desc
        }))
      });
      this.computeTotal();
    }).catch(() => {});
  },

  // 计算当前选中支付方式的结算价（余额支付 → 会员价；微信 → 原价）
  computeTotal() {
    const price = Number(this.data.course.price || 68);
    const selected = this.data.payMethods.find(m => m.selected);
    const isWaitlist = this.data.course.mode === 'waitlist';
    const useMember = selected && selected.id === 2 && !isWaitlist
      && this.data.memberLevel && this.data.memberLevel.discount < 1;
    const total = useMember ? this.data.memberPrice : price;
    this.setData({
      totalPrice: total,
      payText: useMember ? `会员价 · 立省¥${price - total}` : '含课程费用'
    });
  },

  selectMethod(e) {
    const id = e.currentTarget.dataset.id;
    const payMethods = this.data.payMethods.map(m => ({
      ...m, selected: m.id === id
    }));
    this.setData({ payMethods });
    this.computeTotal();   // 切换方式 → 结算价联动
  },

  pay() {
    const course = this.data.course;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录，请先登录', icon: 'none' });
      return;
    }
    // 余额支付预校验（余额不足拦截）
    const selected = this.data.payMethods.find(m => m.selected);
    if (selected && selected.id === 2 && !this.data.canBalancePay) {
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
    wx.showLoading({ title: '下单中...' });

    // 第一步：创建待支付订单
    api.createOrder({
      openid,
      sessionId: course.session_id || course.id,
      amountFen: Math.round((course.price || 68) * 100),
      orderType: course.mode === 'waitlist' ? 'waitlist' : 'book'
    }).then((res) => {
      this.setData({ order: res.order });
      wx.showLoading({ title: '支付中...' });
      // 第二步：模拟支付成功后，支付回写落库
      setTimeout(() => this.confirmPay(res.order.id, openid), 800);
    }).catch((err) => {
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
  confirmPay(orderId, openid) {
    const selected = this.data.payMethods.find(m => m.selected);
    const payMethod = selected && selected.id === 1 ? 'wxpay' : 'balance';
    api.payOrder(orderId, { openid, payMethod }).then((res) => {
      wx.hideLoading();
      const isWaitlist = this.data.course.mode === 'waitlist';
      // 跳转支付成功落地页（携带模式）
      wx.redirectTo({ url: '/pages/pay-success/index' + (isWaitlist ? '?mode=waitlist' : '') });
    }).catch((err) => {
      wx.hideLoading();
      wx.showModal({
        title: '支付失败',
        content: err.message || '无法连接服务器，请稍后重试',
        showCancel: false,
        confirmText: '知道了'
      });
    });
  }
});
