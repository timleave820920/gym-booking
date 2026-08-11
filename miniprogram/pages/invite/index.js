const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    invited: 0,
    ordered: 0,
    rewards: [],
    currentReward: null,   // 当前进度奖励
    rewardHint: ''
  },

  onLoad() {
    this.load();
    // 打开右上角转发菜单，支持转发分享卡片（携带邀请人参数）
    wx.showShareMenu({ withShareTicket: false });
  },

  // 分享卡片：path 带 ?inviter=openid → 好友点开后由 app.onLaunch 捕获 → 登录后绑定
  onShareAppMessage() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    return {
      title: '综合训练馆邀你一起练！注册并完成首订，双方各得储值奖励',
      path: '/pages/login/index?inviter=' + (openid || ''),
      imageUrl: '/images/2_166.png'
    };
  },

  load() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getInviteStats(openid).then((res) => {
      const rewards = (res.rewards || []).map(r => ({ ...r, achieved: !!r.achieved }));
      // 找下一个未达成奖励
      const next = rewards.find(r => !r.achieved);
      const current = rewards.filter(r => r.achieved).pop();
      this.setData({
        invited: res.invited,
        ordered: res.ordered,
        rewards,
        currentReward: current || null,
        rewardHint: next ? `再邀 ${next.at - res.ordered} 人即可获得 ¥${next.fen / 100} 储值奖励！` : '全部奖励已解锁！'
      });
    }).catch(() => {});
  },

  // 生成邀请分享（简化：复制邀请码）
  // 复制邀请码（兜底：好友手动填写）
  invite() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    wx.setClipboardData({
      data: '综合训练馆邀你一起练！注册并完成首订，双方各得储值奖励。邀请码：' + openid,
      success: () => {
        wx.showToast({ title: '邀请码已复制，发给好友填写吧', icon: 'none' });
      }
    });
  },

  showRules() {
    wx.showModal({
      title: '邀请规则',
      content: '好友通过你的邀请注册并完成 1 次订课后：邀请满 1 人奖励 ¥100 储值；满 3 人再奖 ¥500；满 5 人再奖 ¥1000。奖励自动充入储值余额。',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
