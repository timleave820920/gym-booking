const app = getApp();

Page({
  data: {
    course: null,
    isWaitlist: false
  },

  onLoad(options) {
    const course = app.globalData.currentCourse || null;
    this.setData({
      course,
      isWaitlist: (options.mode === 'waitlist') || (course && course.mode === 'waitlist')
    });
  },

  // 查看 → 回主页面，默认打开「上课」tab
  goProfile() {
    wx.switchTab({ url: '/pages/student-my-courses/index' });
  }
});
