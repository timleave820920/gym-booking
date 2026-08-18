const mock = require('../../utils/mock.js');
const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');
const track = require('../../utils/track.js');   // 浏览埋点（DESIGN #D5）

const DEFAULT_COVER = '/images/2_193.png'; // 课程未设封面时的占位图
const DEFAULT_ADDRESS = '成都市成华区好事健身馆';
const DEFAULT_LAT = 30.6636;   // 成华区好事健身馆附近
const DEFAULT_LNG = 104.1049;
// 训练详情 placeholder（未配置时）
const DEFAULT_TRAINING = '4人一组团课，分3个部分。第一部分：热身，10分钟，跑步1km，身体操；第二部分：滑雪、滑船、农夫行走、波比跳四项循环，40分钟；第三部分：拉伸，10分钟。';
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

Page({
  data: {
    course: null,
    remaining: 0,
    capacity: 0,
    gallery: [],          // 轮播：有图=图片路径；无图=1-5 数字占位
    isPlaceholder: false,
    bookedCount: 0,
    bookedUsers: [],
    isWaitlisted: false,
    offline: false,
    t: i18n.t()
  },

  onLoad(options) {
    this.setData({ t: i18n.t() });
    // 埋点来源透传（DESIGN #D5）：列表页 goDetail 带 source=home/search
    this._source = options.source || 'home';
    const sessionId = Number(options.session_id || 0);
    if (sessionId) {
      // 真实场次（来自课程列表）
      this._sessionId = sessionId;
      this.loadSession(sessionId);
    } else {
      // 兼容旧入口：按课程 id 从演示数据取
      const id = Number(options.id || 1);
      this.showMock(mock.courses.find(c => c.id === id) || mock.courses[0], false);
    }
  },

  // 订完课从支付页返回时刷新预约状态（BUG-LEDGER #35：缺 onShow 刷新导致订课后仍显示"立即预订"）
  onShow() {
    this._viewStart = Date.now(); // 埋点：停留时长起点（DESIGN #D5）
    if (this._sessionId) this.loadSession(this._sessionId);
  },

  // 浏览埋点：离开详情页上报（含停留毫秒）；支付页跳转同样触发，语义为"本次浏览结束"
  onHide() { this.reportCourseView(); },

  onUnload() { this.reportCourseView(); },

  reportCourseView() {
    if (!this._sessionId || !this._viewStart) return;
    const duration = Date.now() - this._viewStart;
    this._viewStart = null; // 防 onHide+onUnload 双发
    track.courseView(this._sessionId, duration, this._source);
  },

  // 从后端拉取场次详情
  loadSession(sessionId) {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    api.getSession(sessionId, openid).then((res) => {
      const s = res.session;
      // 按日期+时间判断课程状态 → 三态描述文案
      const status = courseStatus.getSessionStatus(s.date, s.start_time, s.end_time);
      // 轮播图：配置了服务器端图 → 用图；未配置 → 1-5 数字占位（仍轮播演示）
      // 服务器端图片（/uploads/ 相对路径）需拼完整 URL，否则小程序按包内路径解析 404/500
      const fullUrl = (p) => (p && p.startsWith('/uploads/')) ? (api.TCB_BASE_URL + p) : p;
      const images = (s.images || []).filter(Boolean).slice(0, 5).map(fullUrl);
      const isPlaceholder = images.length === 0;
      const gallery = isPlaceholder ? ['1', '2', '3', '4', '5'] : images;
      // 年月日小字（2026-08-15 → 2026年8月15日 周六）
      const d = new Date(s.date + 'T00:00:00');
      const dateText = isNaN(d.getTime())
        ? s.date
        : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
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
          coachId: s.coach_id,
          coachAvatar: fullUrl(s.coach_avatar),
          coachBio: s.coach_bio || '资深认证教练，经验丰富',
          start: s.start_time,
          end: s.end_time,
          price: (s.price_fen / 100).toFixed(0),
          img: fullUrl(s.cover) || DEFAULT_COVER,
          date: s.date,
          dateText,
          address: s.address || DEFAULT_ADDRESS,
          lat: Number(s.lat) || DEFAULT_LAT,
          lng: Number(s.lng) || DEFAULT_LNG,
          // 简要标题：管理员配置 summary 优先，回退卖点标签
          sub: s.course_summary || this.buildSub(s.course_tags)
        },
        remaining: s.remaining,
        capacity: s.capacity,
        gallery,
        isPlaceholder,
        bookedCount: (s.bookedUsers || []).length,
        bookedUsers: s.bookedUsers || [],
        isBooked: !!s.booked_by_me,
        isWaitlisted: !!s.waitlisted_by_me,
        // 排位人数（DESIGN #D3）：waitlistCount 总是返回；myWaitPosition 仅已排位时有值（前面还有 N 人）
        waitlistCount: s.waitlist_count || 0,
        myWaitPosition: s.my_wait_position,
        status,
        // 训练详情：管理员配置的长文描述；未配置回退 placeholder
        descText: s.course_desc || DEFAULT_TRAINING,
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
      gallery: ['1', '2', '3', '4', '5'],
      isPlaceholder: true,
      bookedCount: 0,
      bookedUsers: [],
      status: 'upcoming',
      descText: DEFAULT_TRAINING,
      offline
    });
  },

  goBack() {
    wx.navigateBack();
  },

  // 分享给微信好友 / 微信群
  onShareAppMessage() {
    const { course } = this.data;
    return {
      title: `${course.name} · ${course.start}-${course.end}，约课一起练！`,
      path: '/pages/student-course-detail/index?session_id=' + (course.id || 0),
      imageUrl: course.img || DEFAULT_COVER
    };
  },

  // 导航：唤起地图 App
  openMap() {
    const { course } = this.data;
    wx.openLocation({
      latitude: Number(course.lat),
      longitude: Number(course.lng),
      name: course.venue || course.name,
      address: course.address,
      scale: 16,
      fail: (err) => {
        console.warn('[openLocation]', err);
        wx.showToast({ title: '暂无法唤起地图', icon: 'none' });
      }
    });
  },

  // 2026-08-15: 教练卡片 → 教练介绍页
  goCoachProfile(e) {
    const coachId = e.currentTarget.dataset.coach;
    if (!coachId) {
      wx.showToast({ title: '暂无教练信息', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/coach-profile/index?coach_id=' + coachId });
  },

  // 立即预订 -> 直接进入支付页（携带真实场次数据）
  bookNow() {
    if (this.data.isBooked) {
      wx.showToast({ title: '您已预订该课程', icon: 'none' });
      return;
    }
    if (this.data.isWaitlisted) {
      wx.showToast({ title: '排位中，等待转正', icon: 'none' });
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
      coachAvatar: course.coachAvatar,
      venue: course.venue,
      time: `${course.start}-${course.end}`,
      date: course.date,
      dateText: course.dateText,
      price: Number(course.price),
      img: course.img,
      mode: 'book'
    };
    wx.navigateTo({ url: '/pages/student-pay/index' });
  }
});
