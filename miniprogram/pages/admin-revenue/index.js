const mock = require('../../utils/mock.js');

Page({
  data: {
    stats: [],
    sources: [],
    monthly: [],
    maxValue: 200
  },

  onLoad() {
    const maxValue = Math.max(...mock.monthlyRevenue.map(m => m.value));
    this.setData({
      stats: mock.revenueStats,
      sources: mock.revenueSources,
      monthly: mock.monthlyRevenue,
      maxValue
    });
  },

  nav(e) {
    const page = e.currentTarget.dataset.page;
    const urls = {
      dashboard: '/pages/admin-dashboard/index',
      schedule: '/pages/admin-schedule/index',
      venues: '/pages/admin-venues/index',
      students: '/pages/admin-students/index',
      coaches: '/pages/admin-coaches/index'
    };
    if (page === 'revenue') {
      wx.showToast({ title: '当前页', icon: 'none' });
      return;
    }
    wx.redirectTo({ url: urls[page] });
  },

  // 退出后台，返回学员端个人中心
  // 后台导航跳转
  navTo(e) {
    const url = e.currentTarget.dataset.url;
    wx.redirectTo({ url });
  },

  exitToStudent() {
    wx.switchTab({ url: '/pages/student-profile/index' });
  }
});
