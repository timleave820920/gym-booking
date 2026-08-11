const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    tab: 0,
    courses: [],        // 订课 + 候补排位（同一列表，界面一致）
    loading: true
  },

  onLoad() {
    this.loadAll();
  },

  onShow() {
    // 每次显示刷新（支付/退订/退出候补/转正后立即更新）
    this.loadAll();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  // 加载订课 + 候补排位，合并到同一列表（候补排在订课后）
  loadAll() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ courses: [], loading: false });
      return;
    }
    this.setData({ loading: true });
    Promise.all([api.getMyBookings(openid), api.getMyWaitlist(openid)])
      .then(([bRes, wRes]) => {
        // 已订课（booked），退订的(cancelled)不显示
        const booked = (bRes.bookings || [])
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
            isWait: false,
            checked: b.checkin_at ? true : false
          }));
        // 候补排位中（waiting）→ 与订课同列表展示，按钮显示"排位"
        const waits = (wRes.waits || [])
          .filter(w => w.status === 'waiting')
          .map(w => ({
            id: w.id,
            sessionId: w.session_id,
            name: w.course_name,
            coach: w.coach_name,
            venue: w.venue_name,
            date: w.date,
            time: w.start_time,
            end: w.end_time,
            duration: '候补',
            price: (w.amount_fen / 100).toFixed(0),
            status: '候补中',
            statusType: 'waiting',
            isWait: true,
            checked: false
          }));
        this.setData({ courses: booked.concat(waits), loading: false });
      })
      .catch(() => {
        this.setData({ courses: [], loading: false });
      });
  },

  // 排位按钮提示（候补状态说明）
  showWaitHint() {
    wx.showToast({ title: '已进入候补队列，有人取消将自动转正', icon: 'none' });
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
            this.loadAll();
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
            this.loadAll();
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
