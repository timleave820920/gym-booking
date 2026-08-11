const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');

const DEFAULT_COVER = '/images/2_193.png';       // 课程未设封面时的占位图
const DEFAULT_COACH_AVATAR = '/images/2_1468.png'; // 教练未设头像时的占位图
const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

Page({
  data: {
    weekDays: [],        // 本周周一~周日
    selectedDate: '',    // 选中的"几号"（高亮用）
    courseList: [],      // 当天课程
    loading: true,       // 加载中
    offline: false,      // 后端不可用回退演示数据
    t: i18n.t()          // 语言字典
  },

  onLoad() {
    this.setData({ t: i18n.t() });
    this.buildWeek();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 每次回到本页重新拉取数据（订课后余位/席位实时更新）
    if (this.data.selectedDate !== '' && this.data.selectedDate !== undefined && this.data.weekDays.length > 0) {
      const current = this.data.weekDays.find(d => d.date === Number(this.data.selectedDate));
      if (current) this.loadSessions(current.full);
    }
  },

  // 生成本周（周一~周日）真实日期，默认选中今天
  buildWeek() {
    const now = new Date();
    const day = now.getDay() || 7; // 周日=7
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
    const todayFull = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const full = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      weekDays.push({ weekday: WEEK_LABELS[i], date: d.getDate(), full, selected: full === todayFull });
    }
    // 默认选中今天（若不在本周则回退周一）
    const initial = weekDays.find(d => d.selected) || weekDays[0];
    this.setData({ weekDays, selectedDate: initial.date });
    this.loadSessions(initial.full);
  },

  selectDate(e) {
    const { full } = e.currentTarget.dataset;
    const date = Number(e.currentTarget.dataset.date); // dataset 是字符串，转数字以匹配 weekDays
    const weekDays = this.data.weekDays.map(d => ({ ...d, selected: d.date === date }));
    this.setData({ weekDays, selectedDate: date });
    this.loadSessions(full);
  },

  // 从后端拉取当天场次；失败则回退演示数据
  loadSessions(full) {
    this.setData({ loading: true, courseList: [] });
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    api.getSessionsByDate(full, openid).then((res) => {
      const list = (res.sessions || []).map(s => ({
        id: s.id,
        name: s.course_name,
        category: s.category,
        coach: s.coach_name,
        coachAvatar: s.coach_avatar || DEFAULT_COACH_AVATAR,
        level: s.level,
        date: full,               // 场次所属日期
        start: s.start_time,
        end: s.end_time,
        remaining: s.remaining,
        capacity: s.capacity,
        price: (s.price_fen / 100).toFixed(0),
        memberPrice: Math.floor(Number((s.price_fen / 100).toFixed(0)) * 0.9), // 会员价 = 正价×90% 向下取整
        img: s.cover || DEFAULT_COVER,
        bookedByMe: !!s.booked_by_me
      })).map(s => this.decorateSession(s));
      // 排序：未开始（最早的排第一）→ 进行中 → 已结束，同状态按开始时间
      list.sort(this.sortSessions);
      this.setData({ courseList: list, loading: false, offline: false });
    }).catch(() => {
      // 后端不可用 → 用 mock 演示数据（当日映射：日期数-9 → 周一..周日）
      const dayIndex = Number(full.slice(8, 10)) - 9;
      const list = mock.courses
        .filter(c => c.days.includes(dayIndex))
        .map(c => this.decorateSession({
          id: c.id, name: c.name, category: c.category, coach: c.coach,
          coachAvatar: DEFAULT_COACH_AVATAR, level: c.level,
          date: full,
          start: c.start, end: c.end, remaining: c.remaining, price: c.price,
          memberPrice: Math.floor(Number(c.price) * 0.9),
          img: c.img, capacity: c.capacity || 20
        }));
      list.sort(this.sortSessions);
      this.setData({ courseList: list, loading: false, offline: true });
    });
  },

  // 排序：未开始在前（最早的未开始排第一），再进行中，最后已结束；同状态按开始时间升序
  sortSessions(a, b) {
    const rank = { upcoming: 0, ongoing: 1, ended: 2 };
    const ra = rank[a.status] !== undefined ? rank[a.status] : 3;
    const rb = rank[b.status] !== undefined ? rank[b.status] : 3;
    if (ra !== rb) return ra - rb;
    return (a.start || '').localeCompare(b.start || '');
  },

  // 装饰场次：计算席位文案（剩余/总席）、满员、已预订、时间状态
  decorateSession(s) {
    const cap = s.capacity || 20;
    const remaining = s.remaining !== undefined ? s.remaining : cap;
    const booked = Math.max(cap - remaining, 0);
    const isFull = booked >= cap;
    const isBooked = !!s.bookedByMe;
    // 按日期+时间判断状态（与今日首页一致：upcoming/ongoing/ended）
    const status = courseStatus.getSessionStatus(s.date, s.start, s.end);
    return {
      ...s,
      booked,
      remaining,
      seatText: `${String(remaining).padStart(2, '0')}/${cap}`,
      isFull,
      isBooked,
      status,
      // 已预订/进行中/已结束 → 不可点击；满员未开始 → 可点（进候补）
      canWaitlist: isFull && status === 'upcoming',
      disabled: isBooked || status !== 'upcoming' || (isFull && status !== 'upcoming'),
      // 已预订优先于满员显示
      seatFull: !isBooked && remaining <= 2
    };
  },

  // 教练头像加载失败 → 回退默认头像
  avatarError(e) {
    const idx = e.currentTarget.dataset.idx;
    if (idx === undefined) return;
    this.setData({ [`courseList[${idx}].coachAvatar`]: DEFAULT_COACH_AVATAR });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    const canWaitlist = e.currentTarget.dataset.waitlist;
    if (canWaitlist) {
      // 满员 → 候补排位（跳支付页，模式=waitlist）
      this.goWaitlist(id);
      return;
    }
    if (e.currentTarget.dataset.disabled) return; // 已预订/进行中/已结束 不可点击
    wx.navigateTo({ url: `/pages/student-course-detail/index?session_id=${id}` });
  },

  // 满员课程 → 候补排位支付
  goWaitlist(sessionId) {
    const course = this.data.courseList.find(c => c.id === sessionId);
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

  goHome() { wx.switchTab({ url: '/pages/student-activity/index' }); },
  goMy() { wx.switchTab({ url: '/pages/student-my-courses/index' }); },
  goProfile() { wx.switchTab({ url: '/pages/student-profile/index' }); }
});
