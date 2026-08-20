const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    packages: [],
    currentPass: null,      // 我的当前次卡（累加展示）
    unlPlans: [],           // 无限次卡档位（季卡/年卡，运营配置动态读取）
    currentUnl: null,       // 我的无限次卡（hasPass/daysLeft/expiresAt）
    balance: 0,
    selected: null,         // 选中次卡档位
    selectedUnl: null,      // 选中无限次卡档位
    activeTab: 'pass',      // 当前 CTA 指向：pass 次卡 / unl 无限次卡
    paying: false
  },

  onLoad() {
    // 状态栏高度：顶部导航与微信胶囊按钮水平对齐（2026-08-19）
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarH: win.statusBarHeight || 20 });
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
      // 默认选中第一个（仅在当前选中不是无限次卡时）
      if (pkgs.length && !this.data.selected && this.data.activeTab !== 'unl') {
        this.setData({ selected: pkgs[0] });
      }
    }).catch(() => {});
    // 无限次卡档位（DESIGN #D14：季卡/年卡，价格运营配置）
    api.getUnlimitedPlans().then((res) => {
      const plans = (res.plans || []).map(p => ({
        ...p,
        days: p.months * 30
      }));
      this.setData({ unlPlans: plans });
      // 默认选中第一档
      if (plans.length && !this.data.selectedUnl && this.data.activeTab === 'unl') {
        this.setData({ selectedUnl: plans[0] });
      }
    }).catch(() => {});
    if (openid) {
      api.getMyPass(openid).then((r) => {
        const info = r.pass;
        this.setData({ currentPass: info && info.hasPass ? info : null });
      }).catch(() => {});
      api.getUnlimitedPass(openid).then((r) => {
        this.setData({ currentUnl: r.hasPass ? r : null });
      }).catch(() => {});
      api.getMemberLevel(openid).then((r) => {
        this.setData({ balance: (r.level.balanceFen || 0) / 100 });
      }).catch(() => {});
    }
  },

  selectPkg(e) {
    const id = e.currentTarget.dataset.id;
    const pkg = this.data.packages.find(p => p.id === id);
    this.setData({ selected: pkg, activeTab: 'pass' });
  },

  selectUnl(e) {
    const id = e.currentTarget.dataset.id;
    const plan = this.data.unlPlans.find(p => p.id === id);
    this.setData({ selectedUnl: plan, activeTab: 'unl' });
  },

  // 支付：下单(pass/unlimited) → 模拟支付 → 刷新
  buy() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return wx.showToast({ title: '请先登录', icon: 'none' });
    if (this.data.paying) return;
    const isUnl = this.data.activeTab === 'unl';
    const pkg = isUnl ? this.data.selectedUnl : this.data.selected;
    if (!pkg) return wx.showToast({ title: isUnl ? '请选择卡档位' : '请选择次卡档位', icon: 'none' });
    this.setData({ paying: true });
    wx.showLoading({ title: '下单中...' });
    api.createOrder({
      openid,
      orderType: isUnl ? 'unlimited' : 'pass',
      amountFen: pkg.price_fen
    }).then((res) => {
      // 卡购买默认用余额支付（余额不足则提示充值）；模拟支付
      wx.showLoading({ title: '支付中...' });
      setTimeout(() => {
        api.payOrder(res.order.id, { openid, payMethod: 'balance' }).then(() => {
          wx.hideLoading();
          this.setData({ paying: false });
          wx.showToast({ title: isUnl ? '开卡成功' : '次卡已到账', icon: 'success' });
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
