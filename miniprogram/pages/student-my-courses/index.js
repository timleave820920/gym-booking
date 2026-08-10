const mock = require('../../utils/mock.js');

Page({
  data: {
    tab: 0,
    courses: []
  },

  onLoad() {
    this.setData({ courses: mock.myCourses });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.idx });
  },

  refund(e) {
    wx.showModal({
      title: '确认退订',
      content: '退订后名额将释放，确定要退订这门课吗？',
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          wx.showToast({ title: '已退订', icon: 'success' });
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
