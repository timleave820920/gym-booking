const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    balance: 0,
    todayEarned: 0,
    dailyLimit: 0,
    items: [],
    exchanges: [],
    earnRules: null,
    showCode: null        // 兑换成功弹窗（虚拟奖品含码）
  },

  onLoad() {
    this.load();
  },

  onShow() {
    this.load();
  },

  load() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getCoinBalance(openid).then((res) => {
      this.setData({
        balance: res.balance,
        todayEarned: res.todayEarned,
        dailyLimit: res.dailyLimit
      });
    }).catch(() => {});
    api.getCoinShop(openid).then((res) => {
      const items = (res.items || []).map(i => ({
        id: i.id,
        name: i.name,
        cost: i.cost,
        desc: i.desc,
        type: i.type,
        typeText: i.type === 'physical' ? '实物' : '虚拟',
        stockText: i.stockLeft < 0 ? '不限量' : `剩 ${i.stockLeft} 件`,
        soldOut: i.soldOut
      }));
      this.setData({ items });
    }).catch(() => {});
    api.getCoinConfig().then((res) => {
      this.setData({ earnRules: res.config ? res.config.earnRules : null });
    }).catch(() => {});
    api.getMyExchanges(openid).then((res) => {
      const exchanges = (res.exchanges || []).map(e => ({
        id: e.id,
        name: e.item_name,
        cost: e.cost,
        code: e.code,
        statusText: e.status === 'claimed' ? '已领取' : '待领取',
        time: e.created_at
      }));
      this.setData({ exchanges });
    }).catch(() => {});
  },

  // 兑换奖品
  exchange(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.find(i => i.id === id);
    if (!item || item.soldOut) return;
    if (this.data.balance < item.cost) {
      wx.showModal({
        title: '能量币不足',
        content: `兑换「${item.name}」需要 ${item.cost} 币，当前 ${this.data.balance} 币。通过签到、上课、邀请、充值、升级可获得能量币。`,
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    wx.showModal({
      title: '确认兑换',
      content: `消耗 ${item.cost} 能量币兑换「${item.name}」？`,
      confirmText: '兑换',
      success: (r) => {
        if (r.confirm) {
          api.exchangeCoin(openid, id).then((res) => {
            wx.showToast({ title: '兑换成功', icon: 'success' });
            this.setData({
              showCode: {
                name: res.exchange.item_name,
                code: res.exchange.code,
                cost: res.exchange.cost
              }
            });
            this.load();
          }).catch((err) => {
            wx.showToast({ title: err.message || '兑换失败', icon: 'none' });
          });
        }
      }
    });
  },

  closeCode() {
    this.setData({ showCode: null });
  },

  // 获取规则说明 → 独立规则页
  showRules() {
    wx.navigateTo({ url: '/pages/coin-rules/index' });
  }
});
