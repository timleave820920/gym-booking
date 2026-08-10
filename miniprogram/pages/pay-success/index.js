const app = getApp();

Page({
  data: {
    course: null
  },

  onLoad() {
    const course = app.globalData.currentCourse || null;
    this.setData({ course });
  },

  // 查看 → 回主页面，默认打开「我的课」tab
  goProfile() {
    wx.switchTab({ url: '/pages/student-my-courses/index' });
  }
});
