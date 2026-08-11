App({
  globalData: {
    // 默认学员信息（未登录时兜底）
    userInfo: {
      name: '微信用户',
      avatar: '/images/2_556.png',
      totalClasses: 32,
      totalHours: '28.5h',
      totalCalories: '12,480',
      streak: 12
    },
    role: 'student',
    // 当前选中的课程（从列表/详情进入支付时传递）
    currentCourse: null,
    // 云开发是否已初始化
    cloudInited: false
  },

  onLaunch(options) {
    // 邀请追踪：从分享卡片打开时捕获邀请人（path 带 ?inviter=xxx），登录后绑定
    if (options && options.query && options.query.inviter) {
      wx.setStorageSync('pending_inviter', options.query.inviter);
    }
    // 初始化语言（默认中文，从缓存恢复用户偏好）
    const i18n = require('./utils/i18n.js');
    this.globalData.lang = i18n.loadLang();

    // 云开发模式：初始化 wx.cloud（USE_CLOUD=true 时生效）
    try {
      const api = require('./utils/api.js');
      if (api.USE_CLOUD && wx.cloud) {
        wx.cloud.init({ env: api.CLOUD_ENV, traceUser: true });
        this.globalData.cloudInited = true;
        console.log('[cloud] 云开发已初始化 env=' + api.CLOUD_ENV);
      }
    } catch (e) {
      console.warn('[cloud] 云开发初始化跳过', e.message);
    }

    // 读取本地登录态
    const token = wx.getStorageSync('token');
    const savedUser = wx.getStorageSync('userInfo');
    if (token && savedUser) {
      this.globalData.userInfo = savedUser;
      this.globalData.role = savedUser.role || 'student';
    }
  },

  // 切换语言（返回 true 表示需要刷新页面）
  switchLang(lang) {
    const i18n = require('./utils/i18n.js');
    const ok = i18n.setLang(lang);
    if (ok) {
      this.globalData.lang = lang;
      wx.setStorageSync('lang', lang);
    }
    return ok;
  },

  // 是否已登录
  isLoggedIn() {
    return !!wx.getStorageSync('token');
  },

  // 退出登录
  logout() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    this.globalData.role = 'student';
    this.globalData.userInfo = {
      name: '微信用户',
      avatar: '/images/2_556.png',
      totalClasses: 32,
      totalHours: '28.5h',
      totalCalories: '12,480',
      streak: 12
    };
  }
})
