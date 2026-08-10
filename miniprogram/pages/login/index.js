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

  // ===== 微信一键登录 =====
  login() {
    if (!this.checkAgree()) return;
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });

    // 获取微信授权（系统弹框：询问是否允许使用微信号/头像/手机号）
    wx.getUserProfile({
      desc: '用于登录及完善会员资料',
      success: (profileRes) => {
        const wxUser = profileRes.userInfo || {};
        this.doLogin({
          avatar: wxUser.avatarUrl || '/images/2_556.png',
          name: wxUser.nickName || '微信用户'
        });
      },
      fail: () => {
        // 拒绝授权 → 演示模式模拟问询
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

  // ===== 手机号快捷登录 =====
  // 通过 button open-type="getPhoneNumber" 触发，企业认证小程序可直接获取
  phoneLogin(e) {
    if (!this.checkAgree()) return;
    if (this.data.loggingIn) return;

    const detail = e.detail || {};
    if (detail.errMsg && detail.errMsg.indexOf('ok') > -1 && detail.code) {
      // 真实环境：code 是动态令牌，发给后端换取手机号
      this.setData({ loggingIn: true });
      // 演示：模拟后端用 code 换手机号
      setTimeout(() => {
        this.doLogin({
          avatar: '/images/2_556.png',
          name: '微信用户',
          phone: '138****2210' // 演示脱敏手机号
        });
      }, 600);
    } else {
      // 未认证小程序 / 用户拒绝 → 演示模式模拟问询
      wx.showModal({
        title: '手机号快捷登录',
        content: '是否允许使用微信绑定的手机号登录本小程序？',
        confirmText: '允许',
        cancelText: '拒绝',
        success: (res) => {
          if (res.confirm) {
            this.setData({ loggingIn: true });
            setTimeout(() => {
              this.doLogin({
                avatar: '/images/2_556.png',
                name: '微信用户',
                phone: '138****2210'
              });
            }, 600);
          }
        }
      });
    }
  },

  // 协议校验
  checkAgree() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' });
      return false;
    }
    return true;
  },

  // 执行登录（演示模式：wx.login 获取 code，不真正请求后端）
  doLogin(userProfile) {
    wx.login({
      success: (res) => {
        const code = res.code; // 演示版仅记录
        setTimeout(() => {
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
