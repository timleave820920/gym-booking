const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    level: null,
    cardNo: '',
    user: { name: '微信用户' },
    balance: '0.00'
  },

  onLoad() {
    this.load();
  },

  load() {
    const u = app.globalData.userInfo || {};
    const openid = u.openid || wx.getStorageSync('openid');
    const name = (u.name && u.name !== '小陈同学') ? u.name : '微信用户';
    if (!openid) return;
    api.getMemberLevel(openid).then((res) => {
      const lv = res.level;
      this.setData({
        level: { name: lv.levelName, lv: lv.levelLv, icon: lv.levelIcon || '🏅' },
        balance: (lv.balanceFen / 100).toFixed(2),
        user: { name },
        cardNo: 'NO. 2026 ' + String(openid.length > 6 ? openid.slice(-4) : openid).padStart(4, '0')
      });
    }).catch(() => {});
    // 次卡信息
    api.getMyPass(openid).then((r) => {
      const info = r.pass;
      if (info && info.hasPass) {
        this.setData({ passInfo: info });
      } else {
        this.setData({ passInfo: null });
      }
    }).catch(() => {});
  },

  goPass() {
    wx.navigateTo({ url: '/pages/passes-buy/index' });
  },

  go(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  }
});
