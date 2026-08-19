const app = getApp();
const api = require('../../utils/api.js');
const courseStatus = require('../../utils/course-status.js');
const { buildWeekDays } = require('../../utils/week-bar.js');

// 2026-08-15: 教练介绍页（V1 设计稿落地）
// 结构：生活照(placeholder) → 教练档案卡 → 技能认证｜比赛成绩(左右并行) → TA 的课程(周日期条+当日课程)
Page({
  data: {
    coachId: 0,
    coach: null,
    skills: [],
    certs: [],
    achievements: [],
    weekDays: [],       // 周日期条（今天起 7 天）
    selectedDate: '',   // 默认今天
    sessions: [],       // 全部课程（按周拉取）
    daySessions: [],    // 当前选中日期的课程
    loading: true
  },

  onLoad(options) {
    const coachId = Number(options.coach_id || 1);
    this.setData({ coachId });
    this.buildWeekDays();
    this.loadCoach();
    this.loadSessions();
  },

  // 周日期条：今天起 7 天，共享工具 week-bar.js
  buildWeekDays() {
    const days = buildWeekDays();
    this.setData({ weekDays: days, selectedDate: days[0].full });
  },

  loadCoach() {
    api.getCoachProfile(this.data.coachId).then((res) => {
      const c = res.coach || {};
      this.setData({
        coach: { ...c, life_photo: api.toFullUrl(c.life_photo) },
        skills: String(c.skills || '').split(',').map(s => s.trim()).filter(Boolean),
        certs: c.certs || [],
        achievements: c.achievements || []
      });
    }).catch(() => {
      this.setData({ coach: null });
    });
  },

  loadSessions() {
    const first = this.data.weekDays[0];
    const last = this.data.weekDays[6];
    api.getCoachSessions(this.data.coachId, first.full, last.full).then((res) => {
      this.setData({ sessions: res.sessions || [], loading: false });
      this.filterDay();
    }).catch(() => {
      this.setData({ sessions: [], loading: false });
      this.filterDay();
    });
  },

  // 按选中日期过滤课程
  filterDay() {
    const date = this.data.selectedDate;
    const daySessions = this.data.sessions
      .filter(s => s.date === date)
      // 只显示未开始的课程；已过去（含进行中）的不展示（2026-08-15 用户要求）
      .filter(s => courseStatus.getSessionStatus(s.date, s.start_time, s.end_time) === 'upcoming')
      .map(s => ({
        ...s,
        isFull: (s.remaining || 0) <= 0,
        booked: s.booked_count || 0
      }));
    this.setData({ daySessions });
  },

  selectDate(e) {
    const full = e.currentTarget.dataset.full;
    this.setData({
      selectedDate: full,
      weekDays: this.data.weekDays.map(d => ({ ...d, selected: d.full === full }))
    });
    this.filterDay();
  },

  // 课程条 → 详情页约课
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/student-course-detail/index?session_id=' + id });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  }
});
