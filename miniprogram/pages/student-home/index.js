const mock = require('../../utils/mock.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');

Page({
  data: {
    user: { name: '小陈', date: '8月10日 星期一 · 今日宜挥汗' },
    hotCourses: [],
    tab: 0,
    greeting: '',
    t: i18n.t()
  },

  onLoad() {
    this.setData({ t: i18n.t() });
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

  // 读取微信昵称（早上好，{昵称}）
  // 注意：新版基础库下 getUserProfile 对未认证小程序返回"微信用户"默认值，
  // 此时原样显示"微信用户"，不再简化成"小陈"（避免误导）
  refreshUser() {
    const u = app.globalData.userInfo;
    let name = '微信用户';
    if (u && u.name && u.name !== '小陈同学') {
      name = u.name.slice(0, 8);
    }
    // 组装问候语（i18n 模板替换）
    const t = i18n.t();
    const greeting = t.morningGreeting.replace('{{name}}', name);
    // 组装课程卡片文案（模板替换占位符）
    const hotCourses = this.data.hotCourses.map(c => ({
      ...c,
      metaText: t.timeRangeSeats
        .replace('{{start}}', c.start)
        .replace('{{end}}', c.end)
        .replace('{{remaining}}', c.remaining),
      coachText: t.coachNameMeta.replace('{{coach}}', c.coach)
    }));
    this.setData({
      user: { ...this.data.user, name },
      greeting,
      hotCourses
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
