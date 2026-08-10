const mock = require('../../utils/mock.js');
const app = getApp();

Page({
  data: {
    course: null,
    remaining: 0,
    capacity: 0
  },

  onLoad(options) {
    const id = Number(options.id || 1);
    const course = mock.courses.find(c => c.id === id) || mock.courses[0];
    this.setData({
      course,
      remaining: course.remaining,
      capacity: course.capacity
    });
  },

  goBack() {
    wx.navigateBack();
  },

  toggleFav() {
    wx.showToast({ title: '已收藏', icon: 'success' });
  },

  // 立即预订 -> 直接进入支付页
  bookNow() {
    const { course } = this.data;
    app.globalData.currentCourse = {
      id: course.id,
      name: course.name,
      coach: course.coach,
      venue: course.venue,
      time: `${course.start}-${course.end}`,
      price: course.price,
      img: course.img
    };
    wx.navigateTo({ url: '/pages/student-pay/index' });
  }
});
