const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    level: null,       // 会员等级+余额
    coins: null,       // 能量币余额
    rewards: 0,        // 未读奖励数
    loaded: false,
    gridSubs: { level: '会员折扣', recharge: '充值优惠', invite: '各得储值', honor: '荣誉展示' }
  },

  onShow() {
    // tab 页：每次显示刷新数据 + 高亮 tabBar
    this.loadData();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  onShow() {
    this.loadData();
  },

  loadData() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    // 能量币余额
    api.getCoinBalance(openid).then((res) => {
      this.setData({ coins: res.balance });
    }).catch(() => {});
    // 宫格副标题从配置动态读取
    api.getMemberConfig().then((res) => {
      const cfg = res.config || {};
      const secondLevel = (cfg.levels || [])[1];
      const recPlan = (cfg.rechargePlans || []).find(p => p.id === 2);
      this.setData({
        gridSubs: {
          level: secondLevel ? `${secondLevel.name}${secondLevel.discountText}` : '会员折扣',
          recharge: recPlan ? `充${recPlan.amountYuan}送${recPlan.bonusYuan}` : '充值优惠',
          invite: cfg.inviteRewards && cfg.inviteRewards[0] ? `各得¥${cfg.inviteRewards[0].rewardYuan}` : '各得储值',
          honor: '荣誉展示'
        }
      });
    }).catch(() => {});
    // 等级+余额
    api.getMemberLevel(openid).then((res) => {
      const lv = res.level;
      this.setData({
        level: {
          name: lv.levelName,
          lv: lv.levelLv,
          icon: lv.levelIcon || '🏅',
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

  // 能量商店
  goCoinShop() {
    wx.navigateTo({ url: '/pages/coin-shop/index' });
  },

  goCourses() {
    wx.switchTab({ url: '/pages/student-courses/index' });
  },

  // 领取奖励 → 跳电子卡页看余额
  claimReward() {
    wx.navigateTo({ url: '/pages/member-card/index' });
  }
});
