const api = require('../../utils/api.js');
const app = getApp();
const i18n = require('../../utils/i18n.js');
const courseStatus = require('../../utils/course-status.js');

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
// 课程状态 → 标签文案/颜色（与学员端一致）
const STATUS_MAP = {
  upcoming: ['未开始', 'green'],
  ongoing: ['进行中', 'orange'],
  ended: ['已结束', 'gray']
};

Page({
  data: {
    coach: { id: 1, name: '教练' },
    greeting: '',
    summary: '今天暂无课程',
    firstTime: '',
    dateText: '',
    schedule: [],
    loading: true,
    offline: false
  },

  onLoad() {
    const u = app.globalData.userInfo || {};
    const coachId = u.coach_id || 1;
    const name = u.name && u.name !== '教练' ? u.name : '教练';
    this.setData({ coach: { id: coachId, name } });
    this.loadSchedule(coachId);
  },

  onShow() {
    // 每次显示刷新（核销签到/学员名单变化后回本页即时更新）
    const u = app.globalData.userInfo || {};
    const coachId = u.coach_id || 1;
    this.loadSchedule(coachId);
  },

  // 拉取教练今日真实课表
  loadSchedule(coachId) {
    const now = new Date();
    const full = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dateText = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEK[now.getDay()]}`;
    const greeting = `${this.getGreetingWord()}，${this.data.coach.name}教练`;

    api.getCoachSchedule(full, coachId).then((res) => {
      const list = (res.sessions || []).map(s => {
        const st = courseStatus.getSessionStatus(s.date, s.start_time, s.end_time);
        const [statusText, statusType] = STATUS_MAP[st] || ['', 'gray'];
        return {
          id: s.id,
          name: s.course_name,
          venue: s.venue_name,
          time: s.start_time,
          duration: `${s.duration_min}分钟`,
          enrolled: s.booked_count,
          capacity: s.capacity,
          status: statusText,
          statusType
        };
      });
      const totalStudents = list.reduce((sum, c) => sum + (c.enrolled || 0), 0);
      const upcoming = list.find(c => c.statusType === 'green');
      this.setData({
        schedule: list,
        loading: false,
        offline: false,
        greeting,
        dateText,
        summary: list.length ? `今天有 ${list.length} 节课 · ${totalStudents} 名学员` : '今天暂无课程',
        firstTime: upcoming ? `${upcoming.time} 第一节课 · 记得提前到场` : '今日课程已全部结束'
      });
    }).catch(() => {
      this.setData({ loading: false, offline: true, schedule: [], summary: '后端未连接，无法加载课表' });
    });
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

  goStudents(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/coach-students/index?id=${id}` });
  },

  goScan() {
    wx.navigateTo({ url: '/pages/coach-scan/index' });
  },

  goProfile() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
