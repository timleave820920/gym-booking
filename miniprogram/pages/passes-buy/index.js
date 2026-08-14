const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    packages: [],
    currentPass: null,      // 我的当前卡（累加展示）
    balance: 0,
    selected: null,
    paying: false
  },

  onLoad() {
    this.load();
  },

  load() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    api.getPassPackages().then((res) => {
      // 单价 = 价格 / 次数，向下取整到元（¥900/12次 = ¥75/次）
      const pkgs = (res.packages || []).map(p => ({
        ...p,
        unitPrice: Math.floor((p.price_fen / 100) / (p.total_count || 1))
      }));
      this.setData({ packages: pkgs });
      // 默认选中第一个
      const sel = pkgs.length ? pkgs[0] : null;
      if (pkgs.length && !this.data.selected) {
        this.setData({ selected: pkgs[0] });
      }
    }).catch(() => {});
    if (openid) {
      api.getMyPass(openid).then((r) => {
        const info = r.pass;
        this.setData({ currentPass: info && info.hasPass ? info : null });
      }).catch(() => {});
      api.getMemberLevel(openid).then((r) => {
        this.setData({ balance: (r.level.balanceFen || 0) / 100 });
      }).catch(() => {});
    }
  },

  selectPkg(e) {
    const id = e.currentTarget.dataset.id;
    const pkg = this.data.packages.find(p => p.id === id);
    this.setData({ selected: pkg });
  },

  // 支付：下单(orderType=pass) → 模拟支付 → 刷新
  buy() {
    const pkg = this.data.selected;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!pkg) return wx.showToast({ title: '请选择次卡档位', icon: 'none' });
    if (!openid) return wx.showToast({ title: '请先登录', icon: 'none' });
    if (this.data.paying) return;
    this.setData({ paying: true });
    wx.showLoading({ title: '下单中...' });
    api.createOrder({
      openid,
      orderType: 'pass',
      amountFen: pkg.price_fen
    }).then((res) => {
      // 次卡购买默认用余额支付（余额不足则提示充值）；模拟支付
      wx.showLoading({ title: '支付中...' });
      setTimeout(() => {
        api.payOrder(res.order.id, { openid, payMethod: 'balance' }).then(() => {
          wx.hideLoading();
          this.setData({ paying: false });
          wx.showToast({ title: '次卡已到账', icon: 'success' });
          this.load();
        }).catch((err) => {
          wx.hideLoading();
          this.setData({ paying: false });
          wx.showModal({
            title: '支付失败',
            content: err.message || '支付失败，请重试',
            showCancel: false,
            confirmText: '知道了'
          });
        });
      }, 800);
    }).catch((err) => {
      wx.hideLoading();
      this.setData({ paying: false });
      wx.showToast({ title: err.message || '下单失败', icon: 'none' });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
