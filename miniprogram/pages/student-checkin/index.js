const app = getApp();
const api = require('../../utils/api.js');
const qrcode = require('../../utils/qrcode.js');

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
      const checkinCode = 'GYM-' + String(bookingId).padStart(4, '0');
      this.setData({
        loading: false,
        course: {
          name: info.course_name,
          time: `${info.date} ${info.start_time}-${info.end_time}`,
          venue: info.venue_name
        },
        checked: !!info.checkin_at,
        // 签到凭证码：GYM-{bookingId}（教练端扫码核销用，二维码与文字同码）
        checkinCode
      }, () => {
        // 数据就绪且未签到时渲染二维码
        if (!this.data.checked) this.drawQr(checkinCode);
      });
    }).catch(() => {
      this.setData({ loading: false, course: null });
    });
  },

  // 用 canvas 渲染真实二维码（内容=签到凭证码，教练端扫码解析不变）
  drawQr(code) {
    const qr = qrcode(0, 'M'); // typeNumber 0=自动，纠错 M 级
    qr.addData(code);
    qr.make();
    const count = qr.getModuleCount();

    wx.createSelectorQuery().in(this).select('#checkinQr').boundingClientRect((rect) => {
      if (!rect || !rect.width) return;
      const size = Math.min(rect.width, rect.height);
      const cell = size / count;
      const ctx = wx.createCanvasContext('checkinQr', this);
      // 白底
      ctx.setFillStyle('#FFFFFF');
      ctx.fillRect(0, 0, size, size);
      // 深色模块
      ctx.setFillStyle('#1A1A23');
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(c * cell, r * cell, cell, cell);
          }
        }
      }
      ctx.draw();
    }).exec();
  },

  refreshCode() {
    // 重新渲染二维码（内容不变，重绘一版清晰的码）
    this.drawQr(this.data.checkinCode);
    wx.showToast({ title: '签到码已刷新', icon: 'none' });
  }
});
