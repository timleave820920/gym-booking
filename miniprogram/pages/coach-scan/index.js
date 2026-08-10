Page({
  data: {
    course: { name: 'HIIT 高强度燃脂', time: '今日 10:00', venue: 'A馆' }
  },

  manualCheckin() {
    wx.showModal({
      title: '手动签到',
      content: '输入学员手机号后 4 位进行签到',
      editable: true,
      placeholderText: '请输入手机号后4位',
      success: (res) => {
        if (res.confirm) {
          wx.showToast({ title: '签到成功', icon: 'success' });
        }
      }
    });
  },

  chooseFromAlbum() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        wx.showToast({ title: '识别成功', icon: 'success' });
      },
      fail: () => {}
    });
  }
});
