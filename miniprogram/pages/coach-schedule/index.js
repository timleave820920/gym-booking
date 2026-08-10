const mock = require('../../utils/mock.js');

Page({
  data: {
    coach: { name: '阿凯' },
    schedule: []
  },

  onLoad() {
    this.setData({ schedule: mock.coachSchedule });
  },

  goStudents(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/coach-students/index?id=${id}` });
  },

  goScan() {
    wx.navigateTo({ url: '/pages/coach-scan/index' });
  },

  goProfile() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
