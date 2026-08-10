const mock = require('../../utils/mock.js');

Page({
  data: {
    weekDays: [],
    selectedDate: 10,
    courseList: []
  },

  onLoad() {
    // 初始化本周日期
    const today = new Date();
    const monday = 10; // 设计稿基准日 8月10日（周一）
    const weekDays = mock.weekDays;
    this.setData({ weekDays });
    this.filterByDate(10);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  selectDate(e) {
    const date = e.currentTarget.dataset.date;
    const weekDays = this.data.weekDays.map(d => ({
      ...d, selected: d.date === date
    }));
    this.setData({ weekDays, selectedDate: date });
    this.filterByDate(date);
  },

  // 按日期过滤课程：每个课程依据 days 字段判断当日是否排课
  filterByDate(date) {
    const dayIndex = date - 9; // 10 -> 1 (周一), 16 -> 7 (周日)
    const list = mock.courses
      .filter(c => c.days.includes(dayIndex))
      .map(c => ({
        id: c.id, name: c.name, category: c.category, coach: c.coach,
        start: c.start, end: c.end, remaining: c.remaining, price: c.price,
        img: c.img, seatFull: c.remaining <= 2
      }));
    this.setData({ courseList: list });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/student-course-detail/index?id=${id}` });
  },

  goHome() { wx.switchTab({ url: '/pages/student-home/index' }); },
  goMy() { wx.switchTab({ url: '/pages/student-my-courses/index' }); },
  goProfile() { wx.switchTab({ url: '/pages/student-profile/index' }); }
});
