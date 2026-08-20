const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');
const sessionCache = require('../../utils/session-cache.js');
const { getGreeting } = require('../../utils/greeting.js');
const { buildWeekDays } = require('../../utils/week-bar.js');
const track = require('../../utils/track.js');   // 浏览埋点（DESIGN #D5）

const DEFAULT_COVER = '/images/2_193.png';       // 课程未设封面时的占位图
const DEFAULT_COACH_AVATAR = '/images/2_1468.png'; // 教练未设头像时的占位图

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
    memberLevelName: '会员',  // 当前会员等级名（青铜/白银/黄金/钻石），价格旁标注
    searchKeyword: '',   // 课程搜索关键字（B3 2026-08-18：按课程名/教练名过滤）
    searchResult: [],    // 过滤后的课程列表（关键字非空时使用）
    isFutureDay: false,  // 当前选中日是否为未来日（DESIGN #D10：未来空课日显示发布占位）
    nextPublishText: ''  // 下一次课表发布时间文案（如 '8月21日'，后端 time.js 权威计算）
  },

  onLoad() {
    this.setData({ t: i18n.t() });
    // 当前时间：年月日 + 星期（如 2026年8月11日 星期二）
    const today = new Date();
    const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const dateText = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 ${week[today.getDay()]}`;
    this.setData({ 'user.date': dateText });
    this.buildWeek();
    this.loadNextPublish();
  },

  // DESIGN #D10：下一次课表发布日（每周五 22:00 运营约定，后端 time.js 北京时间权威计算，前端不自行算日期）
  // 拉取失败降级：nextPublishText 保持空 → 未来空课日显示原空态（不显示无日期的残缺占位）
  loadNextPublish() {
    api.getNextPublish().then((res) => {
      if (res && res.text) this.setData({ nextPublishText: res.text });
    }).catch(() => {});
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 浏览埋点：首页曝光（DESIGN #D5）
    track.pageView('home');
    // 每次显示刷新问候语（登录授权后立即生效）
    this.refreshUser();
    // 每次回到本页重新拉取数据（订课后余位/席位实时更新）
    if (this.data.selectedDate !== '' && this.data.selectedDate !== undefined && this.data.weekDays.length > 0) {
      const current = this.data.weekDays.find(d => d.full === this.data.selectedDate);
      if (current) this.loadSessions(current.full);
    }
  },

  // 读取微信昵称 + 按时段问候（共享工具 greeting.js）
  refreshUser() {
    const u = app.globalData.userInfo;
    let name = '微信用户';
    if (u && u.name && u.name !== '小陈同学') {
      name = u.name.slice(0, 8);
    }
    const greeting = `${getGreeting()}，${name}`;
    this.setData({ greeting });
  },

  // 日期条：今天起 7 天（含今天），共享工具 week-bar.js（BUG-LEDGER #26 / #7）
  buildWeek() {
    const weekDays = buildWeekDays();
    this.setData({ weekDays, selectedDate: weekDays[0].full });
    this.loadSessions(weekDays[0].full);
  },

  selectDate(e) {
    const { full } = e.currentTarget.dataset;
    const weekDays = this.data.weekDays.map(d => ({ ...d, selected: d.full === full }));
    this.setData({ weekDays, selectedDate: full });
    this.loadSessions(full);
  },

  // B3（2026-08-18）：课程搜索——按课程名/教练名/描述过滤当天列表
  onSearchInput(e) {
    const keyword = (e.detail.value || '').trim();
    this.setData({ searchKeyword: keyword });
    this.refreshSearch();
    // 浏览埋点：搜索关键词（防抖 1s，DESIGN #D5）
    track.search(keyword);
  },

  onSearchClear() {
    this.setData({ searchKeyword: '', searchResult: [] });
  },

  // 按当前关键字重算过滤列表（课程列表刷新后也需同步调用，保持过滤一致性）
  refreshSearch() {
    const kw = this.data.searchKeyword.toLowerCase();
    if (!kw) {
      this.setData({ searchResult: [] });
      return;
    }
    const list = (this.data.courseList || []).filter(c =>
      (c.name || '').toLowerCase().indexOf(kw) >= 0
      || (c.coach || '').toLowerCase().indexOf(kw) >= 0
      || (c.description || '').toLowerCase().indexOf(kw) >= 0
    );
    this.setData({ searchResult: list });
  },

  // 从后端拉取当天场次；失败则回退演示数据
  // 性能优化：有本地缓存先秒开渲染（loading=false），后台刷新替换；无缓存才显示骨架屏
  loadSessions(full) {
    // DESIGN #D10：未来日判定（'YYYY-MM-DD' 字符串比较；今天及过去不算未来 → 保持原空态）
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.setData({ isFutureDay: full > todayStr });
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
      this.refreshSearch();
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
      this.refreshSearch();
    }).catch(() => {
      if (this.data.courseList.length > 0) return; // 已有缓存/数据，保持展示
      // 后端不可用 → 用 mock 演示数据（按真实星期映射 mock.days：1=周一..7=周日）
      const dayIndex = new Date(full + 'T12:00:00').getDay() || 7;
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
      this.refreshSearch();
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
      coachId: s.coach_id,
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
      bookedByMe: !!s.booked_by_me,
      waitlistCount: s.waitlist_count || 0  // 满员排队人数（DESIGN #D3）
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
      // 满员未开始且未预订 → 可点（进候补）；已预订 → 可点进详情（详情页按钮显示"已预订"）
      canWaitlist: isFull && status === 'upcoming' && !isBooked,
      disabled: !isBooked && status !== 'upcoming',
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
    if (e.currentTarget.dataset.disabled) return; // 进行中/已结束（未预订）不可点击；已预订可进详情
    // source 透传埋点来源（DESIGN #D5）：搜索中进入=search，否则=home
    const source = this.data.searchKeyword ? 'search' : 'home';
    wx.navigateTo({ url: `/pages/student-course-detail/index?session_id=${id}&source=${source}` });
  },

  // 课程条上点教练头像 → 教练介绍页（catchtap 已阻止冒泡，不影响进详情）
  goCoachProfile(e) {
    const coachId = e.currentTarget.dataset.coachId;
    if (!coachId) {
      wx.showToast({ title: '暂无教练信息', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/coach-profile/index?coach_id=' + coachId });
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
