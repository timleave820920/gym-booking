Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/student-home/index', text: '首页', icon: 'home', selectedIcon: 'home' },
      { pagePath: '/pages/student-courses/index', text: '课程', icon: 'grid', selectedIcon: 'grid' },
      { pagePath: '/pages/student-my-courses/index', text: '我的课', icon: 'check', selectedIcon: 'check' },
      { pagePath: '/pages/student-profile/index', text: '我的', icon: 'user', selectedIcon: 'user' }
    ]
  },

  methods: {
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset;
      wx.switchTab({ url: path });
    }
  }
});
