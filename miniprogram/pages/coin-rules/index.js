const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    rules: [],
    dailyLimitText: '',
    loading: true
  },

  onLoad() {
    api.getCoinConfig().then((res) => {
      const cfg = res.config || {};
      const r = cfg.earnRules || {};
      const rules = [
        { icon: '📍', name: '到店签到', desc: '每次到店核销签到', reward: `+${r.checkin || 0} 币` },
        { icon: '💪', name: '完成一节课', desc: '签到成功时额外发放', reward: `+${r.attendClass || 0} 币` },
        { icon: '🤝', name: '邀请好友', desc: '每成功邀请 1 位好友', reward: `+${r.invite || 0} 币` },
        { icon: '💰', name: '储值充值', desc: '每充值 ¥100', reward: `+${r.recharge || 0} 币` },
        { icon: '⭐', name: '会员升级', desc: '每次升级到更高等级', reward: `+${r.levelUp || 0} 币` }
      ];
      this.setData({
        rules,
        dailyLimitText: cfg.dailyLimit ? `每日获取上限 ${cfg.dailyLimit} 币，防止刷币` : '每日获取不限量',
        loading: false
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
