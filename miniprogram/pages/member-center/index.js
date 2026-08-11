const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    level: null,       // 会员等级+余额
    rewards: 0,        // 未读奖励数
    loaded: false
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    this.loadData();
  },

  loadData() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    // 等级+余额
    api.getMemberLevel(openid).then((res) => {
      const lv = res.level;
      this.setData({
        level: {
          name: lv.levelName,
          lv: lv.levelLv,
          discount: Math.round(lv.discount * 10),
          progress: lv.progress,
          balance: (lv.balanceFen / 100).toFixed(2),
          totalClasses: lv.totalClasses,
          nextName: lv.next ? lv.next.name : 'MAX',
          nextMin: lv.next ? lv.next.min : null,
          hint: lv.next ? `再上 ${lv.next.min - lv.totalClasses} 节课升级${lv.next.name} · 会员价 ${Math.round(lv.next.discount * 10)} 折` : '已达最高等级'
        },
        loaded: true
      });
    }).catch(() => {
      this.setData({ loaded: true });
    });
    // 未读奖励数
    api.getMyRewards(openid).then((res) => {
      this.setData({ rewards: (res.rewards || []).length });
    }).catch(() => {});
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  goRecharge() {
    wx.navigateTo({ url: '/pages/member-recharge/index' });
  },

  goCourses() {
    wx.switchTab({ url: '/pages/student-courses/index' });
  },

  // 领取奖励 → 跳电子卡页看余额
  claimReward() {
    wx.navigateTo({ url: '/pages/member-card/index' });
  }
});
