const app = getApp();

Page({
  data: {},

  onLoad() {},

  onShareAppMessage() {
    return {
      title: '综合训练馆 · 联系客服',
      path: '/pages/contact-us/index'
    };
  }
});
