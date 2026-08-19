const app = getApp();

const HONORS = [
  {
    id: 1, medal: '金', color: '#F2C43B', title: '2026 城市体能挑战赛 · 团体冠军',
    desc: '教练阿凯带队 · 12 名学员完赛'
  },
  {
    id: 2, medal: '银', color: '#C9CDD3', title: '2025 全国 CrossFit 公开赛 · 亚军',
    desc: '学员陈晓萌晋级全国 50 强'
  },
  {
    id: 3, medal: '铜', color: '#D9A066', title: '2024 城市马拉松接力赛 · 季军',
    desc: '学员团队 4 小时 12 分完赛'
  }
];

Page({
  data: {
    honors: HONORS
  },

  onLoad() {
    // 状态栏高度：顶部导航与微信胶囊按钮水平对齐（2026-08-19）
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarH: win.statusBarHeight || 20 });
  },

  onShareAppMessage() {
    return {
      title: '综合训练馆 · 32 项赛事荣誉',
      path: '/pages/honors/index'
    };
  },

  // 返回（统一顶部导航，2026-08-19）
  goBack() {
    wx.navigateBack({ delta: 1 });
  }
});
