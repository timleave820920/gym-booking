const app = getApp();
const api = require('../../utils/api.js');

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
    // 守卫：已加载完不再拉；已有数据时防重复加载（首屏 loading 初始为 true 时放行）
    if (this.data.finished || (this.data.loading && this.data.messages.length > 0)) return;
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

  // 单条已读（点击消息 → 仅标记已读；不跳转——产品决策 2026-08-13：消息中心是通知列表，详情一律去对应模块看）
  markRead(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.messages.find(m => m.id === id);
    if (!item) return;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (openid && !item.isRead) {
      api.markMessageRead(id, openid).then(() => {
        this.setData({
          messages: this.data.messages.map(m => m.id === id ? { ...m, isRead: true } : m),
          unread: Math.max((this.data.unread || 0) - 1, 0)
        });
      }).catch(() => {});
    }
  },

  // 全部已读：一键消除所有小红点
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
