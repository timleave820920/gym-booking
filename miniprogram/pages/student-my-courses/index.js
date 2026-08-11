const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    tab: 0,
    courses: [],
    waits: [],
    loading: true
  },

  onLoad() {
    this.loadBookings();
    this.loadWaitlist();
  },

  onShow() {
    // 每次显示刷新（支付/退订/转正后立即更新）
    this.loadBookings();
    this.loadWaitlist();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  // 从后端加载真实订课
  loadBookings() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ courses: [], loading: false });
      return;
    }
    api.getMyBookings(openid).then((res) => {
      // 只显示已订课（booked），退订的(cancelled)不显示
      const courses = (res.bookings || [])
        .filter(b => b.status === 'booked')
        .map(b => ({
          id: b.id,
          sessionId: b.session_id,
          name: b.course_name,
          coach: b.coach_name,
          venue: b.venue_name,
          date: b.date,
          time: b.start_time,
          end: b.end_time,
          duration: `${b.duration_min}分钟`,
          price: (b.amount_fen / 100).toFixed(0),
          status: '待上课',
          statusType: 'pending',
          checked: b.checkin_at ? true : false
        }));
      this.setData({ courses, loading: false });
    }).catch(() => {
      this.setData({ courses: [], loading: false });
    });
  },

  // 从后端加载候补排位（附带过期退款任务）
  loadWaitlist() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ waits: [] });
      return;
    }
    api.getMyWaitlist(openid).then((res) => {
      const waits = (res.waits || []).map(w => ({
        id: w.id,
        sessionId: w.session_id,
        name: w.course_name,
        coach: w.coach_name,
        venue: w.venue_name,
        date: w.date,
        time: w.start_time,
        end: w.end_time,
        price: (w.amount_fen / 100).toFixed(0),
        status: w.status,          // waiting/promoted/refunded/cancelled
        statusText: this.waitStatusText(w.status)
      }));
      this.setData({ waits, loading: false });
    }).catch(() => {
      this.setData({ waits: [], loading: false });
    });
  },

  // 候补状态文案
  waitStatusText(status) {
    const map = {
      waiting: '候补中',
      promoted: '已转正',
      refunded: '已退款',
      cancelled: '已退出'
    };
    return map[status] || status;
  },

  // 退出候补（退款）
  exitWaitlist(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    wx.showModal({
      title: '退出候补',
      content: `退出「${name}」候补后费用将原路退回，确定退出吗？`,
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          api.cancelWaitlist(openid, id).then(() => {
            wx.showToast({ title: '已退出候补', icon: 'success' });
            this.loadWaitlist();
          }).catch((err) => {
            wx.showToast({ title: err.message || '操作失败', icon: 'none' });
          });
        }
      }
    });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.idx });
  },

  // 退订（真实调用后端）
  refund(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    wx.showModal({
      title: '确认退订',
      content: `退订「${name}」后名额将释放，确定退订吗？`,
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          api.cancelBooking(openid, id).then(() => {
            wx.showToast({ title: '已退订', icon: 'success' });
            this.loadBookings();
          }).catch((err) => {
            wx.showToast({ title: err.message || '退订失败', icon: 'none' });
          });
        }
      }
    });
  },

  checkin() {
    wx.navigateTo({ url: '/pages/student-checkin/index' });
  },

  goHome() { wx.switchTab({ url: '/pages/student-home/index' }); },
  goCourses() { wx.switchTab({ url: '/pages/student-courses/index' }); },
  goProfile() { wx.switchTab({ url: '/pages/student-profile/index' }); }
});
