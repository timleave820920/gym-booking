const app = getApp();

Page({
  data: {
    agreed: true,          // 默认勾选协议
    loggingIn: false
  },

  // 切换协议勾选
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  // 微信一键登录（默认学员身份）
  login() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' });
      return;
    }
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });

    // 1. 获取微信授权（系统弹框：询问是否允许使用微信号/头像/手机号）
    wx.getUserProfile({
      desc: '用于登录及完善会员资料',
      success: (profileRes) => {
        // 用户已授权 → 使用微信真实头像/昵称
        const wxUser = profileRes.userInfo || {};
        this.doLogin({
          avatar: wxUser.avatarUrl || '/images/2_556.png',
          name: wxUser.nickName || '微信用户'
        });
      },
      fail: () => {
        // 用户拒绝授权 → 演示模式：模拟问询使用微信号/手机号
        wx.showModal({
          title: '授权登录',
          content: '是否允许使用微信号/手机号登录本小程序？',
          confirmText: '允许',
          cancelText: '拒绝',
          success: (res) => {
            if (res.confirm) {
              this.doLogin({ avatar: '/images/2_556.png', name: '微信用户' });
            } else {
              this.setData({ loggingIn: false });
              wx.showToast({ title: '已取消登录', icon: 'none' });
            }
          }
        });
      }
    });
  },

  // 执行登录（演示模式：wx.login 获取 code，不真正请求后端）
  doLogin(userProfile) {
    wx.login({
      success: (res) => {
        const code = res.code; // 演示版仅记录
        setTimeout(() => {
          // 保存登录态：微信真实用户数据 + 默认学员身份
          const token = 'demo_' + Date.now();
          const userInfo = {
            ...userProfile,
            role: 'student',
            totalClasses: 32,
            totalHours: '28.5h',
            totalCalories: '12,480',
            streak: 12
          };
          wx.setStorageSync('token', token);
          wx.setStorageSync('userInfo', userInfo);
          app.globalData.userInfo = userInfo;
          app.globalData.role = 'student';

          this.setData({ loggingIn: false });
          wx.showToast({ title: '登录成功', icon: 'success' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/student-home/index' });
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
