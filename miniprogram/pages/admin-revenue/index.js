const api = require('../../utils/api.js');

Page({
  data: {
    stats: [],
    sources: [],
    monthly: [],
    maxValue: 200,
    loaded: false,
    offline: false
  },

  onLoad() {
    this.loadRevenue();
  },

  // 从后端拉取真实营收数据
  loadRevenue() {
    api.getRevenueStats().then((res) => {
      const monthly = res.monthly || [];
      const maxValue = monthly.length > 0
        ? Math.max(...monthly.map(m => m.value), 1)
        : 200;
      this.setData({
        stats: res.stats || [],
        sources: res.sources || [],
        monthly,
        maxValue,
        loaded: true,
        offline: false
      });
    }).catch(() => {
      // 后端不可用：显示空数据（避免假数据误导）
      this.setData({
        stats: [
          { label: '本月营收', value: '¥ 0', trend: '后端未连接', dark: true },
          { label: '本月订单', value: '0', trend: '暂无数据' },
          { label: '累计营收', value: '¥ 0', trend: '暂无数据' },
          { label: '退款总额', value: '¥ 0', trend: '暂无数据' }
        ],
        sources: [],
        monthly: [],
        maxValue: 200,
        loaded: true,
        offline: true
      });
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

  // 退出登录，返回登录页
  exitToStudent() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
