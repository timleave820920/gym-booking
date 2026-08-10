const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');

const DEFAULT_COVER = '/images/2_193.png'; // 课程未设封面时的占位图

Page({
  data: {
    user: { name: '小陈', date: '' },
    hotCourses: [],      // 今日课程
    tab: 0,
    greeting: '',
    t: i18n.t(),
    offline: false,      // 后端不可用回退演示数据
    loaded: false        // 首屏加载完成（控制空状态显示）
  },

  onLoad() {
    this.setData({ t: i18n.t() });
    // 首页日期：动态生成，带年份（如 2026年8月10日 星期一 · 今日宜挥汗）
    const today = new Date();
    const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const dateText = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 ${week[today.getDay()]} · 今日宜挥汗`;
    this.setData({ 'user.date': dateText });
    this.loadTodayCourses();
  },

  onShow() {
    // 每次显示首页都刷新用户昵称 + 重新标记已结束课程（登录授权后立即生效）
    this.refreshUser();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  // 加载今日课程：从后端拉当天场次，按当前时间标记状态
  loadTodayCourses() {
    const today = new Date();
    const full = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    api.getSessionsByDate(full).then((res) => {
      const list = (res.sessions || []).map(s => ({
        id: s.id,
        name: s.course_name,
        coach: s.coach_name,
        venue: s.venue_name,
        start: s.start_time,
        end: s.end_time,
        remaining: s.remaining,
        capacity: s.capacity,
        price: (s.price_fen / 100).toFixed(0),
        img: s.cover || DEFAULT_COVER,
        status: this.getStatus(s.start_time, s.end_time)
      }));
      this.setData({ hotCourses: this.decorate(list), offline: false, loaded: true });
    }).catch(() => {
      // 后端不可用 → 用演示数据（取前 3 门课，按当日时间判断状态）
      const list = mock.courses.slice(0, 3).map(c => ({
        id: c.id, name: c.name, coach: c.coach, venue: c.venue,
        start: c.start, end: c.end, remaining: c.remaining, price: c.price, img: c.img,
        capacity: c.capacity || 20,
        status: this.getStatus(c.start, c.end)
      }));
      this.setData({ hotCourses: this.decorate(list), offline: true, loaded: true });
    });
  },

  // 课程状态：upcoming 未开始（可约）/ ongoing 进行中（红色不可点）/ ended 已结束（灰色）
  // 统一走公共工具 course-status（与本周列表一致）
  getStatus(startTime, endTime) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return courseStatus.getSessionStatus(today, startTime, endTime, now);
  },

  // 组装课程卡片文案（i18n 模板替换占位符）；recheck 时重算课程状态
  decorate(list, recheck) {
    const t = i18n.t();
    return (list || []).map(c => ({
      ...c,
      status: recheck ? this.getStatus(c.start, c.end) : c.status,
      metaText: t.timeRangeSeats
        .replace('{{start}}', c.start)
        .replace('{{end}}', c.end)
        .replace('{{remaining}}', String(c.remaining || 0).padStart(2, '0'))
        .replace('{{capacity}}', c.capacity || 20),
      coachText: t.coachNameMeta.replace('{{coach}}', c.coach)
    }));
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
    // 重新装饰课程卡片（顺带按当前时间刷新"已结束"标记）
    const hotCourses = this.decorate(this.data.hotCourses, true);
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
    const item = this.data.hotCourses.find(c => c.id === id);
    // 进行中 / 已结束的课程不可点击
    if (item && item.status !== 'upcoming') {
      wx.showToast({
        title: item.status === 'ongoing' ? '课程进行中，无法预约' : '课程已结束，无法预约',
        icon: 'none'
      });
      return;
    }
    wx.navigateTo({ url: `/pages/student-course-detail/index?session_id=${id}` });
  },

  switchTab(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ tab: idx });
  },

  goProfile() {
    wx.switchTab({ url: '/pages/student-profile/index' });
  }
});
