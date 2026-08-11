const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    balance: '0.00',
    plans: [],
    selectedId: 2,       // 默认选中间档（1500）
    recharges: []
  },

  onLoad() {
    this.loadPlans();
    this.loadInfo();
  },

  onShow() {
    this.loadPlans();   // 充值后刷新首充状态
    this.loadInfo();
  },

  loadPlans() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    // 带 openid：后端按首充/复充状态返回赠送金额
    api.getMemberPlans(openid).then((res) => {
      const plans = (res.plans || []).map(p => ({
        ...p,
        // 展示文案：首充送30%（送¥X） / 复充送10%（送¥X）
        bonusText: p.isFirst
          ? `首充送30% 送¥${p.bonusYuan}`
          : `复充送10% 送¥${p.bonusYuan}`,
        tag: p.isFirst ? '首充高赠' : '已充过'
      }));
      this.setData({ plans });
      // 默认选中未首充的中间档；若中间档已充过则选最大档
      if (plans.length) {
        const mid = plans.find(p => p.id === 2);
        const max = plans[plans.length - 1];
        const target = (mid && !mid.isFirst) ? mid : (max && !max.isFirst ? max : plans[0]);
        if (target) this.setData({ selectedId: target.id });
      }
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
