const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    gridSubs: { level: '会员折扣', recharge: '充值优惠', invite: '各得储值', honor: '荣誉展示' }
  },

  onShow() {
    // tab 页：每次显示刷新副标题 + 高亮 tabBar
    this.loadGridSubs();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  // 宫格副标题从配置动态读取
  loadGridSubs() {
    api.getMemberConfig().then((res) => {
      const cfg = res.config || {};
      const secondLevel = (cfg.levels || [])[1];
      const recPlan = (cfg.rechargePlans || []).find(p => p.id === 2);
      this.setData({
        gridSubs: {
          level: secondLevel ? `${secondLevel.name}${secondLevel.discountText}` : '会员折扣',
          recharge: recPlan ? `充${recPlan.amountYuan}送${recPlan.firstBonusYuan}` : '充值优惠',
          invite: cfg.inviteRewards && cfg.inviteRewards[0] ? `各得¥${cfg.inviteRewards[0].rewardYuan}` : '各得储值',
          honor: '荣誉展示'
        }
      });
    }).catch(() => {});
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  // 能量商店
  goCoinShop() {
    wx.navigateTo({ url: '/pages/coin-shop/index' });
  }
});
