const app = getApp();

Page({
  data: {
    course: null,
    isWaitlist: false,
    payAmount: '0'      // 实付金额（会员折扣后）
  },

  onLoad(options) {
    const course = app.globalData.currentCourse || null;
    const payResult = app.globalData.payResult || null;
    this.setData({
      course,
      isWaitlist: (options.mode === 'waitlist') || (course && course.mode === 'waitlist'),
      // 优先显示实付金额（支付回写后的订单金额），兜底课程原价
      payAmount: (payResult && payResult.amount != null) ? payResult.amount : (course ? course.price : '0')
    });
  },

  // 查看 → 回主页面，默认打开「上课」tab
  goProfile() {
    wx.switchTab({ url: '/pages/student-my-courses/index' });
  }
});
