const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    balance: '0.00',
    plans: [],
    selectedId: 2,       // 默认选推荐档（500送80）
    recharges: []
  },

  onLoad() {
    this.loadPlans();
    this.loadInfo();
  },

  onShow() {
    this.loadInfo();
  },

  loadPlans() {
    api.getMemberPlans().then((res) => {
      this.setData({ plans: res.plans || [] });
    }).catch(() => {});
  },

  loadInfo() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getMemberLevel(openid).then((res) => {
      this.setData({ balance: (res.level.balanceFen / 100).toFixed(2) });
    }).catch(() => {});
    api.getMyRecharges(openid).then((res) => {
      const list = (res.recharges || []).map(r => ({
        no: r.recharge_no,
        amount: (r.amount_fen / 100).toFixed(0),
        bonus: (r.bonus_fen / 100).toFixed(0),
        total: ((r.amount_fen + r.bonus_fen) / 100).toFixed(0),
        time: r.created_at
      }));
      this.setData({ recharges: list });
    }).catch(() => {});
  },

  selectPlan(e) {
    this.setData({ selectedId: Number(e.currentTarget.dataset.id) });
  },

  // 立即充值 → 下单 → 支付回写（复用订单流程）
  recharge() {
    const plan = this.data.plans.find(p => p.id === this.data.selectedId);
    if (!plan) return;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '下单中...' });
    api.createOrder({
      openid,
      sessionId: 0,
      amountFen: plan.amount,
      orderType: 'recharge'
    }).then((res) => {
      wx.showLoading({ title: '支付中...' });
      setTimeout(() => {
        api.payOrder(res.order.id, { openid, payMethod: 'wxpay' }).then(() => {
          wx.hideLoading();
          wx.showToast({ title: '充值成功', icon: 'success' });
          this.loadInfo();
        }).catch((err) => {
          wx.hideLoading();
          wx.showToast({ title: err.message || '支付失败', icon: 'none' });
        });
      }, 800);
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: err.message || '下单失败', icon: 'none' });
    });
  }
});
