const app = getApp();

Page({
  data: {
    agreed: true,          // 默认勾选协议
    loggingIn: false,
    showProfile: false,    // 完善资料弹层
    tempAvatar: '/images/2_556.png',  // 待确认头像
    tempNick: ''            // 待确认昵称
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

    wx.getUserProfile({
      desc: '用于登录及完善会员资料',
      success: (profileRes) => {
        const wxUser = profileRes.userInfo || {};
        const profile = {
          avatar: wxUser.avatarUrl || '/images/2_556.png',
          name: wxUser.nickName || '微信用户'
        };
        this.finishLogin(profile);
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
              this.finishLogin({ avatar: '/images/2_556.png', name: '微信用户' });
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
  phoneLogin(e) {
    if (!this.checkAgree()) return;
    if (this.data.loggingIn) return;

    const detail = e.detail || {};
    if (detail.errMsg && detail.errMsg.indexOf('ok') > -1 && detail.code) {
      // 真实环境：code 发给后端换手机号
      this.setData({ loggingIn: true });
      setTimeout(() => {
        this.finishLogin({
          avatar: '/images/2_556.png',
          name: '微信用户',
          phone: '138****2210'
        });
      }, 600);
    } else {
      // 未认证/拒绝 → 演示模式模拟问询
      wx.showModal({
        title: '手机号快捷登录',
        content: '是否允许使用微信绑定的手机号登录本小程序？',
        confirmText: '允许',
        cancelText: '拒绝',
        success: (res) => {
          if (res.confirm) {
            this.setData({ loggingIn: true });
            setTimeout(() => {
              this.finishLogin({
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

  // 登录完成：昵称是默认值时弹出完善资料，否则直接进首页
  finishLogin(profile) {
    const needProfile = !profile.name || profile.name === '微信用户' || profile.name === '小陈同学';
    if (needProfile) {
      // 弹出完善资料（使用微信昵称填写能力）
      this.setData({
        loggingIn: false,
        showProfile: true,
        tempAvatar: profile.avatar || '/images/2_556.png',
        tempNick: ''
      });
    } else {
      this.doLogin(profile);
    }
  },

  // ===== 完善资料 =====
  // 选择微信头像（open-type="chooseAvatar"）
  onChooseAvatar(e) {
    const url = e.detail.avatarUrl;
    if (url) {
      this.setData({ tempAvatar: url });
    }
  },
  // 输入昵称（type="nickname"，键盘上方可一键使用微信昵称）
  onNickInput(e) {
    this.setData({ tempNick: e.detail.value });
  },
  // 完成完善资料
  confirmProfile() {
    const nick = (this.data.tempNick || '').trim();
    if (!nick) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    this.setData({ showProfile: false });
    this.doLogin({
      avatar: this.data.tempAvatar,
      name: nick
    });
  },

  // 执行登录
  doLogin(userProfile) {
    wx.login({
      success: (res) => {
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
