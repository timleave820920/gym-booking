const app = getApp();
const api = require('../../utils/api.js');
const qrcode = require('../../utils/qrcode.js');
const { inCheckinWindow, windowHint } = require('../../utils/checkin-config.js');

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
      // 签到凭证码：随机 5 位纯数字（后端生成，BUGS-INBOX #11；二维码与文字同码）
      // 签到时间窗口（共享配置 checkin-config.js，与后端 bookings.js 同一数值）
      const now = new Date();
      const todayFull = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const toMin = (s) => { const [h, m] = (s || '00:00').split(':').map(Number); return h * 60 + m; };
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const inWin = inCheckinWindow(info.date, info.start_time, info.end_time);
      this.setData({
        loading: false,
        course: {
          name: info.course_name,
          time: `${info.date} ${info.start_time}-${info.end_time}`,
          venue: info.venue_name
        },
        checked: !!info.checkin_at,
        inWindow: inWin,
        windowHint: inWin ? '' : windowHint(nowMin, info.start_time, info.end_time),
        checkinCode: info.checkin_code || ''
      }, () => {
        // 数据就绪、未签到且在时间窗口内才渲染二维码
        if (!this.data.checked && this.data.inWindow) this.drawQr(this.data.checkinCode);
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
    this.paintQr(qr, qr.getModuleCount(), 0);
  },

  // 画码；首次进入页面 canvas 节点布局未就绪时拿不到尺寸（模拟器 #38）→ 延迟重试，最多 3 次
  paintQr(qr, count, attempt) {
    wx.createSelectorQuery().in(this).select('#checkinQr').boundingClientRect((rect) => {
      if (!rect || !rect.width) {
        if (attempt < 3) {
          setTimeout(() => this.paintQr(qr, count, attempt + 1), 120);
        }
        return;
      }
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
  }
});
