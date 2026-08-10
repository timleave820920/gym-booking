const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    course: null,
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
    wx.showLoading({ title: '支付中...' });
    setTimeout(() => {
      this.confirmBook();
    }, 800);
  },

  // 支付成功 → 真实订课落库
  confirmBook() {
    const course = this.data.course;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');

    if (!openid) {
      wx.hideLoading();
      wx.showToast({ title: '未登录，请先登录', icon: 'none' });
      return;
    }

    api.bookCourse({
      openid,
      sessionId: course.session_id || course.id,
      amountFen: Math.round((course.price || 68) * 100),
      payStatus: 'paid'
    }).then((res) => {
      wx.hideLoading();
      // 跳转支付成功落地页
      wx.redirectTo({ url: '/pages/pay-success/index' });
    }).catch((err) => {
      wx.hideLoading();
      wx.showModal({
        title: '预订失败',
        content: err.message || '无法连接服务器，请稍后重试',
        showCancel: false,
        confirmText: '知道了'
      });
    });
  }
});
