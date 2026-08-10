const api = require('../../utils/api.js');

Page({
  data: {
    loading: true,
    dbConnected: false,
    totalUsers: 0,
    users: [],
    dbPath: 'server/data/gym.db'
  },

  onLoad() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData(() => wx.stopPullDownRefresh());
  },

  // 加载用户列表 + 统计
  loadData(callback) {
    this.setData({ loading: true });
    api.getUsers().then((res) => {
      const users = res.users.map(u => ({
        id: u.id,
        name: u.nickname || '微信用户',
        avatar: u.avatar || '/images/2_556.png',
        phone: u.phone || '未绑定',
        role: u.role || 'student',
        loginCount: u.login_count || 0,
        createdAt: u.created_at || '',
        lastLogin: u.last_login_at || ''
      }));
      this.setData({
        users,
        totalUsers: users.length,
        loading: false,
        dbConnected: true
      });
      if (callback) callback();
    }).catch(() => {
      this.setData({ loading: false, dbConnected: false });
      if (callback) callback();
    });
  },

  // 删除单个用户
  deleteUser(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    wx.showModal({
      title: '删除用户',
      content: `确定删除「${name}」吗？该用户的数据将被移除。`,
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          api.deleteUser({ id }).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadData();
          }).catch((err) => {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 清空所有用户（危险操作）
  clearAll() {
    wx.showModal({
      title: '清空所有用户',
      content: `将永久删除全部 ${this.data.totalUsers} 名用户，且无法恢复！确定继续？`,
      confirmText: '全部清空',
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          // 二次确认（危险操作）
          wx.showModal({
            title: '再次确认',
            content: '这是不可逆操作，所有用户数据将被清空。是否继续？',
            confirmText: '确认清空',
            confirmColor: '#E5484D',
            success: (res2) => {
              if (res2.confirm) {
                api.clearUsers().then((r) => {
                  wx.showToast({ title: r.message || '已清空', icon: 'none' });
                  this.loadData();
                }).catch((err) => {
                  wx.showToast({ title: err.message || '清空失败', icon: 'none' });
                });
              }
            }
          });
        }
      }
    });
  },

  // 头像加载失败回退
  avatarError(e) {
    const id = e.currentTarget.dataset.id;
    const users = this.data.users.map(u => {
      if (u.id === id) return { ...u, avatar: '/images/2_556.png' };
      return u;
    });
    this.setData({ users });
  },

  // 后台导航跳转
  navTo(e) {
    const url = e.currentTarget.dataset.url;
    wx.redirectTo({ url });
  },

  // 退出登录
  exitToStudent() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
