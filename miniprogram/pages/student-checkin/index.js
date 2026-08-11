const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    bookingId: 0,
    course: null,
    checkinCode: '',
    loading: true,
    checked: false
  },

  onLoad(options) {
    const bookingId = Number(options.id || 0);
    this.setData({ bookingId });
    if (!bookingId) {
      this.setData({ loading: false, course: null });
      return;
    }
    this.loadInfo(bookingId);
  },

  // 加载真实订课信息
  loadInfo(bookingId) {
    api.getCheckinInfo(bookingId).then((res) => {
      const info = res.info;
      const user = app.globalData.userInfo || {};
      const openid = user.openid || wx.getStorageSync('openid');
      // 校验是本人的订课
      if (info.user_openid !== openid) {
        this.setData({ loading: false, course: null, checked: false });
        return;
      }
      this.setData({
        loading: false,
        course: {
          name: info.course_name,
          time: `${info.date} ${info.start_time}-${info.end_time}`,
          venue: info.venue_name
        },
        checked: !!info.checkin_at,
        // 签到凭证码：GYM-{bookingId}（教练端核销用）
        checkinCode: 'GYM-' + String(bookingId).padStart(4, '0')
      });
    }).catch(() => {
      this.setData({ loading: false, course: null });
    });
  },

  refreshCode() {
    wx.showToast({ title: '凭证码已刷新', icon: 'none' });
  }
});
