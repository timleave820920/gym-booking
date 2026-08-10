App({
  globalData: {
    // 默认学员信息（未登录时兜底）
    userInfo: {
      name: '小陈同学',
      avatar: '/images/2_556.png',
      totalClasses: 32,
      totalHours: '28.5h',
      totalCalories: '12,480',
      streak: 12
    },
    role: 'student',
    // 当前选中的课程（从列表/详情进入支付时传递）
    currentCourse: null
  },

  onLaunch() {
    // 读取本地登录态
    const token = wx.getStorageSync('token');
    const savedUser = wx.getStorageSync('userInfo');
    if (token && savedUser) {
      this.globalData.userInfo = savedUser;
      this.globalData.role = savedUser.role || 'student';
    }
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
      name: '小陈同学',
      avatar: '/images/2_556.png',
      totalClasses: 32,
      totalHours: '28.5h',
      totalCalories: '12,480',
      streak: 12
    };
  }
})
