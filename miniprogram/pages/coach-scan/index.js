const app = getApp();
const api = require('../../utils/api.js');
const { parseCode } = require('../../utils/checkin-code.js');

Page({
  data: {
    course: { name: '今日课程签到', time: '', venue: '' },
    result: null          // 最近一次核销结果
  },

  onLoad() {
    // 从教练课表带入课程信息（可选）
    const c = app.globalData.currentCoachCourse;
    if (c) {
      this.setData({ course: c });
    }
  },

  // 扫码核销
  scanCheckin() {
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (res) => {
        // 解析凭证码：纯数字 {bookingId}（DESIGN #D1，兼容历史 GYM- 前缀）
        const code = (res.result || '').trim();
        const bookingId = this.parseCode(code);
        if (!bookingId) {
          this.showResult(false, '无法识别的签到码');
          return;
        }
        this.doCheckin(bookingId);
      },
      fail: () => {
        // 用户取消扫码
      }
    });
  },

  // 解析凭证码（纯数字 0001 → 1；兼容历史 GYM-0001，DESIGN #D1）
  parseCode(code) {
    return parseCode(code);
  },

  // 调用核销接口
  doCheckin(bookingId) {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      this.showResult(false, '未登录，无法核销');
      return;
    }
    wx.showLoading({ title: '核销中...' });
    api.checkin(bookingId, openid).then((res) => {
      wx.hideLoading();
      const b = res.booking;
      this.showResult(true, `签到成功：${b.course_name}\n${b.start_time}-${b.end_time} · ${b.venue_name}`);
    }).catch((err) => {
      wx.hideLoading();
      this.showResult(false, err.message || '核销失败');
    });
  },

  // 手动输入签到码
  manualCheckin() {
    wx.showModal({
      title: '手动核销',
      content: '输入学员出示的签到码（纯数字，如 0001）',
      editable: true,
      placeholderText: '0001',
      success: (res) => {
        if (res.confirm && res.content) {
          const bookingId = this.parseCode(res.content.trim());
          if (!bookingId) {
            this.showResult(false, '签到码格式不正确');
            return;
          }
          this.doCheckin(bookingId);
        }
      }
    });
  },

  chooseFromAlbum() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        wx.showToast({ title: '相册识别需配置扫码组件', icon: 'none' });
      },
      fail: () => {}
    });
  },

  // 展示核销结果
  showResult(ok, text) {
    this.setData({ result: { ok, text } });
    setTimeout(() => {
      this.setData({ result: null });
    }, 3000);
  },

  closeResult() {
    this.setData({ result: null });
  }
});
