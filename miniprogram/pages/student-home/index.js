const mock = require('../../utils/mock.js');
const app = getApp();

Page({
  data: {
    user: { name: '小陈', date: '8月10日 星期一 · 今日宜挥汗' },
    hotCourses: [],
    tab: 0
  },

  onLoad() {
    // 首页热门课程：取每个课程第一个排课日对应的课程
    this.setData({
      hotCourses: mock.courses.slice(0, 3).map(c => ({
        id: c.id, name: c.name, coach: c.coach, venue: c.venue,
        start: c.start, end: c.end, remaining: c.remaining, price: c.price, img: c.img
      }))
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  goSearch() {
    wx.switchTab({ url: '/pages/student-courses/index' });
  },

  goCourses() {
    wx.switchTab({ url: '/pages/student-courses/index' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/student-course-detail/index?id=${id}` });
  },

  switchTab(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ tab: idx });
  },

  goProfile() {
    wx.switchTab({ url: '/pages/student-profile/index' });
  }
});
