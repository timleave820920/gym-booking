const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    level: null,
    levels: [],
    currentIdx: 0
  },

  onLoad() {
    this.load();
  },

  load() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    // 等级配置从 member-config 接口动态读取（改配置即生效）
    api.getMemberConfig().then((res) => {
      const cfg = res.config || {};
      const styles = cfg.levelStyles || [];
      const levels = (cfg.levels || []).map(l => {
        const st = styles.find(s => s.name === l.name) || {};
        return {
          name: l.name,
          roman: st.roman || '',
          color: st.color || '#888888',
          min: l.min,
          discountText: l.discountText || Math.round(l.discount * 100) + ' 折'
        };
      });
      this.setData({ levels });
      // 等级信息
      api.getMemberLevel(openid).then((res2) => {
        const lv = res2.level;
        const idx = levels.findIndex(l => l.name === lv.levelName);
        this.setData({
          level: {
            name: lv.levelName,
            lv: lv.levelLv,
            progress: lv.progress,
            total: lv.totalClasses,
            nextName: lv.next ? lv.next.name : null,
            nextMin: lv.next ? lv.next.min : null,
            hint: lv.next ? `再上 ${lv.next.min - lv.totalClasses} 节课升级${lv.next.name}，解锁会员价 ${Math.round(lv.next.discount * 100)} 折` : '已达最高等级钻石会员'
          },
          currentIdx: idx >= 0 ? idx : 0
        });
      }).catch(() => {});
    }).catch(() => {});
  },

  goRecharge() {
    wx.navigateTo({ url: '/pages/member-recharge/index' });
  }
});
