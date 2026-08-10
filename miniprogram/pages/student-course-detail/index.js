const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');
const app = getApp();

const DEFAULT_COVER = '/images/2_193.png'; // 课程未设封面时的占位图

Page({
  data: {
    course: null,
    remaining: 0,
    capacity: 0,
    offline: false
  },

  onLoad(options) {
    const sessionId = Number(options.session_id || 0);
    if (sessionId) {
      // 真实场次（来自课程列表）
      this.loadSession(sessionId);
    } else {
      // 兼容旧入口：按课程 id 从演示数据取
      const id = Number(options.id || 1);
      this.showMock(mock.courses.find(c => c.id === id) || mock.courses[0], false);
    }
  },

  // 从后端拉取场次详情
  loadSession(sessionId) {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    api.getSession(sessionId, openid).then((res) => {
      const s = res.session;
      this.setData({
        course: {
          id: s.id,
          name: s.course_name,
          category: s.category,
          duration: `${s.duration_min}分钟`,
          level: s.level,
          capacity: s.capacity,
          venue: s.venue_name,
          coach: s.coach_name,
          start: s.start_time,
          end: s.end_time,
          price: (s.price_fen / 100).toFixed(0),
          img: s.cover || DEFAULT_COVER
        },
        remaining: s.remaining,
        capacity: s.capacity,
        isBooked: !!s.booked_by_me,
        offline: false
      });
    }).catch(() => {
      // 后端不可用 → 演示数据兜底
      this.showMock(mock.courses[0], true);
    });
  },

  showMock(course, offline) {
    this.setData({
      course,
      remaining: course.remaining,
      capacity: course.capacity,
      offline
    });
  },

  goBack() {
    wx.navigateBack();
  },

  toggleFav() {
    wx.showToast({ title: '已收藏', icon: 'success' });
  },

  // 立即预订 -> 直接进入支付页（携带真实场次数据）
  bookNow() {
    if (this.data.isBooked) {
      wx.showToast({ title: '您已预订该课程', icon: 'none' });
      return;
    }
    const { course } = this.data;
    app.globalData.currentCourse = {
      session_id: course.id,
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
