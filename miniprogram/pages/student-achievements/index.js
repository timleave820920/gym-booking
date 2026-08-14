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

// ===== 30 项成就时间线（2026-08-14 设计定稿）=====
// 约束：前期（第1-5天）密集达成 · 后期固定节奏 · 相邻成就最大间隔 ≤ 14 天 · 至少达成一项
// day 为设计触发时间点（展示用），实际解锁由 check 条件判定（可提前达成，如次数/连续达标即解锁）
const ACHIEVEMENTS = [
  // ── 阶段一：第 1-5 天（密集起步）──
  { id: 1,  name: '初次见面', icon: '约', color: '#B9FF66', stage: '第 1-5 天', day: 1,
    desc: '完成首次预约订课', check: (c) => c.bookedCount >= 1 },
  { id: 2,  name: '第一滴汗', icon: '汗', color: '#FFD166', stage: '第 1-5 天', day: 1,
    desc: '完成第 1 次锻炼', check: (c) => c.totalClasses >= 1 },
  { id: 3,  name: '签到首秀', icon: '签', color: '#4ECDC4', stage: '第 1-5 天', day: 1,
    desc: '完成第 1 次签到', check: (c) => c.checkedIn >= 1 },
  { id: 4,  name: '三日不辍', icon: '三', color: '#FF8C42', stage: '第 1-5 天', day: 3,
    desc: '连续锻炼 3 天', check: (c) => c.streak >= 3 },
  { id: 5,  name: '五日坚持', icon: '五', color: '#B9FF66', stage: '第 1-5 天', day: 5,
    desc: '连续锻炼 5 天', check: (c) => c.streak >= 5 },

  // ── 阶段二：第 2-4 周 ──
  { id: 6,  name: '十日之基', icon: '十', color: '#4ECDC4', stage: '第 2-4 周', day: 14,
    desc: '累计锻炼 10 次', check: (c) => c.totalClasses >= 10 },
  { id: 7,  name: '七日满贯', icon: '七', color: '#5B57EB', stage: '第 2-4 周', day: 21,
    desc: '连续锻炼 7 天', check: (c) => c.streak >= 7 },
  { id: 8,  name: '双周不辍', icon: '双', color: '#185FA5', stage: '第 2-4 周', day: 28,
    desc: '连续锻炼 14 天', check: (c) => c.streak >= 14 },

  // ── 阶段三：第 1-3 个月 ──
  { id: 9,  name: '满月之约', icon: '月', color: '#7F77DD', stage: '第 1-3 个月', day: 42,
    desc: '成为会员满 30 天', check: (c) => c.memberDays >= 30 },
  { id: 10, name: '二十次历练', icon: '廿', color: '#534AB7', stage: '第 1-3 个月', day: 56,
    desc: '累计锻炼 20 次', check: (c) => c.totalClasses >= 20 },
  { id: 11, name: '百日筑基', icon: '百', color: '#3C3489', stage: '第 1-3 个月', day: 84,
    desc: '累计锻炼 30 次', check: (c) => c.totalClasses >= 30 },

  // ── 阶段四：第 2-4 季度（固定节奏 · 每 2 周一项）──
  { id: 12, name: '四十次淬炼', icon: '四', color: '#D85A30', stage: '第 2-4 季度', day: 98,
    desc: '累计锻炼 40 次', check: (c) => c.totalClasses >= 40 },
  { id: 13, name: '双月笃行', icon: '双', color: '#BA7517', stage: '第 2-4 季度', day: 112,
    desc: '成为会员满 60 天', check: (c) => c.memberDays >= 60 },
  { id: 14, name: '储值先行', icon: '储', color: '#F8D044', stage: '第 2-4 季度', day: 126,
    desc: '完成首次储值', check: (c) => c.rechargeFen > 0 },
  { id: 15, name: '引伴同行', icon: '伴', color: '#D85A30', stage: '第 2-4 季度', day: 140,
    desc: '成功邀请 1 位好友', check: (c) => c.inviteCount >= 1 },
  { id: 16, name: '多面手', icon: '手', color: '#7F77DD', stage: '第 2-4 季度', day: 154,
    desc: '体验 4 种不同课程', check: (c) => c.courseKinds >= 4 },
  { id: 17, name: '六十次磨砺', icon: '六', color: '#E5484D', stage: '第 2-4 季度', day: 168,
    desc: '累计锻炼 60 次', check: (c) => c.totalClasses >= 60 },
  { id: 18, name: '能量新星', icon: '能', color: '#B9FF66', stage: '第 2-4 季度', day: 182,
    desc: '能量币余额达 200', check: (c) => c.coins >= 200 },
  { id: 19, name: '老友记', icon: '友', color: '#5B57EB', stage: '第 2-4 季度', day: 196,
    desc: '成功邀请 3 位好友', check: (c) => c.inviteCount >= 3 },
  { id: 20, name: '八十次突破', icon: '八', color: '#D85A30', stage: '第 2-4 季度', day: 210,
    desc: '累计锻炼 80 次', check: (c) => c.totalClasses >= 80 },
  { id: 21, name: '单课宗师', icon: '时', color: '#BA7517', stage: '第 2-4 季度', day: 224,
    desc: '累计锻炼时长 50 小时', check: (c) => c.totalMinutes >= 3000 },
  { id: 22, name: '百炼成钢', icon: '钢', color: '#A32D2D', stage: '第 2-4 季度', day: 238,
    desc: '累计锻炼 100 次', check: (c) => c.totalClasses >= 100 },
  { id: 23, name: '能量达人', icon: '力', color: '#B9FF66', stage: '第 2-4 季度', day: 252,
    desc: '能量币余额达 500', check: (c) => c.coins >= 500 },
  { id: 24, name: '一百二十次', icon: '贰', color: '#D85A30', stage: '第 2-4 季度', day: 266,
    desc: '累计锻炼 120 次', check: (c) => c.totalClasses >= 120 },
  { id: 25, name: '连续三十', icon: '连', color: '#185FA5', stage: '第 2-4 季度', day: 280,
    desc: '连续锻炼 30 天', check: (c) => c.streak >= 30 },
  { id: 26, name: '储值升级', icon: '金', color: '#F8D044', stage: '第 2-4 季度', day: 294,
    desc: '累计储值 ¥2000', check: (c) => c.rechargeFen >= 200000 },
  { id: 27, name: '一百五十次', icon: '伍', color: '#E5484D', stage: '第 2-4 季度', day: 308,
    desc: '累计锻炼 150 次', check: (c) => c.totalClasses >= 150 },
  { id: 28, name: '三季之约', icon: '季', color: '#BA7517', stage: '第 2-4 季度', day: 322,
    desc: '成为会员满 270 天', check: (c) => c.memberDays >= 270 },
  { id: 29, name: '双百小时', icon: '百', color: '#534AB7', stage: '第 2-4 季度', day: 350,
    desc: '累计锻炼时长 100 小时', check: (c) => c.totalMinutes >= 6000 },

  // ── 阶段五：一整年 ──
  { id: 30, name: '周年之约', icon: '年', color: '#F8D044', stage: '一整年', day: 364,
    desc: '成为会员满 365 天', check: (c) => c.memberDays >= 365 }
];

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
    stages: [],          // 成就时间线（按阶段分组）
    unlockedTotal: 0,
    unlockedAll: false,
    loading: true,
    offline: false
  },

  onLoad() {
    this.loadAchievements();
  },

  loadAchievements() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ loading: false });
      return;
    }
    // 并行拉取：订课 / 会员(注册天数+能量币) / 充值 / 邀请
    Promise.all([
      api.getMyBookings(openid).catch(() => null),
      api.getMemberLevel(openid).catch(() => null),
      api.getMyRecharges(openid, 0, 100).catch(() => null),
      api.getInviteStats(openid).catch(() => null)
    ]).then(([bkRes, lvRes, reRes, invRes]) => {
      const bookings = (bkRes && bkRes.bookings) || [];
      const attended = bookings.filter(b =>
        b.status === 'booked' &&
        courseStatus.getSessionStatus(b.date, b.start_time, b.end_time) === 'ended'
      );
      const dates = attended.map(b => b.date);
      const totalClasses = attended.length;
      const checkedIn = attended.filter(b => b.checkin_at).length;
      const totalMinutes = attended.reduce((s, b) => s + (b.duration_min || 60), 0);
      const calories = totalMinutes * KCAL_PER_MIN;
      const streak = this.calcStreak(dates);
      const weekRecord = this.calcWeekRecord(dates);
      const weekCount = weekRecord.reduce((s, d) => s + d.count, 0);
      const hoursText = totalMinutes >= 60 ? `${Math.round(totalMinutes / 60)}h` : `${totalMinutes}分钟`;

      // 成就判定上下文
      const ctx = {
        bookedCount: bookings.length,
        totalClasses,
        checkedIn,
        streak,
        totalMinutes,
        courseKinds: new Set(attended.map(b => b.course_name)).size,
        memberDays: (lvRes && lvRes.level && lvRes.level.memberDays) || 0,
        coins: (lvRes && lvRes.level && lvRes.level.coinBalance) || 0,
        rechargeFen: (reRes && reRes.recharges || []).reduce((s, r) => s + (r.amount_fen || 0), 0),
        inviteCount: (invRes && invRes.invited) || 0
      };

      // 30 项成就判定 + 按阶段分组
      const enriched = ACHIEVEMENTS.map(a => ({ ...a, unlocked: !!a.check(ctx) }));
      const stageOrder = ['第 1-5 天', '第 2-4 周', '第 1-3 个月', '第 2-4 季度', '一整年'];
      const stages = stageOrder.map(label => {
        const items = enriched.filter(a => a.stage === label);
        return { label, items, unlockedCount: items.filter(i => i.unlocked).length };
      });
      const unlockedTotal = enriched.filter(a => a.unlocked).length;

      this.setData({
        stats: [
          { value: totalClasses, label: '累计上课（次）' },
          { value: hoursText, label: '累计时长' },
          { value: fmtNum(calories), label: '累计卡路里（千卡）' }
        ],
        streak,
        weekRecord,
        weekCount,
        stages,
        unlockedTotal,
        unlockedAll: unlockedTotal >= 30,
        loading: false,
        offline: false
      });
    }).catch(() => {
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
