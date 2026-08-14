const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    member: null,        // 会员卡数据（等级/余额/升级提示）
    coinBalance: 0,
    passInfo: { hasPass: false },   // 次数包信息（剩余次数/过期天数）
    menus: [
      [
        { icon: 'check', name: '我的课程', url: '/pages/student-orders/index?type=course' },
        { icon: 'trophy', name: '成就与记录', url: '/pages/student-achievements/index' }
      ],
      [
        { icon: 'wallet', name: '我的订单', url: '/pages/student-orders/index?type=recharge' },
        { icon: 'bell', name: '消息通知', url: '/pages/student-messages/index', badge: 0 }
      ],
      [
        { icon: 'edit', name: '联系客服', url: '/pages/contact-us/index' }
      ]
    ]
  },

  onLoad() {
    // 用户卡已移除，无需加载头像/昵称/锻炼次数
  },

  onShow() {
    this.loadBalance();       // 加载余额（无动画）
    this.loadUnread();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
  },

  // 拉取未读消息数 → 消息通知入口角标
  loadUnread() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getUnreadCount(openid).then((res) => {
      const n = res.unread || 0;
      const menus = this.data.menus.map(group =>
        group.map(item => item.name === '消息通知' ? { ...item, badge: n } : item)
      );
      this.setData({ menus });
    }).catch(() => {});
  },

  // 从 desc 提取当前数字（避免重复刷新丢失）
  // 加载会员卡数据（等级/余额/能量币/未读奖励）
  loadBalance() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getMemberLevel(openid).then((res) => {
      const lv = res.level;
      const balance = (lv.balanceFen / 100).toFixed(2);
      this.setData({
        member: {
          name: lv.levelName,
          lv: lv.levelLv,
          icon: lv.levelIcon || '🏅',
          balance,
          // 升级提示：仅显示"再上N节课升级X"（2026-08-14 用户要求去掉"会员价折扣"后半句）
          hint: lv.next ? `再上 ${lv.next.min - lv.totalClasses} 节课升级${lv.next.name}` : '已达最高等级'
        },
        coinBalance: lv.coinBalance || 0
      });
    }).catch(() => {});
    // 次数包（次卡）信息：剩余次数 / 过期天数
    api.getMyPass(openid).then((res) => {
      this.setData({ passInfo: res.pass || { hasPass: false } });
    }).catch(() => {
      this.setData({ passInfo: { hasPass: false } });
    });
  },

  // 会员等级（替代原「电子会员卡」页，产品决策 2026-08-13：去掉我的会员卡页面，直接进等级页）
  goMemberLevel() {
    wx.navigateTo({ url: '/pages/member-level/index' });
  },

  // 去充值
  goRecharge() {
    wx.navigateTo({ url: '/pages/member-recharge/index' });
  },

  // 能量商店
  goCoinShop() {
    wx.navigateTo({ url: '/pages/coin-shop/index' });
  },

  // 次数包：去购买/查看
  goPass() {
    wx.navigateTo({ url: '/pages/passes-buy/index' });
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

  goHome() { wx.switchTab({ url: '/pages/member-center/index' }); },
  goCourses() { wx.switchTab({ url: '/pages/student-courses/index' }); },
  goMy() { wx.switchTab({ url: '/pages/student-my-courses/index' }); }
});
