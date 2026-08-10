const app = getApp();

Page({
  data: {
    course: null,
    payMethods: [
      { id: 1, name: '微信支付', desc: '推荐使用', icon: 'wallet', selected: true },
      { id: 2, name: '余额支付', desc: '余额 ¥ 128.50', icon: 'card', selected: false }
    ]
  },

  onLoad() {
    const course = app.globalData.currentCourse || {
      name: 'HIIT 高强度燃脂训练',
      coach: '阿凯',
      venue: 'A馆',
      time: '10:00-11:00',
      price: 68,
      img: '/images/3_24.png'
    };
    this.setData({ course });
  },

  selectMethod(e) {
    const id = e.currentTarget.dataset.id;
    const payMethods = this.data.payMethods.map(m => ({
      ...m, selected: m.id === id
    }));
    this.setData({ payMethods });
  },

  pay() {
    wx.showLoading({ title: '支付中...' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showModal({
        title: '支付成功',
        content: `已成功预订「${this.data.course.name}」，可在我的课程中查看`,
        showCancel: false,
        confirmText: '查看我的课程',
        success: () => {
          wx.switchTab({ url: '/pages/student-my-courses/index' });
        }
      });
    }, 1200);
  }
});
