const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    course: null,
    order: null,
    payMethods: [
      { id: 1, name: '微信支付', desc: '推荐使用', icon: 'wallet', selected: true },
      { id: 2, name: '余额支付', desc: '余额 ¥ 128.50', icon: 'card', selected: false }
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
  },

  selectMethod(e) {
    const id = e.currentTarget.dataset.id;
    const payMethods = this.data.payMethods.map(m => ({
      ...m, selected: m.id === id
    }));
    this.setData({ payMethods });
  },

  pay() {
    const course = this.data.course;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录，请先登录', icon: 'none' });
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
