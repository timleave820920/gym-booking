const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');

const DEFAULT_COVER = '/images/2_193.png'; // 课程未设封面时的占位图
const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

Page({
  data: {
    weekDays: [],        // 本周周一~周日
    selectedDate: '',    // 选中的"几号"（高亮用）
    courseList: [],      // 当天课程
    loading: true,       // 加载中
    offline: false       // 后端不可用回退演示数据
  },

  onLoad() {
    this.buildWeek();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    // 每次回到本页重新拉取数据（订课后余位/席位实时更新）
    if (this.data.selectedDate !== '' && this.data.selectedDate !== undefined && this.data.weekDays.length > 0) {
      const current = this.data.weekDays.find(d => d.date === Number(this.data.selectedDate));
      if (current) this.loadSessions(current.full);
    }
  },

  // 生成本周（周一~周日）真实日期
  buildWeek() {
    const now = new Date();
    const day = now.getDay() || 7; // 周日=7
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const full = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      weekDays.push({ weekday: WEEK_LABELS[i], date: d.getDate(), full, selected: i === 0 });
    }
    this.setData({ weekDays, selectedDate: weekDays[0].date });
    this.loadSessions(weekDays[0].full);
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
        start: s.start_time,
        end: s.end_time,
        remaining: s.remaining,
        capacity: s.capacity,
        price: (s.price_fen / 100).toFixed(0),
        img: s.cover || DEFAULT_COVER,
        bookedByMe: !!s.booked_by_me
      })).map(s => this.decorateSession(s));
      this.setData({ courseList: list, loading: false, offline: false });
    }).catch(() => {
      // 后端不可用 → 用 mock 演示数据（当日映射：日期数-9 → 周一..周日）
      const dayIndex = Number(full.slice(8, 10)) - 9;
      const list = mock.courses
        .filter(c => c.days.includes(dayIndex))
        .map(c => this.decorateSession({
          id: c.id, name: c.name, category: c.category, coach: c.coach,
          start: c.start, end: c.end, remaining: c.remaining, price: c.price,
          img: c.img, capacity: c.capacity || 20
        }));
      this.setData({ courseList: list, loading: false, offline: true });
    });
  },

  // 装饰场次：计算席位文案（剩余/总席）、满员、已预订状态
  decorateSession(s) {
    const cap = s.capacity || 20;
    const remaining = s.remaining !== undefined ? s.remaining : cap;
    const booked = Math.max(cap - remaining, 0);
    const isFull = booked >= cap;
    const isBooked = !!s.bookedByMe;
    return {
      ...s,
      booked,
      remaining,
      seatText: `${String(remaining).padStart(2, '0')}/${cap}`,
      isFull,
      isBooked,
      // 已预订优先于满员显示
      seatFull: !isBooked && remaining <= 2
    };
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (e.currentTarget.dataset.full) return; // 满员不可点击
    if (e.currentTarget.dataset.booked) return; // 已预订不可点击
    wx.navigateTo({ url: `/pages/student-course-detail/index?session_id=${id}` });
  },

  goHome() { wx.switchTab({ url: '/pages/student-home/index' }); },
  goMy() { wx.switchTab({ url: '/pages/student-my-courses/index' }); },
  goProfile() { wx.switchTab({ url: '/pages/student-profile/index' }); }
});
