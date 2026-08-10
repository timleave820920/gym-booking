const app = getApp();

Page({
  data: {
    agreed: true,          // 默认勾选协议
    roles: [
      { id: 'student', name: '学员', icon: 'role-student', selected: true },
      { id: 'coach', name: '教练', icon: 'role-coach', selected: false },
      { id: 'admin', name: '管理员', icon: 'role-admin', selected: false }
    ],
    loggingIn: false
  },

  // 切换协议勾选
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  // 选择登录身份（演示模式）
  selectRole(e) {
    const id = e.currentTarget.dataset.id;
    const roles = this.data.roles.map(r => ({
      ...r, selected: r.id === id
    }));
    this.setData({ roles });
  },

  // 微信一键登录
  login() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' });
      return;
    }
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });

    const role = this.data.roles.find(r => r.selected);

    // 真实环境：wx.login 获取 code → 发给后端换 openid/session
    // 演示环境：直接模拟登录成功
    wx.login({
      success: (res) => {
        const code = res.code; // 演示版仅记录，不真正请求后端
        setTimeout(() => {
          // 保存登录态
          const token = 'demo_' + Date.now();
          wx.setStorageSync('token', token);
          wx.setStorageSync('userInfo', {
            name: role.id === 'student' ? '小陈同学' : (role.id === 'coach' ? '阿凯教练' : '管理员'),
            role: role.id,
            avatar: role.id === 'student' ? '/images/2_556.png' : (role.id === 'coach' ? '/images/2_645.png' : '/images/2_1409.png')
          });
          app.globalData.userInfo = wx.getStorageSync('userInfo');
          app.globalData.role = role.id;

          this.setData({ loggingIn: false });
          wx.showToast({ title: '登录成功', icon: 'success' });

          // 按角色跳转
          setTimeout(() => {
            if (role.id === 'student') {
              wx.switchTab({ url: '/pages/student-home/index' });
            } else if (role.id === 'coach') {
              wx.redirectTo({ url: '/pages/coach-schedule/index' });
            } else {
              wx.redirectTo({ url: '/pages/admin-dashboard/index' });
            }
          }, 600);
        }, 800);
      },
      fail: () => {
        this.setData({ loggingIn: false });
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      }
    });
  }
});
