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

  // 读取微信昵称 + 按时段问候（{时段问候}，{昵称}）
  // 时段：6-12 早上好 / 12-13 中午好 / 13-18 下午好 / 18-22 晚上好 / 22-次日6 夜深了
  refreshUser() {
    const u = app.globalData.userInfo;
    let name = '微信用户';
    if (u && u.name && u.name !== '小陈同学') {
      name = u.name.slice(0, 8);
    }
    // 组装问候语（按时段 + i18n）
    const t = i18n.t();
    const greetingWord = this.getGreetingWord(t);
    const greeting = `${greetingWord}，${name}`;
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

  // 根据当前时间返回对应时段问候词
  getGreetingWord(t) {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return t.greetingMorning;
    if (hour >= 12 && hour < 13) return t.greetingNoon;
    if (hour >= 13 && hour < 18) return t.greetingAfternoon;
    if (hour >= 18 && hour < 22) return t.greetingEvening;
    return t.greetingLate; // 22:00 - 次日 6:00
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
