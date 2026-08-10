const mock = require('../../utils/mock.js');

Page({
  data: {
    stats: [],
    hotCourses: []
  },

  onLoad() {
    this.setData({
      stats: mock.adminStats,
      hotCourses: mock.hotCourses
    });
  },

  nav(e) {
    const page = e.currentTarget.dataset.page;
    const urls = {
      dashboard: '/pages/admin-dashboard/index',
      schedule: '/pages/admin-schedule/index',
      venues: '/pages/admin-venues/index',
      students: '/pages/admin-students/index',
      coaches: '/pages/admin-coaches/index',
      revenue: '/pages/admin-revenue/index'
    };
    if (page === 'dashboard') {
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

  // 退出登录，返回登录页
  exitToStudent() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
