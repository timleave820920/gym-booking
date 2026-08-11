Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/student-courses/index', text: '预约', icon: 'grid', selectedIcon: 'grid' },
      { pagePath: '/pages/student-my-courses/index', text: '上课', icon: 'check', selectedIcon: 'check' },
      { pagePath: '/pages/member-center/index', text: '活动', icon: 'flag', selectedIcon: 'flag' },
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
