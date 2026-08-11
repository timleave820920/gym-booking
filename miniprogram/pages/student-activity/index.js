const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');

const DEFAULT_COVER = '/images/2_193.png';       // 课程未设封面时的占位图
const DEFAULT_COACH_AVATAR = '/images/2_1468.png'; // 教练未设头像时的占位图

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
    // 每次显示都刷新用户昵称 + 重新标记课程状态（登录授权后立即生效）
    this.refreshUser();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  // 加载今日课程：从后端拉当天场次，按当前时间标记状态
  loadTodayCourses() {
    const today = new Date();
    const full = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    api.getSessionsByDate(full, openid).then((res) => {
      const list = (res.sessions || []).map(s => {
        const price = (s.price_fen / 100).toFixed(0);
        return {
          id: s.id,
          name: s.course_name,
          description: s.course_desc || '',
          coach: s.coach_name,
          venue: s.venue_name,
          coachAvatar: s.coach_avatar || DEFAULT_COACH_AVATAR,
          level: s.level,
          start: s.start_time,
          end: s.end_time,
          remaining: s.remaining,
          capacity: s.capacity,
          price,
          memberPrice: Math.floor(Number(price) * 0.9),  // 会员价 = 正价×90% 向下取整
          img: s.cover || DEFAULT_COVER,
          status: this.getStatus(s.start_time, s.end_time),
          waitlisted: !!s.waitlisted_by_me,   // 已排位标记
          bookedByMe: !!s.booked_by_me        // 已预订标记
        };
      });
      this.setData({ hotCourses: this.decorate(list), offline: false, loaded: true });
    }).catch(() => {
      // 后端不可用 → 用演示数据（取前 3 门课，按当日时间判断状态）
      const list = mock.courses.slice(0, 3).map(c => ({
        id: c.id, name: c.name, description: c.desc || c.description || '', coach: c.coach, venue: c.venue,
        coachAvatar: DEFAULT_COACH_AVATAR, level: c.level,
        start: c.start, end: c.end, remaining: c.remaining, capacity: c.capacity || 20,
        price: c.price, memberPrice: Math.floor(Number(c.price) * 0.9),
        img: c.img,
        status: this.getStatus(c.start, c.end),
        waitlisted: false,
        bookedByMe: false
      }));
      this.setData({ hotCourses: this.decorate(list), offline: true, loaded: true });
    });
  },

  // 派生状态（与本周列表一致）：满员 / 可候补 / 不可点击
  decorate(list, recheck) {
    return (list || []).map(c => {
      const status = recheck ? this.getStatus(c.start, c.end) : c.status;
      const capacity = c.capacity || 20;
      const remaining = c.remaining !== undefined ? c.remaining : capacity;
      const isFull = remaining <= 0;
      const isBooked = !!c.bookedByMe;
      const waitlisted = !!c.waitlisted;
      return {
        ...c,
        status,
        capacity,
        remaining,
        booked: Math.max(capacity - remaining, 0),  // 已订席位（显示 已订/总数）
        isFull,
        isBooked,
        waitlisted,
        canWaitlist: isFull && status === 'upcoming' && !isBooked && !waitlisted,
        disabled: isBooked || waitlisted || status !== 'upcoming'
      };
    });
  },

  // 教练头像加载失败 → 回退默认头像
  avatarError(e) {
    const idx = e.currentTarget.dataset.idx;
    if (idx === undefined) return;
    this.setData({ [`hotCourses[${idx}].coachAvatar`]: DEFAULT_COACH_AVATAR });
  },

  // 课程状态：upcoming 未开始（可约）/ ongoing 进行中（红色不可点）/ ended 已结束（灰色）
  // 统一走公共工具 course-status（与本周列表一致）
  getStatus(startTime, endTime) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return courseStatus.getSessionStatus(today, startTime, endTime, now);
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
    if (!item) return;
    // 满员未开始 → 候补排位（跳支付页，模式=waitlist）
    if (item.canWaitlist) {
      this.goWaitlist(id);
      return;
    }
    if (item.isBooked) {
      wx.showToast({ title: '已预订', icon: 'none' });
      return;
    }
    // 已排位 → 不可再次排位/预约
    if (item.waitlisted) {
      wx.showToast({ title: '已排位，等待转正', icon: 'none' });
      return;
    }
    // 进行中 / 已结束的课程不可点击
    if (item.status !== 'upcoming') {
      wx.showToast({
        title: item.status === 'ongoing' ? '课程进行中，无法预约' : '课程已结束，无法预约',
        icon: 'none'
      });
      return;
    }
    wx.navigateTo({ url: `/pages/student-course-detail/index?session_id=${id}` });
  },

  // 满员课程 → 候补排位支付（与本周列表一致）
  goWaitlist(sessionId) {
    const course = this.data.hotCourses.find(c => c.id === sessionId);
    if (!course) return;
    app.globalData.currentCourse = {
      session_id: course.id,
      id: course.id,
      name: course.name,
      coach: course.coach,
      venue: course.venue,
      time: `${course.start}-${course.end}`,
      price: course.price,
      img: course.img,
      mode: 'waitlist'          // 标记为候补排位模式
    };
    wx.navigateTo({ url: '/pages/student-pay/index' });
  },

  switchTab(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ tab: idx });
  },

  goProfile() {
    wx.switchTab({ url: '/pages/student-profile/index' });
  }
});
