/**
 * 吐槽页（DESIGN #D9）
 * 学员实名留言场馆（承诺每条必回复）→ 场馆回复后此处展示 + 站内信通知
 */
const api = require('../../utils/api.js');

Page({
  data: {
    statusBarH: 20,
    openid: '',
    content: '',
    maxLen: 500,
    submitting: false,
    list: [],
    loading: false
  },

  onLoad() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarH: win.statusBarHeight || 20 });
    const user = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {};
    this.setData({ openid: user.openid || wx.getStorageSync('openid') || '' });
  },

  onShow() {
    this.loadList();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onInput(e) {
    this.setData({ content: e.detail.value });
  },

  submit() {
    const text = String(this.data.content || '').trim();
    if (!text) {
      wx.showToast({ title: '写点什么再提交吧', icon: 'none' });
      return;
    }
    if (text.length > this.data.maxLen) {
      wx.showToast({ title: `吐槽内容不超过 ${this.data.maxLen} 字`, icon: 'none' });
      return;
    }
    if (!this.data.openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;   // 防连点
    this.setData({ submitting: true });
    api.createFeedback({ openid: this.data.openid, content: text }).then((res) => {
      this.setData({ submitting: false, content: '' });
      wx.showToast({ title: res.message || '已收到，场馆会尽快回复', icon: 'success' });
      this.loadList();
    }).catch((err) => {
      this.setData({ submitting: false });
      wx.showToast({ title: (err && err.message) || '提交失败，请重试', icon: 'none' });
    });
  },

  loadList() {
    if (!this.data.openid || this.data.loading) return;
    this.setData({ loading: true });
    api.getMyFeedbacks(this.data.openid).then((res) => {
      this.setData({ list: res.list || [], loading: false });
    }).catch(() => {
      this.setData({ loading: false });
    });
  }
});
