const mock = require('../../utils/mock.js');
const app = getApp();

Page({
  data: {
    stats: [
      { value: 32, label: '累计上课（次）' },
      { value: '28.5h', label: '累计时长' },
      { value: '12,480', label: '累计卡路里（千卡）' }
    ],
    streak: 12,
    weekRecord: [],
    achievements: []
  },

  onLoad() {
    const user = app.globalData.userInfo;
    this.setData({
      stats: [
        { value: user.totalClasses, label: '累计上课（次）' },
        { value: user.totalHours, label: '累计时长' },
        { value: user.totalCalories, label: '累计卡路里（千卡）' }
      ],
      streak: user.streak,
      weekRecord: mock.weekRecord,
      achievements: mock.achievements
    });
  },

  goBack() { wx.navigateBack(); },
  share() {
    wx.showToast({ title: '分享海报生成中', icon: 'none' });
  }
});
