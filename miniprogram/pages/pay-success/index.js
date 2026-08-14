const app = getApp();

Page({
  data: {
    course: null,
    isWaitlist: false,
    payAmount: '0',     // 实付金额（会员折扣后）
    paySource: '',      // pass=次卡扣除 / balance / wxpay
    payText: ''         // 支付说明：次卡显示"扣除次数包 1 次"，其余显示金额
  },

  onLoad(options) {
    const course = app.globalData.currentCourse || null;
    const payResult = app.globalData.payResult || null;
    const paySource = (payResult && payResult.paySource) || '';
    const isPass = paySource === 'pass';
    this.setData({
      course,
      isWaitlist: (options.mode === 'waitlist') || (course && course.mode === 'waitlist'),
      paySource,
      // 次卡支付 → 显示"扣除次数包 1 次"；否则显示实付金额（支付回写后订单金额，兜底课程原价）
      payText: isPass ? '扣除次数包 1 次' : ('¥' + ((payResult && payResult.amount != null) ? payResult.amount : (course ? course.price : '0')))
    });
  },

  // 查看 → 回主页面，默认打开「上课」tab
  goProfile() {
    wx.switchTab({ url: '/pages/student-my-courses/index' });
  }
});
