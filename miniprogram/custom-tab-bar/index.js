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

  // 页面每次显示时，按当前路由自动高亮对应 tab（根治首次进入不高亮问题）
  pageLifetimes: {
    show() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const route = current && current.route ? '/' + current.route : '';
      const idx = this.data.list.findIndex(item => item.pagePath === route);
      if (idx >= 0 && idx !== this.data.selected) {
        this.setData({ selected: idx });
      }
    }
  },

  methods: {
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset;
      wx.switchTab({ url: path });
    }
  }
});
