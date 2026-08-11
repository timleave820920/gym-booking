const app = getApp();
const api = require('../../utils/api.js');

const LEVELS = [
  { name: '青铜', roman: 'Ⅰ', color: '#D89C4C', min: 0, discount: 9 },
  { name: '黄金', roman: 'Ⅱ', color: '#F2C43B', min: 20, discount: 85 },
  { name: '铂金', roman: 'Ⅲ', color: '#B8CCF2', min: 50, discount: 8 },
  { name: '钻石', roman: 'Ⅳ', color: '#8C84F2', min: 100, discount: 75 }
];

Page({
  data: {
    level: null,
    levels: LEVELS,
    currentIdx: 0
  },

  onLoad() {
    this.load();
  },

  load() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getMemberLevel(openid).then((res) => {
      const lv = res.level;
      const idx = LEVELS.findIndex(l => l.name === lv.levelName);
      this.setData({
        level: {
          name: lv.levelName,
          lv: lv.levelLv,
          discount: Math.round(lv.discount * 10),
          progress: lv.progress,
          total: lv.totalClasses,
          nextName: lv.next ? lv.next.name : null,
          nextMin: lv.next ? lv.next.min : null,
          hint: lv.next ? `再上 ${lv.next.min - lv.totalClasses} 节课升级${lv.next.name}，解锁会员价 ${Math.round(lv.next.discount * 10)} 折` : '已达最高等级钻石会员'
        },
        currentIdx: idx >= 0 ? idx : 0
      });
    }).catch(() => {});
  },

  goRecharge() {
    wx.navigateTo({ url: '/pages/member-recharge/index' });
  }
});
