/**
 * 教练域（coach）：我的学员聚合、学员笔记、月度结算、设教练（DESIGN #D1 任务3-6）
 */
const { db } = require('../db-core');
const { getCoachConfig } = require('../coach-config');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）

/** 解析教练档案：openid → coaches 行（未绑定档案返回 null） */
function findCoachByOpenid(openid) {
  return db.prepare("SELECT * FROM coaches WHERE user_openid = ?").get(openid) || null;
}

/**
 * 我的学员：收录所有已签到学员（最近签到倒序）
 * 每项：openid/nickname/avatar/last_course/last_date/has_note/total_classes
 * @param {string} coachOpenid 教练微信 openid
 * @returns {Array|null} null = 教练档案不存在
 */
function listCoachStudents(coachOpenid) {
  const coach = findCoachByOpenid(coachOpenid);
  if (!coach) return null;
  return db.prepare(`
    SELECT u.openid, u.nickname, u.avatar, u.total_classes,
           (SELECT c.name FROM bookings b2
             JOIN course_sessions s2 ON s2.id = b2.session_id
             JOIN courses c ON c.id = s2.course_id
            WHERE b2.user_openid = u.openid AND b2.status = 'booked' AND b2.checkin_at IS NOT NULL
              AND s2.coach_id = ?
            ORDER BY s2.date DESC, s2.start_time DESC LIMIT 1) AS last_course,
           (SELECT s2.date FROM bookings b2
             JOIN course_sessions s2 ON s2.id = b2.session_id
            WHERE b2.user_openid = u.openid AND b2.status = 'booked' AND b2.checkin_at IS NOT NULL
              AND s2.coach_id = ?
            ORDER BY s2.date DESC, s2.start_time DESC LIMIT 1) AS last_date,
           EXISTS(SELECT 1 FROM coach_notes n
                   WHERE n.coach_openid = ? AND n.student_openid = u.openid) AS has_note,
           MAX(b.checkin_at) AS last_checkin_at
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN users u ON u.openid = b.user_openid
    WHERE s.coach_id = ? AND b.status = 'booked' AND b.checkin_at IS NOT NULL
    GROUP BY u.openid
    ORDER BY last_checkin_at DESC
  `).all(coach.id, coach.id, coachOpenid, coach.id);
}

/**
 * 学员跟课记录（教练查看某学员的全部签到课程）
 * @returns {Array|null} null = 教练档案不存在
 */
function listStudentLessons(coachOpenid, studentOpenid) {
  const coach = findCoachByOpenid(coachOpenid);
  if (!coach) return null;
  return db.prepare(`
    SELECT b.id, s.date, s.start_time, s.end_time, c.name AS course_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN venues v ON v.id = s.venue_id
    WHERE s.coach_id = ? AND b.user_openid = ? AND b.status = 'booked' AND b.checkin_at IS NOT NULL
    ORDER BY s.date DESC, s.start_time DESC
  `).all(coach.id, studentOpenid);
}

/** 读学员笔记（仅本人；无笔记返回空串） */
function getCoachNote(coachOpenid, studentOpenid) {
  return db.prepare('SELECT content, updated_at FROM coach_notes WHERE coach_openid = ? AND student_openid = ?')
    .get(coachOpenid, studentOpenid) || { content: '', updated_at: null };
}

/**
 * 写学员笔记（upsert 幂等，仅本人）
 * 双方言兼容写法（DESIGN #D2 S2）：先 UPDATE 影响 0 行再 INSERT——SQLite 的
 * ON CONFLICT DO UPDATE 与 MySQL 的 ON DUPLICATE KEY UPDATE 不互通，改两语句等价；
 * 单用户编辑笔记，并发竞态可忽略。
 */
function upsertCoachNote(coachOpenid, studentOpenid, content) {
  const now = time.nowDateTimeStr();
  const upd = db.prepare(`
    UPDATE coach_notes SET content = ?, updated_at = ?
    WHERE coach_openid = ? AND student_openid = ?
  `).run(content, now, coachOpenid, studentOpenid);
  if (upd.changes === 0) {
    db.prepare(`
      INSERT INTO coach_notes (coach_openid, student_openid, content, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(coachOpenid, studentOpenid, content, now);
  }
  return getCoachNote(coachOpenid, studentOpenid);
}

/**
 * 月度结算（只读聚合）
 * 课次 = 本月已结束场次数；签到 = 本月该教练场次签到总数
 * 金额 = 课次×课时单价 + 签到×奖励单价（单价取自 coach_config 单源）
 * @param {number} coachId
 * @param {string} month 'YYYY-MM'
 * @returns {object} { month, sessions, checkins, course_fee_fen, reward_fen, total_fen }
 */
function getCoachSettlement(coachId, month) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month || '');
  if (!m) return null;
  const [y, mm] = [Number(m[1]), Number(m[2])];
  const from = `${month}-01`;
  const to = `${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}-01`;
  const sessions = db.prepare(`
    SELECT COUNT(*) c FROM course_sessions
    WHERE coach_id = ? AND date >= ? AND date < ?
      AND (date < ?
           OR (date = ? AND end_time < ?))
  `).get(coachId, from, to, time.todayStr(), time.todayStr(), time.nowTimeStr()).c;
  const checkins = db.prepare(`
    SELECT COUNT(*) c FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE s.coach_id = ? AND s.date >= ? AND s.date < ?
      AND b.status = 'booked' AND b.checkin_at IS NOT NULL
  `).get(coachId, from, to).c;
  const cfg = getCoachConfig();
  return {
    month, sessions, checkins,
    course_fee_fen: cfg.course_fee_fen,
    reward_fen: cfg.checkin_reward_fen,
    total_fen: sessions * cfg.course_fee_fen + checkins * cfg.checkin_reward_fen
  };
}

/**
 * 设教练：账号 role=coach + 绑定教练档案（管理后台调用）
 * @returns {{ok:boolean, error?:string}}
 */
function assignCoach(openid, coachId) {
  const user = db.prepare("SELECT * FROM users WHERE openid = ?").get(openid);
  if (!user) return { ok: false, error: '账号不存在，请先确认该微信已登录过' };
  const coach = db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  if (!coach) return { ok: false, error: '教练档案不存在' };
  if (coach.user_openid && coach.user_openid !== openid) {
    return { ok: false, error: '该教练档案已被其他账号绑定' };
  }
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE users SET role = 'coach' WHERE openid = ?").run(openid);
    db.prepare('UPDATE coaches SET user_openid = ? WHERE id = ?').run(openid, coachId);
    // 同一账号解绑其他档案（防一对多）
    db.prepare('UPDATE coaches SET user_openid = NULL WHERE user_openid = ? AND id != ?').run(openid, coachId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

module.exports = { findCoachByOpenid, listCoachStudents, listStudentLessons, getCoachNote, upsertCoachNote, getCoachSettlement, assignCoach };
