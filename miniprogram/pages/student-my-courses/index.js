const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    tab: 0,
    courses: [],
    loading: true
  },

  onLoad() {
    this.loadBookings();
  },

  onShow() {
    // 每次显示刷新（支付/退订后立即更新）
    this.loadBookings();
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
