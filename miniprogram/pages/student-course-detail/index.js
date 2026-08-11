const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');

const DEFAULT_COVER = '/images/2_193.png'; // 课程未设封面时的占位图

Page({
  data: {
    course: null,
    remaining: 0,
    capacity: 0,
    offline: false,
    t: i18n.t()
  },

  onLoad(options) {
    this.setData({ t: i18n.t() });
    const sessionId = Number(options.session_id || 0);
    if (sessionId) {
      // 真实场次（来自课程列表）
      this.loadSession(sessionId);
    } else {
      // 兼容旧入口：按课程 id 从演示数据取
      const id = Number(options.id || 1);
      this.showMock(mock.courses.find(c => c.id === id) || mock.courses[0], false);
    }
  },

  // 从后端拉取场次详情
  loadSession(sessionId) {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    api.getSession(sessionId, openid).then((res) => {
      const s = res.session;
      // 按日期+时间判断课程状态 → 三态描述文案
      const status = courseStatus.getSessionStatus(s.date, s.start_time, s.end_time);
      this.setData({
        course: {
          id: s.id,
          name: s.course_name,
          category: s.category,
          duration: `${s.duration_min}分钟`,
          level: s.level,
          capacity: s.capacity,
          venue: s.venue_name,
          coach: s.coach_name,
          start: s.start_time,
          end: s.end_time,
          price: (s.price_fen / 100).toFixed(0),
          img: s.cover || DEFAULT_COVER,
          date: s.date,
          // 副标题：卖点标签（逗号分隔 → · 连接），未配置则用默认文案
          sub: this.buildSub(s.course_tags)
        },
        remaining: s.remaining,
        capacity: s.capacity,
        isBooked: !!s.booked_by_me,
        status,
        // 课程介绍：优先用管理员配置的描述；未配置时回退三态文案
        descText: s.course_desc || this.getStatusDesc(status),
        // 三态提示降级为状态小字（仅当有真实描述时显示）
        statusNote: s.course_desc ? this.getStatusDesc(status) : '',
        offline: false
      });
    }).catch(() => {
      // 后端不可用 → 演示数据兜底
      this.showMock(mock.courses[0], true);
    });
  },

  // 三态描述文案（i18n）：未开始=课程介绍/报名提示，进行中=进行中提示，已结束=结束/复盘说明
  getStatusDesc(status) {
    const t = i18n.t();
    if (status === 'ongoing') return t.descOngoing;
    if (status === 'ended') return t.descEnded;
    return t.descUpcoming;
  },

  // 卖点标签 → 副标题（如 "高效燃脂, 器械混合" → "高效燃脂 · 器械混合"）
  buildSub(tags) {
    const list = String(tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
    return list.length ? list.join(' · ') : '全身循环训练 · 高效燃脂 · 暴汗体验';
  },

  showMock(course, offline) {
    this.setData({
      course: { ...course, sub: this.buildSub(course.tags) },
      remaining: course.remaining,
      capacity: course.capacity,
      status: 'upcoming',
      descText: i18n.t().descUpcoming,
      statusNote: '',
      offline
    });
  },

  goBack() {
    wx.navigateBack();
  },

  toggleFav() {
    wx.showToast({ title: '已收藏', icon: 'success' });
  },

  // 立即预订 -> 直接进入支付页（携带真实场次数据）
  bookNow() {
    if (this.data.isBooked) {
      wx.showToast({ title: '您已预订该课程', icon: 'none' });
      return;
    }
    if (this.data.status === 'ongoing' || this.data.status === 'ended') {
      wx.showToast({ title: '该课程已开始/结束，无法预订', icon: 'none' });
      return;
    }
    const { course } = this.data;
    app.globalData.currentCourse = {
      session_id: course.id,
      id: course.id,
      name: course.name,
      coach: course.coach,
      venue: course.venue,
      time: `${course.start}-${course.end}`,
      price: course.price,
      img: course.img
    };
    wx.navigateTo({ url: '/pages/student-pay/index' });
  }
});
