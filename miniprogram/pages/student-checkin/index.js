Page({
  data: {
    course: {
      name: 'HIIT 高强度燃脂训练',
      time: '今日 10:00-11:00',
      venue: 'A馆'
    }
  },

  refreshCode() {
    wx.showToast({ title: '已刷新', icon: 'none' });
  }
});
