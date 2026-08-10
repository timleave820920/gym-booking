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
    // 每次显示首页都刷新用户昵称（登录授权后立即生效）
    this.refreshUser();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  // 读取微信真实昵称（早上好，{昵称}）
  refreshUser() {
    const u = app.globalData.userInfo;
    let name = '小陈';
    if (u && u.name) {
      name = (u.name === '小陈同学' || u.name === '微信用户') ? '小陈' : u.name.slice(0, 8);
    }
    this.setData({
      user: { ...this.data.user, name }
    });
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
