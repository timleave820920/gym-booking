const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');
const { isValidCode, normalizeCode } = require('../../utils/checkin-code.js');

const DEFAULT_AVATAR = '/images/2_1468.png';   // 学员未设头像占位
// 签到窗口（与后端一致 DESIGN #D1）：开课前 30 分钟 ～ 课后 30 分钟
const EARLY_WINDOW = 30;
const LATE_WINDOW = 30;
const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

Page({
  data: {
    tab: 0,                  // 0 我的课程 / 1 我的学员 / 2 结算
    coach: { name: '教练' },
    greeting: '',
    openid: '',
    // Tab1 课程
    weekDays: [],
    selectedDate: '',
    sessions: [],
    loading: true,
    offline: false,
    // 手动输入验证码
    manualShow: false,
    manualCode: '',
    // Tab2 学员
    students: [],
    studentsLoading: true,
    // 学员详情弹层
    detailShow: false,
    detailStudent: null,
    detailLessons: [],
    noteText: '',
    noteSaving: false,
    // Tab3 结算
    month: '',               // YYYY-MM
    monthText: '',
    monthAtCurrent: true,    // 是否本月（禁用下月按钮）
    settlement: null,
    settlementLoading: true
  },

  onLoad() {
    const u = app.globalData.userInfo || {};
    const name = u.name && u.name !== '教练' ? u.name : '教练';
    const coachId = u.coach_id || 1;
    this.setData({
      coach: { id: coachId, name },
      openid: u.openid || wx.getStorageSync('openid') || ''
    });
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.setData({
      greeting: `${this.getGreetingWord()}，${name}教练`,
      month,
      monthText: this.monthText(now.getFullYear(), now.getMonth() + 1),
      monthAtCurrent: true
    });
    this.buildWeek();
    this.loadSessions();
    this.loadStudents();
    this.loadSettlement(month);
  },

  onShow() {
    // 每次显示刷新（核销签到后回本页即时更新）
    this.loadSessions();
    if (this.data.tab === 2) this.loadSettlement(this.data.month);
  },

  // ===== Tab 切换 =====
  switchTab(e) {
    const tab = Number(e.currentTarget.dataset.tab);
    this.setData({ tab });
    if (tab === 1) this.loadStudents();
    if (tab === 2) this.loadSettlement(this.data.month);
  },

  // 按时段问候（与学员端一致）
  getGreetingWord() {
    const t = i18n.t();
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return t.greetingMorning;
    if (hour >= 12 && hour < 13) return t.greetingNoon;
    if (hour >= 13 && hour < 18) return t.greetingAfternoon;
    if (hour >= 18 && hour < 22) return t.greetingEvening;
    return t.greetingLate;
  },

  // ===== Tab1 我的课程 =====
  // 日期条：今天起 7 天（含今天），与预约页 buildWeek 一致（BUG-LEDGER #26）
  buildWeek() {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const full = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      weekDays.push({
        weekday: i === 0 ? '今天' : '周' + WEEK_SHORT[d.getDay()],
        date: pad(d.getDate()),
        full,
        selected: i === 0
      });
    }
    this.setData({ weekDays, selectedDate: weekDays[0].full });
  },

  selectDate(e) {
    const { full } = e.currentTarget.dataset;
    this.setData({ weekDays: this.data.weekDays.map(d => ({ ...d, selected: d.full === full })), selectedDate: full });
    this.loadSessions();
  },

  // 拉取选中日期该教练的场次（按周取数据本地过滤）
  loadSessions() {
    const coachId = this.data.coach.id;
    if (!coachId) return;
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const from = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const toD = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6);
    const to = `${toD.getFullYear()}-${pad(toD.getMonth() + 1)}-${pad(toD.getDate())}`;
    this.setData({ loading: true, offline: false });
    api.getCoachSessions(coachId, from, to).then((res) => {
      const list = (res.sessions || [])
        .filter(s => s.date === this.data.selectedDate)
        .map(s => this.decorateSession(s));
      this.setData({ sessions: list, loading: false });
    }).catch(() => {
      this.setData({ loading: false, offline: true, sessions: [] });
    });
  },

  // 装饰场次：状态 + 签到入口判定（窗口：开课前30分钟~课后30分钟）
  decorateSession(s) {
    const date = s.date;
    const now = new Date();
    const todayFull = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const toMin = (t) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + m; };
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const st = courseStatus.getSessionStatus(date, s.start_time, s.end_time);
    const checkinOpen = date === todayFull
      && nowMin >= toMin(s.start_time) - EARLY_WINDOW && nowMin <= toMin(s.end_time) + LATE_WINDOW;
    const statusText = st === 'upcoming' ? '未开始' : '已结束';
    return {
      id: s.id,
      name: s.course_name,
      venue: s.venue_name,
      dateText: `${date.slice(5, 7)}/${date.slice(8, 10)}`,
      time: `${s.start_time}-${s.end_time}`,
      enrolled: s.booked_count || 0,
      capacity: s.capacity || 0,
      checkinOpen,
      statusText
    };
  },

  // 签到入口：扫码 / 手动输入
  startCheckin(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showActionSheet({
      itemList: ['相机扫码核销', '手动输入签到码'],
      success: (res) => {
        if (res.tapIndex === 0) this.scanCheckin();
        else this.setData({ manualShow: true, manualCode: '' });
      }
    });
  },

  // 相机扫码核销（随机 5 位纯数字凭证码，BUGS-INBOX #11）
  scanCheckin() {
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (res) => {
        const code = normalizeCode(res.result || '');
        if (!isValidCode(code)) {
          wx.showToast({ title: '无法识别的签到码', icon: 'none' });
          return;
        }
        this.doCheckin(code);
      },
      fail: () => {}
    });
  },

  // 手动输入（纯数字弹窗）
  onManualInput(e) {
    this.setData({ manualCode: e.detail.value });
  },
  confirmManual() {
    const code = normalizeCode(this.data.manualCode);
    if (!isValidCode(code)) {
      wx.showToast({ title: '签到码格式不正确（应为 5 位数字）', icon: 'none' });
      return;
    }
    this.setData({ manualShow: false });
    this.doCheckin(code);
  },
  closeManual() {
    this.setData({ manualShow: false });
  },

  // 核销签到（按 5 位码，BUGS-INBOX #11）
  doCheckin(code) {
    const openid = this.data.openid;
    if (!openid) {
      wx.showToast({ title: '未登录，无法核销', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '核销中...' });
    api.checkinByCode(code, openid).then((res) => {
      wx.hideLoading();
      const b = res.booking;
      wx.showToast({
        title: `签到成功：${b.course_name}`, icon: 'success', duration: 2000
      });
      this.loadSessions();
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '核销失败', icon: 'none' });
    });
  },

  // 场次名单（从课程卡进入）
  goStudents(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/coach-students/index?id=${id}` });
  },

  // ===== Tab2 我的学员 =====
  loadStudents() {
    const openid = this.data.openid;
    if (!openid) return;
    this.setData({ studentsLoading: true });
    api.getCoachStudents(openid).then((res) => {
      const students = (res.students || []).map(s => ({
        ...s,
        avatar: s.avatar ? api.toFullUrl(s.avatar) : DEFAULT_AVATAR,
        hasNote: !!s.has_note,
        totalText: s.total_classes ? `${s.total_classes} 节` : '0 节'
      }));
      this.setData({ students, studentsLoading: false });
    }).catch((err) => {
      this.setData({ studentsLoading: false, students: [] });
      if (err && err.code === 404) {
        wx.showToast({ title: err.message || '教练档案不存在', icon: 'none' });
      }
    });
  },

  avatarError(e) {
    const idx = e.currentTarget.dataset.idx;
    if (idx === undefined) return;
    this.setData({ [`students[${idx}].avatar`]: DEFAULT_AVATAR });
  },

  // 学员详情弹层：跟课记录 + 笔记编辑
  openStudent(e) {
    const idx = e.currentTarget.dataset.idx;
    const s = this.data.students[idx];
    if (!s) return;
    const openid = this.data.openid;
    this.setData({ detailShow: true, detailStudent: s, detailLessons: [], noteText: '', noteSaving: false });
    api.getCoachStudentLessons(openid, s.openid).then((res) => {
      this.setData({ detailLessons: res.lessons || [] });
    }).catch(() => {});
    api.getCoachNote(openid, s.openid).then((res) => {
      if (res.note) this.setData({ noteText: res.note.content || '' });
    }).catch(() => {});
  },
  closeStudent() {
    this.setData({ detailShow: false });
  },
  onNoteInput(e) {
    this.setData({ noteText: e.detail.value });
  },
  saveNote() {
    if (this.data.noteSaving) return;
    const s = this.data.detailStudent;
    if (!s) return;
    this.setData({ noteSaving: true });
    api.saveCoachNote(this.data.openid, s.openid, this.data.noteText).then(() => {
      wx.showToast({ title: '笔记已保存', icon: 'success' });
      this.setData({ noteSaving: false, ['detailStudent.hasNote']: !!this.data.noteText });
      this.loadStudents();
    }).catch((err) => {
      this.setData({ noteSaving: false });
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
    });
  },

  // ===== Tab3 结算 =====
  monthText(y, m) {
    return `${y}年${m}月`;
  },
  prevMonth() {
    const [y, m] = this.data.month.split('-').map(Number);
    const prev = m === 1 ? [y - 1, 12] : [y, m - 1];
    const month = `${prev[0]}-${String(prev[1]).padStart(2, '0')}`;
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.setData({
      month,
      monthText: this.monthText(prev[0], prev[1]),
      monthAtCurrent: month === cur
    });
    this.loadSettlement(month);
  },
  nextMonth() {
    if (this.data.monthAtCurrent) return;
    const [y, m] = this.data.month.split('-').map(Number);
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    const month = `${next[0]}-${String(next[1]).padStart(2, '0')}`;
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.setData({
      month,
      monthText: this.monthText(next[0], next[1]),
      monthAtCurrent: month === cur
    });
    this.loadSettlement(month);
  },
  loadSettlement(month) {
    const coachId = this.data.coach.id;
    if (!coachId || !month) return;
    this.setData({ settlementLoading: true });
    api.getCoachSettlement(coachId, month).then((res) => {
      const s = res.settlement;
      this.setData({
        settlementLoading: false,
        settlement: {
          ...s,
          courseFeeText: this.fmtMoney(s.course_fee_fen),
          rewardText: this.fmtMoney(s.reward_fen),
          totalText: this.fmtMoney(s.total_fen)
        }
      });
    }).catch((err) => {
      this.setData({ settlementLoading: false, settlement: null });
      wx.showToast({ title: (err && err.message) || '结算加载失败', icon: 'none' });
    });
  },
  // 分 → 元 千分位（如 149000 → 1,490）
  fmtMoney(fen) {
    const yuan = String(Math.floor((fen || 0) / 100));
    return yuan.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  // 弹层内部点击不冒泡（配合 catchtap）
  noop() {},

  goProfile() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
