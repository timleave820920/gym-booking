const api = require('../../utils/api.js');

Page({
  data: {
    students: [],
    loading: true,
    totalCount: 0,
    dbConnected: false
  },

  onLoad() {
    this.loadStudents();
  },

  onPullDownRefresh() {
    this.loadStudents(() => wx.stopPullDownRefresh());
  },

  // 从真实数据库加载学员
  loadStudents(callback) {
    this.setData({ loading: true });
    api.getUsers().then((res) => {
      const students = res.users.map(u => ({
        id: u.id,
        name: u.nickname || '微信用户',
        avatar: u.avatar || '/images/2_556.png',
        phone: u.phone || '未绑定手机号',
        status: this.getStatus(u),
        classes: u.total_classes || 0,
        loginCount: u.login_count || 0,
        createdAt: u.created_at || '',
        lastLogin: u.last_login_at || '',
        role: u.role || 'student'
      }));
      this.setData({
        students,
        totalCount: students.length,
        loading: false,
        dbConnected: true
      });
      if (callback) callback();
    }).catch(() => {
      this.setData({ loading: false, dbConnected: false });
      if (callback) callback();
    });
  },

  // 学员状态：根据角色和登录次数推断
  getStatus(u) {
    if (u.role === 'coach') return { text: '教练', type: 'purple' };
    if (u.role === 'admin') return { text: '管理员', type: 'dark' };
    // 学员：按登录次数划分活跃度
    if (u.login_count >= 5) return { text: '忠实学员', type: 'green' };
    if (u.login_count >= 2) return { text: '活跃学员', type: 'green' };
    return { text: '新学员', type: 'orange' };
  },

  // 头像加载失败 → 回退默认头像
  avatarError(e) {
    const id = e.currentTarget.dataset.id;
    const students = this.data.students.map(s => {
      if (s.id === id) return { ...s, avatar: '/images/2_556.png' };
      return s;
    });
    this.setData({ students });
  },

  nav(e) {
    const page = e.currentTarget.dataset.page;
    const urls = {
      dashboard: '/pages/admin-dashboard/index',
      schedule: '/pages/admin-schedule/index',
      venues: '/pages/admin-venues/index',
      coaches: '/pages/admin-coaches/index',
      revenue: '/pages/admin-revenue/index'
    };
    if (page === 'students') {
      wx.showToast({ title: '当前页', icon: 'none' });
      return;
    }
    wx.redirectTo({ url: urls[page] });
  },

  add() {
    wx.showToast({ title: '添加学员', icon: 'none' });
  },

  edit() {
    wx.showToast({ title: '编辑学员', icon: 'none' });
  },

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
