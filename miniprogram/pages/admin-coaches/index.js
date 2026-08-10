const mock = require('../../utils/mock.js');

Page({
  data: { coaches: [] },

  onLoad() {
    this.setData({ coaches: mock.adminCoaches });
  },

  nav(e) {
    const page = e.currentTarget.dataset.page;
    const urls = {
      dashboard: '/pages/admin-dashboard/index',
      schedule: '/pages/admin-schedule/index',
      venues: '/pages/admin-venues/index',
      students: '/pages/admin-students/index',
      revenue: '/pages/admin-revenue/index'
    };
    if (page === 'coaches') {
      wx.showToast({ title: '当前页', icon: 'none' });
      return;
    }
    wx.redirectTo({ url: urls[page] });
  },

  add() {
    wx.showToast({ title: '添加教练', icon: 'none' });
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
