/**
 * 成就系统（2026-08-14）
 * - 30 项成就按 5 阶段时间线（火星/火苗/火焰/烈焰/燎原）
 * - 每解锁 1 项成就 → 发放 50 能量币（幂等：每项只发一次，UNIQUE(user_openid, ach_key) 兜底）
 * - 判定口径与前端 student-achievements 页一致（已参加 = 已订且场次已结束）
 */

const ACHIEVEMENTS = [
  // ── 火星（第 1-5 天）──
  { key: 'first_book',   name: '初次见面', check: c => c.bookedCount >= 1 },
  { key: 'first_workout',name: '第一滴汗', check: c => c.totalClasses >= 1 },
  { key: 'first_checkin',name: '签到首秀', check: c => c.checkedIn >= 1 },
  { key: 'streak_3',     name: '三日不辍', check: c => c.streak >= 3 },
  { key: 'streak_5',     name: '五日坚持', check: c => c.streak >= 5 },
  // ── 火苗（第 2-4 周）──
  { key: 'total_10',     name: '十日之基', check: c => c.totalClasses >= 10 },
  { key: 'streak_7',     name: '七日满贯', check: c => c.streak >= 7 },
  { key: 'streak_14',    name: '双周不辍', check: c => c.streak >= 14 },
  // ── 火焰（第 1-3 个月）──
  { key: 'member_30',    name: '满月之约', check: c => c.memberDays >= 30 },
  { key: 'total_20',     name: '二十次历练', check: c => c.totalClasses >= 20 },
  { key: 'total_30',     name: '百日筑基', check: c => c.totalClasses >= 30 },
  // ── 烈焰（第 2-4 季度 · 固定节奏）──
  { key: 'total_40',     name: '四十次淬炼', check: c => c.totalClasses >= 40 },
  { key: 'member_60',    name: '双月笃行', check: c => c.memberDays >= 60 },
  { key: 'first_recharge', name: '储值先行', check: c => c.rechargeFen > 0 },
  { key: 'invite_1',     name: '引伴同行', check: c => c.inviteCount >= 1 },
  { key: 'kinds_4',      name: '多面手', check: c => c.courseKinds >= 4 },
  { key: 'total_60',     name: '六十次磨砺', check: c => c.totalClasses >= 60 },
  { key: 'coins_200',    name: '能量新星', check: c => c.coins >= 200 },
  { key: 'invite_3',     name: '老友记', check: c => c.inviteCount >= 3 },
  { key: 'total_80',     name: '八十次突破', check: c => c.totalClasses >= 80 },
  { key: 'hours_50',     name: '单课宗师', check: c => c.totalMinutes >= 3000 },
  { key: 'total_100',    name: '百炼成钢', check: c => c.totalClasses >= 100 },
  { key: 'coins_500',    name: '能量达人', check: c => c.coins >= 500 },
  { key: 'total_120',    name: '一百二十次', check: c => c.totalClasses >= 120 },
  { key: 'streak_30',    name: '连续三十', check: c => c.streak >= 30 },
  { key: 'recharge_2000', name: '储值升级', check: c => c.rechargeFen >= 200000 },
  { key: 'total_150',    name: '一百五十次', check: c => c.totalClasses >= 150 },
  { key: 'member_270',   name: '三季之约', check: c => c.memberDays >= 270 },
  { key: 'hours_100',    name: '双百小时', check: c => c.totalMinutes >= 6000 },
  // ── 燎原（一整年）──
  { key: 'member_365',   name: '周年之约', check: c => c.memberDays >= 365 }
];

const REWARD_COINS = 50;

const { db } = require('../db-core');
const { findUserByOpenid } = require('./users');
const { addCoins } = require('./coin');

/** 日期工具（JS 实现，与 SQLite 格式一致） */
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function pad2(n) { return String(n).padStart(2, '0'); }

/** 9 维判定上下文（与前端 student-achievements 口径一致） */
function computeAchievementContext(openid) {
  const user = findUserByOpenid(openid);
  if (!user) return null;

  const bookings = db.prepare(`
    SELECT b.status, b.checkin_at, b.created_at, s.date, s.end_time, c.duration_min, c.name AS course_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    WHERE b.user_openid = ?
  `).all(openid);

  // 已参加 = 已订（booked）且场次已结束（日期早于今天，或今天且结束时间已过）——与前端一致
  const now = new Date();
  const todayStr = fmtDate(now);
  const nowTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const attended = bookings.filter(b =>
    b.status === 'booked' &&
    (b.date < todayStr || (b.date === todayStr && b.end_time < nowTime))
  );

  // 连续天数：从今天（或昨天，若今天还没练）往前数连续有训练的天数
  const dates = attended.map(b => b.date);
  const set = new Set(dates);
  const d = new Date();
  if (!set.has(fmtDate(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (set.has(fmtDate(d))) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }

  return {
    bookedCount: bookings.length,
    totalClasses: attended.length,
    checkedIn: attended.filter(b => b.checkin_at).length,
    streak,
    totalMinutes: attended.reduce((s, b) => s + (b.duration_min || 60), 0),
    courseKinds: new Set(attended.map(b => b.course_name)).size,
    memberDays: user.created_at ? Math.max(0, Math.floor((Date.now() - new Date(String(user.created_at).replace(' ', 'T')).getTime()) / 864e5)) : 0,
    coins: user.coin_balance || 0,
    rechargeFen: (db.prepare("SELECT COALESCE(SUM(amount_fen),0) s FROM member_recharges WHERE user_openid = ?").get(openid).s) || 0,
    inviteCount: (db.prepare('SELECT COUNT(*) c FROM invitations WHERE inviter = ?').get(openid).c) || 0
  };
}

/** 已解锁成就 key 集合 */
function listUserAchievementKeys(openid) {
  return db.prepare('SELECT ach_key FROM user_achievements WHERE user_openid = ?').all(openid).map(r => r.ach_key);
}

/**
 * 同步成就：对"达成但未记录"的成就插入记录并发放 50 能量币（幂等）
 * @returns {{ newly: Array<{key,name}>, unlockedKeys: string[], unlockedCount: number }}
 */
function syncAchievements(openid) {
  const ctx = computeAchievementContext(openid);
  if (!ctx) return { newly: [], unlockedKeys: [], unlockedCount: 0 };
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (!a.check(ctx)) continue;
    const exists = db.prepare('SELECT id FROM user_achievements WHERE user_openid = ? AND ach_key = ?').get(openid, a.key);
    if (exists) continue;
    db.prepare('INSERT INTO user_achievements (user_openid, ach_key, coin_reward) VALUES (?, ?, ?)')
      .run(openid, a.key, REWARD_COINS);
    try {
      // 成就奖励为长期激励，不受每日能量币上限限制
      addCoins(openid, REWARD_COINS, `解锁成就「${a.name}」`, 'ACH-' + a.key, true);
    } catch (e) {
      // 发币失败不阻断（记录已存在，后续不会重发）
    }
    newly.push({ key: a.key, name: a.name });
  }
  const unlockedKeys = listUserAchievementKeys(openid);
  return { newly, unlockedKeys, unlockedCount: unlockedKeys.length };
}

module.exports = { ACHIEVEMENTS, REWARD_COINS, syncAchievements, listUserAchievementKeys };
