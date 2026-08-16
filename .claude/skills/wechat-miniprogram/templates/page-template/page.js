const { request } = require('../../utils/request')

Page({
  data: {
    // 页面数据
  },

  onLoad(options) {
    // 页面加载，options 为页面参数
  },

  onShow() {
    // 页面显示
  },

  onReady() {
    // 首次渲染完成
  },

  onHide() {
    // 页面隐藏
  },

  onUnload() {
    // 页面卸载，清理定时器、监听器
  },

  onPullDownRefresh() {
    // 下拉刷新
    this.loadData().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    // 触底加载更多
  },

  onShareAppMessage() {
    return {
      title: '分享标题',
      path: '/pages/xxx/xxx'
    }
  },

  // ── 自定义方法 ──

  async loadData() {
    try {
      const res = await request({ url: '/api/xxx' })
      this.setData({ /* ... */ })
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  }
})
