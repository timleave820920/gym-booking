const app = getApp();

Page({
  data: {},

  onLoad() {
    // 状态栏高度：顶部导航与微信胶囊按钮水平对齐（2026-08-19）
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarH: win.statusBarHeight || 20 });
  },

  goHonors() {
    wx.navigateTo({ url: '/pages/honors/index' });
  },

  onShareAppMessage() {
    return {
      title: '综合训练馆 · 让每一个普通人成为自己的英雄',
      path: '/pages/about-us/index'
    };
  },

  // 返回（统一顶部导航，2026-08-19）
  goBack() {
    wx.navigateBack({ delta: 1 });
  }
});
