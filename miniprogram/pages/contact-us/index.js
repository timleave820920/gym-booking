const app = getApp();

Page({
  data: {
    qrAssistant: '',   // 小助理微信二维码（留空，待补充后填图片路径）
    qrGroup: ''        // 用户群二维码（留空，待补充后填图片路径）
  },

  goBack() {
    wx.navigateBack();
  }
});
