const app = getApp();
const api = require('../../utils/api.js');
const qrcode = require('../../utils/qrcode.js');

Page({
  data: {
    bookingId: 0,
    course: null,
    checkinCode: '',
    loading: true,
    checked: false,
    inWindow: true,
    windowHint: ''
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
      // 签到凭证码：纯数字 {bookingId 4位补零}（教练端扫码核销用，二维码与文字同码，DESIGN #D1）
      const checkinCode = String(bookingId).padStart(4, '0');
      // 签到时间窗口（与后端一致 BUG-LEDGER #10，2026-08-16 统一为课后 30 分钟 DESIGN #D1）：当天 + 开课前30分钟 ~ 结束后30分钟
      const now = new Date();
      const todayFull = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const toMin = (s) => { const [h, m] = (s || '00:00').split(':').map(Number); return h * 60 + m; };
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const inWindow = info.date === todayFull
        && nowMin >= toMin(info.start_time) - 30 && nowMin <= toMin(info.end_time) + 30;
      this.setData({
        loading: false,
        course: {
          name: info.course_name,
          time: `${info.date} ${info.start_time}-${info.end_time}`,
          venue: info.venue_name
        },
        checked: !!info.checkin_at,
        inWindow,
        // 未到窗口时的提示（开课前30分钟起可签到；已结束超30分钟不可签）
        windowHint: nowMin < toMin(info.start_time) - 30
          ? `开课前 30 分钟开始可签到（${info.start_time} 开课）`
          : (nowMin > toMin(info.end_time) + 30 ? '课程已结束超过 30 分钟，无法签到' : ''),
        checkinCode
      }, () => {
        // 数据就绪、未签到且在时间窗口内才渲染二维码
        if (!this.data.checked && this.data.inWindow) this.drawQr(checkinCode);
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
