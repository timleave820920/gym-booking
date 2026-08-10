const app = getApp();

Page({
  data: {
    user: { name: '小陈同学', avatar: '/images/2_556.png', desc: '累计锻炼 32 节课' },
    menus: [
      [
        { icon: 'check', name: '我的课程', url: '/pages/student-my-courses/index' },
        { icon: 'trophy', name: '成就与记录', url: '/pages/student-achievements/index' }
      ],
      [
        { icon: 'wallet', name: '我的钱包', url: '' },
        { icon: 'bell', name: '消息通知', url: '' }
      ],
      [
        { icon: 'edit', name: '联系客服', url: '' }
      ]
    ],
    testEntries: [
      { icon: 'coach', name: '教练端 · 今日课表', url: '/pages/coach-schedule/index', color: '#5B57EB' },
      { icon: 'admin', name: '管理后台 · 数据仪表盘', url: '/pages/admin-dashboard/index', color: '#1A1A23' }
    ]
  },

  onLoad() {
    const u = app.globalData.userInfo;
    this.setData({
      user: {
        name: u.name,
        avatar: u.avatar,
        desc: `累计锻炼 ${u.totalClasses} 节课`
      }
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
  },

  // 头像加载失败（如微信头像域名未配置）→ 回退默认头像
  avatarError() {
    this.setData({
      user: { ...this.data.user, avatar: '/images/2_556.png' }
    });
  },

  // 退出登录
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmText: '退出',
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          app.logout();
          wx.showToast({ title: '已退出', icon: 'none' });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/login/index' });
          }, 500);
        }
      }
    });
  },

  goMenu(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.navigateTo({ url });
    } else {
      wx.showToast({ title: '功能开发中', icon: 'none' });
    }
  },

  goSettings() {
    wx.showToast({ title: '设置开发中', icon: 'none' });
  },

  goHome() { wx.switchTab({ url: '/pages/student-home/index' }); },
  goCourses() { wx.switchTab({ url: '/pages/student-courses/index' }); },
  goMy() { wx.switchTab({ url: '/pages/student-my-courses/index' }); }
});
