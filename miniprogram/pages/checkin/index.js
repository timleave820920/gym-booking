/**
 * 固定二维码自助签到页（DESIGN #D13）
 * 场馆张贴固定官方小程序码（scene=checkin，path=pages/checkin/index），学员相机扫码进入本页：
 *  - 无歧义（窗口内唯一订课）→ 自动签到
 *  - 有歧义（窗口内多订课/连堂）→ 弹框选课 → 确认签到
 * 签到主体 = 扫码设备的登录账号（openid 服务端取，码本身公开无泄露风险）
 */
const api = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    state: 'loading',    // loading 判定中 / invalid 无效码 / none 无课可签 / done 签到成功 / multi 多课选择
    scene: '',           // 解析后的 scene（校验 === 'checkin'）
    message: '',         // none/invalid 提示文案
    checked: null,       // 签到成功信息（课程名/时间/教练）
    candidates: [],      // 多课候选列表
    selectedId: 0,       // 弹框当前选中
    multiShow: false     // 多课弹框显隐
  },

  onLoad(options) {
    // scene 解析：小程序码参数经 decodeURIComponent 还原（options.scene 为原始编码值）
    let scene = '';
    if (options.scene) {
      try { scene = decodeURIComponent(options.scene); } catch (e) { scene = options.scene; }
    } else if (options.s) {
      scene = options.s;
    }
    if (scene !== 'checkin') {
      this.setData({ state: 'invalid', message: '无效的签到码' });
      return;
    }
    this.setData({ scene });
    this.doScan();
  },

  // 自助签到判定（后端三态：none 无课 / done 唯一课自动签 / multi 多课候选不落库）
  doScan() {
    const openid = (app.globalData.userInfo && app.globalData.userInfo.openid) || wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ state: 'invalid', message: '未登录，请先登录后再扫码签到' });
      return;
    }
    api.checkinScan(openid).then((res) => {
      if (res && res.state === 'done' && res.booking) {
        this.setData({ state: 'done', checked: this.decorateChecked(res.booking) });
      } else if (res && res.state === 'multi') {
        const candidates = (res.candidates || []).map(c => ({
          id: c.id,
          name: c.course_name,
          time: `${c.start_time}-${c.end_time}`,
          venue: c.venue_name
        }));
        this.setData({
          state: 'multi',
          candidates,
          selectedId: candidates.length ? candidates[0].id : 0
        });
      } else {
        this.setData({ state: 'none', message: (res && res.message) || '当前没有可签到的课程' });
      }
    }).catch(() => {
      this.setData({ state: 'none', message: '网络异常，请稍后重试' });
    });
  },

  // 签到成功信息装饰（对齐学员端展示字段）
  decorateChecked(b) {
    return {
      course_name: b.course_name || '课程',
      time: `${b.start_time}-${b.end_time}`,
      coach: b.coach || b.coach_name || '',
      venue: b.venue_name || ''
    };
  },

  // 弹框：选中候选课
  selectCandidate(e) {
    this.setData({ selectedId: e.currentTarget.dataset.id });
  },

  // 弹框：确认签到（选定后调 select 落库）
  confirmSelect() {
    const openid = (app.globalData.userInfo && app.globalData.userInfo.openid) || wx.getStorageSync('openid');
    const { selectedId } = this.data;
    if (!openid || !selectedId) return;
    wx.showLoading({ title: '签到中...' });
    api.checkinSelect(openid, selectedId).then((res) => {
      wx.hideLoading();
      if (res && res.booking) {
        this.setData({ state: 'done', checked: this.decorateChecked(res.booking), multiShow: false });
      } else {
        wx.showToast({ title: (res && res.message) || '签到失败', icon: 'none' });
        this.setData({ multiShow: false });
        this.doScan();   // 状态可能已变（已被签走/课程过期），重新判定
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
    });
  },

  // 无课可签 → 去课程列表
  goCourses() {
    wx.switchTab({ url: '/pages/student-courses/index' });
  },

  // 重新判定（无课场景下订了课后回来再扫）
  retryScan() {
    this.setData({ state: 'loading' });
    this.doScan();
  }
});
