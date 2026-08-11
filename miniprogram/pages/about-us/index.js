const app = getApp();

Page({
  data: {},

  goHonors() {
    wx.navigateTo({ url: '/pages/honors/index' });
  },

  onShareAppMessage() {
    return {
      title: '综合训练馆 · 让每一个普通人成为自己的英雄',
      path: '/pages/about-us/index'
    };
  }
});
