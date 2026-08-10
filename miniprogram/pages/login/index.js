const app = getApp();
const api = require('../../utils/api.js');
const i18n = require('../../utils/i18n.js');

Page({
  data: {
    agreed: true,          // 默认勾选协议
    loggingIn: false,
    showProfile: false,    // 完善资料弹层
    tempAvatar: '/images/2_556.png',  // 待确认头像
    tempNick: '',            // 待确认昵称
    lang: 'zh',              // 当前语言
    t: i18n.t()              // 语言字典
  },

  onLoad() {
    this.setData({
      lang: i18n.getLang() || 'zh',
      t: i18n.t()
    });
  },

  // ===== 语言切换 =====
  switchLang() {
    const next = this.data.lang === 'zh' ? 'en' : 'zh';
    if (app.switchLang(next)) {
      this.setData({ lang: next, t: i18n.t() });
      wx.showToast({ title: next === 'en' ? 'English' : '中文', icon: 'none' });
    }
  },

  // 切换协议勾选
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  // ===== 演示身份快捷登录（不写数据库，直接进入对应端）=====
  quickLogin(e) {
    const role = e.currentTarget.dataset.role;
    const urls = {
      student: '/pages/student-home/index',
      coach: '/pages/coach-schedule/index',
      admin: '/pages/admin-dashboard/index'
    };
    const names = {
      student: '学员',
      coach: '教练',
      admin: '管理员'
    };
    const token = 'demo_' + role + '_' + Date.now();
    const userInfo = {
      name: names[role],
      avatar: '/images/2_556.png',
      role: role,
      totalClasses: 32,
      totalHours: '28.5h',
      totalCalories: '12,480',
      streak: 12
    };
    wx.setStorageSync('token', token);
    wx.setStorageSync('userInfo', userInfo);
    app.globalData.userInfo = userInfo;
    app.globalData.role = role;

    wx.showToast({ title: names[role] + '身份进入', icon: 'none' });
    setTimeout(() => {
      wx.switchTab({
        url: urls[role],
        fail: () => wx.redirectTo({ url: urls[role] })
      });
    }, 400);
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
  onChooseAvatar(e) {
    const url = e.detail.avatarUrl;
    if (url) {
      this.setData({ tempAvatar: url });
    }
  },
  onNickInput(e) {
    this.setData({ tempNick: e.detail.value });
  },
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

  // ===== 执行登录（对接后端：首次=注册，再次=登录）=====
  doLogin(userProfile) {
    wx.login({
      success: (res) => {
        const code = res.code || '';

        // 生成/读取持久化 openid（同一设备始终一致 → 第二次即登录）
        let openid = wx.getStorageSync('openid');
        if (!openid) {
          openid = 'uid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
          wx.setStorageSync('openid', openid);
        }

        // 请求后端注册/登录
        api.login({
          code,
          openid,
          nickname: userProfile.name || '',
          avatar: userProfile.avatar || '',
          phone: userProfile.phone || ''
        }).then((res2) => {
          const isNewUser = res2.isNewUser;
          const user = res2.user;

          // 保存登录态
          const token = 'token_' + Date.now();
          const userInfo = {
            name: user.nickname || userProfile.name || '微信用户',
            avatar: user.avatar || userProfile.avatar || '/images/2_556.png',
            phone: user.phone || '',
            openid: user.openid || openid,
            role: user.role || 'student',
            totalClasses: user.total_classes || 32,
            totalHours: user.total_hours || '28.5h',
            totalCalories: user.total_calories || '12,480',
            streak: user.streak || 12
          };
          wx.setStorageSync('token', token);
          wx.setStorageSync('userInfo', userInfo);
          app.globalData.userInfo = userInfo;
          app.globalData.role = userInfo.role;

          this.setData({ loggingIn: false });

          // 区分注册/登录提示
          wx.showToast({
            title: isNewUser ? '注册成功' : '欢迎回来',
            icon: 'none'
          });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/student-home/index' });
          }, 800);
        }).catch((err) => {
          this.setData({ loggingIn: false });
          wx.showModal({
            title: '登录失败',
            content: err.message || '无法连接服务器',
            showCancel: false,
            confirmText: '知道了'
          });
        });
      },
      fail: () => {
        this.setData({ loggingIn: false });
        wx.showToast({ title: '微信登录失败', icon: 'none' });
      }
    });
  }
});
