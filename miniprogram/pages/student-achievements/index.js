const api = require('../../utils/api.js');
const app = getApp();
const courseStatus = require('../../utils/course-status.js');

// 卡路里估算：功能性训练约 10 千卡/分钟（无设备数据时的统一口径）
const KCAL_PER_MIN = 10;

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

Page({
  data: {
    stats: [
      { value: 0, label: '累计上课（次）' },
      { value: '0h', label: '累计时长' },
      { value: '0', label: '累计卡路里（千卡）' }
    ],
    streak: 0,
    weekRecord: [],
    weekCount: 0,
    weekGoal: false,
    achievements: [],
    loading: true,
    offline: false
  },

  onLoad() {
    this.loadAchievements();
  },

  // 用真实订课数据计算成就（已参加 = 已订且场次已结束，与「我的」页锻炼次数口径一致）
  loadAchievements() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ loading: false });
      return;
    }
    api.getMyBookings(openid).then((res) => {
      // 已参加的场次：状态 booked 且课程已结束
      const attended = (res.bookings || []).filter(b =>
        b.status === 'booked' &&
        courseStatus.getSessionStatus(b.date, b.start_time, b.end_time) === 'ended'
      );
      const dates = attended.map(b => b.date);
      const totalClasses = attended.length;
      const totalMinutes = attended.reduce((s, b) => s + (b.duration_min || 60), 0);
      const calories = totalMinutes * KCAL_PER_MIN;
      const streak = this.calcStreak(dates);
      const weekRecord = this.calcWeekRecord(dates);
      const weekCount = weekRecord.reduce((s, d) => s + d.count, 0);
      const hoursText = totalMinutes >= 60 ? `${Math.round(totalMinutes / 60)}h` : `${totalMinutes}分钟`;

      const achievements = [
        { name: '新人首练', color: '#B9FF66', unlocked: totalClasses >= 1, desc: '完成第 1 次训练' },
        { name: '燃脂之星', color: '#5B57EB', unlocked: calories >= 1000, desc: '累计消耗 1000 千卡' },
        { name: '十次训练', color: '#F8B7B8', unlocked: totalClasses >= 10, desc: '累计 10 次训练' },
        { name: '坚持10小时', color: '#3D9970', unlocked: totalMinutes >= 600, desc: '累计训练 10 小时' },
        { name: '连续7天', color: '#F8D044', unlocked: streak >= 7, desc: '连续打卡 7 天' },
        { name: '百次挑战', color: '#8C84F2', unlocked: totalClasses >= 100, desc: '累计 100 次训练' }
      ];

      this.setData({
        stats: [
          { value: totalClasses, label: '累计上课（次）' },
          { value: hoursText, label: '累计时长' },
          { value: fmtNum(calories), label: '累计卡路里（千卡）' }
        ],
        streak,
        weekRecord,
        weekCount,
        weekGoal: weekCount >= 3,
        achievements,
        loading: false,
        offline: false
      });
    }).catch(() => {
      // 后端不可用 → 空态（不展示假数据）
      this.setData({ loading: false, offline: true });
    });
  },

  // 连续天数：从今天（或昨天，若今天还没练）往前数连续有训练的天数
  calcStreak(dates) {
    const set = new Set(dates);
    const d = new Date();
    if (!set.has(fmt(d))) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (set.has(fmt(d))) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  },

  // 本周（周一~周日）每天的训练次数
  calcWeekRecord(dates) {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
    const set = new Set(dates);
    const week = ['一', '二', '三', '四', '五', '六', '日'];
    return week.map((w, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const full = fmt(d);
      const count = set.has(full) ? dates.filter(x => x === full).length : 0;
      return { weekday: w, count, active: count > 0, today: full === fmt(now) };
    });
  },

  goBack() { wx.navigateBack(); },
  share() {
    wx.showToast({ title: '分享海报生成中', icon: 'none' });
  }
});
