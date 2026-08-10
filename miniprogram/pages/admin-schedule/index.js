const mock = require('../../utils/mock.js');

Page({
  data: {
    weekDays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    events: [
      { id: 1, name: '杠铃操 · 全身塑形', meta: '大壮 · 08:00-09:00', color: '#E5FFC9', text: '#3D9970' },
      { id: 2, name: 'HIIT 高强度燃脂', meta: '阿凯 · 10:00-11:00', color: '#DCD8FF', text: '#5B57EB' },
      { id: 3, name: '空中瑜伽', meta: '小满 · 08:30-09:30', color: '#FFF0D6', text: '#D97706' },
      { id: 4, name: '动感单车', meta: '阿凯 · 14:00-15:00', color: '#FFE3E3', text: '#E5484D' },
      { id: 5, name: '战绳燃脂', meta: '阿凯 · 19:00-20:00', color: '#E5FFC9', text: '#3D9970' },
      { id: 6, name: '普拉提核心', meta: '小满 · 10:00-11:00', color: '#DCD8FF', text: '#5B57EB' }
    ],
    times: ['08:00', '09:00', '10:00', '11:00'],
    // 刷新设置（默认每周一 00:00）
    refreshWeekday: 1,
    refreshTime: '00:00',
    refreshDesc: '每周一 00:00'
  },

  nav(e) {
    const page = e.currentTarget.dataset.page;
    const urls = {
      dashboard: '/pages/admin-dashboard/index',
      venues: '/pages/admin-venues/index',
      students: '/pages/admin-students/index',
      coaches: '/pages/admin-coaches/index',
      revenue: '/pages/admin-revenue/index'
    };
    if (page === 'schedule') {
      wx.showToast({ title: '当前页', icon: 'none' });
      return;
    }
    wx.redirectTo({ url: urls[page] });
  },

  // 配置排课 -> 跳转到排课配置页
  createCourse() {
    wx.navigateTo({ url: '/pages/admin-create-course/index' });
  },

  // 修改刷新设置（星期选择）
  openRefreshSetting() {
    wx.showActionSheet({
      itemList: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      success: (res) => {
        const weekday = res.tapIndex + 1;
        this.setData({
          refreshWeekday: weekday,
          refreshDesc: `每周${['一','二','三','四','五','六','日'][weekday - 1]} ${this.data.refreshTime}`
        });
      }
    });
  },

  // 修改刷新时间
  onRefreshTime(e) {
    this.setData({
      refreshTime: e.detail.value,
      refreshDesc: `每周${['一','二','三','四','五','六','日'][this.data.refreshWeekday - 1]} ${e.detail.value}`
    });
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
