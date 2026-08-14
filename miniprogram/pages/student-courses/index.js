const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');
const sessionCache = require('../../utils/session-cache.js');

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
    greeting: '',        // 时段问候 + 昵称
    user: { date: '' },  // 当前日期（年月日 + 星期）
    t: i18n.t(),         // 语言字典
    memberLevelName: '会员'  // 当前会员等级名（青铜/白银/黄金/钻石），价格旁标注
  },

  onLoad() {
    this.setData({ t: i18n.t() });
    // 当前时间：年月日 + 星期（如 2026年8月11日 星期二）
    const today = new Date();
    const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const dateText = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 ${week[today.getDay()]}`;
    this.setData({ 'user.date': dateText });
    this.buildWeek();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 每次显示刷新问候语（登录授权后立即生效）
    this.refreshUser();
    // 每次回到本页重新拉取数据（订课后余位/席位实时更新）
    if (this.data.selectedDate !== '' && this.data.selectedDate !== undefined && this.data.weekDays.length > 0) {
      const current = this.data.weekDays.find(d => d.date === Number(this.data.selectedDate));
      if (current) this.loadSessions(current.full);
    }
  },

  // 读取微信昵称 + 按时段问候（{时段问候}，{昵称}），与活动页一致
  refreshUser() {
    const u = app.globalData.userInfo;
    let name = '微信用户';
    if (u && u.name && u.name !== '小陈同学') {
      name = u.name.slice(0, 8);
    }
    const t = i18n.t();
    const greeting = `${this.getGreetingWord(t)}，${name}`;
    this.setData({ greeting });
  },

  // 根据当前时间返回对应时段问候词（6-12早 / 12-13午 / 13-18下午 / 18-22晚 / 22-次日6夜深）
  getGreetingWord(t) {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return t.greetingMorning;
    if (hour >= 12 && hour < 13) return t.greetingNoon;
    if (hour >= 13 && hour < 18) return t.greetingAfternoon;
    if (hour >= 18 && hour < 22) return t.greetingEvening;
    return t.greetingLate;
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
  // 性能优化：有本地缓存先秒开渲染（loading=false），后台刷新替换；无缓存才显示骨架屏
  loadSessions(full) {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    let discount = 1;
    // 会员折扣回调：拿到等级后重算列表会员价（不阻塞首屏）
    this.applyDiscount = (d, lvName) => {
      discount = Number(d) || 1;
      this.setData({
        memberLevelName: lvName || '会员',
        courseList: this.data.courseList.map(c => ({ ...c, memberPrice: Math.floor(Number(c.price) * discount) }))
      });
    };
    // 秒开：先渲染本地缓存（若有）
    const cached = sessionCache.get(full);
    if (cached && cached.length) {
      this.setData({ courseList: this.renderList(cached, full, discount), loading: false, offline: false });
    } else {
      this.setData({ loading: true, courseList: [] });
    }
    // 会员折扣（异步，不阻塞列表渲染）
    if (openid) {
      api.getMemberLevel(openid).then((r) => {
        if (r.level && r.level.discount) this.applyDiscount(r.level.discount, r.level.levelName);
      }).catch(() => {});
    }
    // 网络刷新：成功 → 写缓存 + 渲染新数据；失败 → 已有数据保持展示，否则回退演示数据
    api.getSessionsByDate(full, openid).then((res) => {
      const list = res.sessions || [];
      sessionCache.set(full, list);
      this.setData({ courseList: this.renderList(list, full, discount), loading: false, offline: false });
    }).catch(() => {
      if (this.data.courseList.length > 0) return; // 已有缓存/数据，保持展示
      // 后端不可用 → 用 mock 演示数据（当日映射：日期数-9 → 周一..周日）
      const dayIndex = Number(full.slice(8, 10)) - 9;
      const list = mock.courses
        .filter(c => c.days.includes(dayIndex))
        .map(c => this.decorateSession({
          id: c.id, name: c.name, description: c.desc || c.description || '', category: c.category, coach: c.coach,
          coachAvatar: DEFAULT_COACH_AVATAR, level: c.level,
          date: full,
          start: c.start, end: c.end, remaining: c.remaining, price: c.price,
          memberPrice: Math.floor(Number(c.price) * discount),
          img: c.img, capacity: c.capacity || 20
        }));
      list.sort(this.sortSessions);
      this.setData({ courseList: list, loading: false, offline: true });
    });
  },

  // 原始场次数据 → 装饰后的课程列表（映射 + 状态 + 排序）
  renderList(sessions, full, discount) {
    const list = (sessions || []).map(s => ({
      id: s.id,
      name: s.course_name,
      description: s.course_desc || '',
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
      memberPrice: Math.floor(Number((s.price_fen / 100).toFixed(0)) * discount), // 会员价 = 正价 × 等级折扣，向下取整到元
      img: s.cover || DEFAULT_COVER,
      bookedByMe: !!s.booked_by_me
    })).map(s => this.decorateSession(s));
    list.sort(this.sortSessions);
    return list;
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

  goHome() { wx.switchTab({ url: '/pages/member-center/index' }); },
  goMy() { wx.switchTab({ url: '/pages/student-my-courses/index' }); },
  goProfile() { wx.switchTab({ url: '/pages/student-profile/index' }); }
});
