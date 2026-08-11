const app = getApp();
const api = require('../../utils/api.js');

const TAB_PAGES = ['/pages/student-courses/index', '/pages/student-my-courses/index', '/pages/member-center/index', '/pages/student-profile/index'];
// 类型图标
const TYPE_ICONS = {
  booking: '课',
  waitlist: '转',
  order: '¥',
  remind: '铃',
  member: 'Lv',
  promo: '活',
  system: '公'
};

Page({
  data: {
    messages: [],
    loading: true,
    finished: false,
    page: 1,
    unread: 0
  },

  onLoad() {
    this.loadMore();
  },

  onShow() {
    // 返回本页刷新未读数
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (openid) {
      api.getUnreadCount(openid).then(res => this.setData({ unread: res.unread || 0 })).catch(() => {});
    }
  },

  // 上拉加载更多 / 首屏加载
  loadMore() {
    if (this.data.loading || this.data.finished) return;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ loading: false });
      return;
    }
    this.setData({ loading: true });
    api.getMessages(openid, this.data.page).then((res) => {
      const list = (res.messages || []).map(m => ({
        id: m.id,
        type: m.type,
        icon: TYPE_ICONS[m.type] || '信',
        title: m.title,
        content: m.content,
        jumpUrl: m.jump_url || '',
        isRead: !!m.is_read,
        timeText: this.formatTime(m.created_at)
      }));
      this.setData({
        messages: this.data.page === 1 ? list : this.data.messages.concat(list),
        loading: false,
        finished: list.length < 20,
        page: this.data.page + 1,
        unread: res.unread || 0
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  onReachBottom() {
    this.loadMore();
  },

  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(String(ts).replace(' ', 'T'));
    if (isNaN(d.getTime())) return ts;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const yest = new Date(now.getTime() - 864e5);
    if (d.toDateString() === yest.toDateString()) return '昨天';
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  // 点击消息：标记已读 + 跳转
  tapMessage(e) {
    const id = e.currentTarget.dataset.id;
    const url = e.currentTarget.dataset.url;
    const isRead = e.currentTarget.dataset.read;
    if (!isRead) {
      const user = app.globalData.userInfo || {};
      const openid = user.openid || wx.getStorageSync('openid');
      if (openid) {
        api.markMessageRead(id, openid).catch(() => {});
        const messages = this.data.messages.map(m => m.id === id ? { ...m, isRead: true } : m);
        this.setData({ messages, unread: Math.max(this.data.unread - 1, 0) });
      }
    }
    if (url) {
      if (TAB_PAGES.includes(url)) {
        wx.switchTab({ url });
      } else {
        wx.navigateTo({ url });
      }
    }
  },

  // 全部已读
  markAll() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.markAllMessagesRead(openid).then((res) => {
      const messages = this.data.messages.map(m => ({ ...m, isRead: true }));
      this.setData({ messages, unread: 0 });
      wx.showToast({ title: res.message || '已全部标记为已读', icon: 'none' });
    }).catch(() => {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
