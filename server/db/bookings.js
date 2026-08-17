/**
 * 订课域（bookings）：订课记录、签到、退订（含候补转正联动）、统计
 */
const { db, driver } = require('../db-core');
const { findUserByOpenid } = require('./users');
const { addCoins } = require('./coin');
const { refundOrderMoney } = require('./members');
const { getSessionById, syncSessionStatus } = require('./courses');
const { promoteFromWaitlist } = require('./orders');
const { sendMessage } = require('./messages');
const { refundPass } = require('./passes');
const ENERGY_CONFIG = require('../energy-config.js');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）

/** 随机 5 位纯数字签到码（BUGS-INBOX #11：bookingId 补零 → 随机码，防猜测/串号）
 * 唯一性：生成后查重，撞号重试（表无 UNIQUE 约束，因 SQLite 不支持 ADD COLUMN 带 UNIQUE）
 */
async function genCheckinCode() {
  for (let i = 0; i < 10; i++) {
    const code = String(Math.floor(10000 + Math.random() * 90000)); // 10000-99999
    const dup = await driver.get('SELECT id FROM bookings WHERE checkin_code = ?', [code]);
    if (!dup) return code;
  }
  throw new Error('签到码生成失败：多次撞号');
}

async function createBooking({ user_openid, session_id, amount_fen = 0, pay_status = 'paid' }) {
  // 校验用户存在
  const user = await findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  // 校验场次存在且可订
  const session = await getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };
  if (session.remaining <= 0) return { ok: false, error: '该课程已满员' };

  // 检查是否已订（UNIQUE 约束兜底）
  let exists = await driver.get('SELECT id, status FROM bookings WHERE user_openid = ? AND session_id = ?', [user_openid, session_id]);
  if (exists && exists.status === 'booked') return { ok: false, error: '您已预订该课程，请勿重复预订' };

  const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
  const checkinCode = await genCheckinCode(); // 随机 5 位签到码（BUGS-INBOX #11）

  await driver.exec('BEGIN');
  try {
    if (exists) {
      // 曾退订 → 重新激活原订单（保留历史 booking_no / checkin_code）
      await driver.run("UPDATE bookings SET status = 'booked', pay_status = ?, cancel_reason = '', checkin_at = NULL WHERE id = ?", [pay_status, exists.id]);
    } else {
      // 1. 创建订单（取 run() 返回的 lastInsertRowid——该 SQLite 取 id 函数 MySQL 无）
      const r = await driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status, checkin_code)
                  VALUES (?, ?, ?, ?, 'booked', ?, ?)`, [bookingNo, user_openid, session_id, amount_fen, pay_status, checkinCode]);
      exists = { id: r.lastInsertRowid };
    }
    // 2. 扣减余位
    await driver.run('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?', [session_id]);
    await syncSessionStatus(session_id);
    await driver.exec('COMMIT');
  } catch (e) {
    await driver.exec('ROLLBACK');
    if (e.message.includes('UNIQUE')) return { ok: false, error: '您已预订该课程，请勿重复预订' };
    throw e;
  }

  const booking = await driver.get(`
    SELECT b.id, b.booking_no, b.session_id, b.amount_fen, b.status, b.pay_status, b.checkin_at, b.created_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.id = ?
  `, [exists.id]);
  // 站内信：订课成功
  await sendMessage({
    user_openid, type: 'booking', title: '订课成功',
    content: `已成功预约「${booking.course_name}」${booking.date} ${booking.start_time}`,
    biz_type: 'course', biz_id: booking.id, jump_url: '/pages/student-my-courses/index',
    dedup_key: `book:${booking.id}`
  });
  return { ok: true, booking };
}

/**
 * 查询某学员的全部订课（我的课程）
 * @param {string} openid
 * @param {string} [status] 可选筛选：booked/cancelled
 */
async function listBookingsByUser(openid, status) {
  const where = status ? 'WHERE b.user_openid = ? AND b.status = ?' : 'WHERE b.user_openid = ?';
  const params = status ? [openid, status] : [openid];
  return await driver.all(`
    SELECT b.id, b.booking_no, b.session_id, b.amount_fen, b.status, b.pay_status, b.checkin_at, b.created_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.id AS course_id, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    ${where}
    ORDER BY s.date DESC, s.start_time DESC
  `, [...params]);
}

/**
 * 签到凭证信息：按订课 ID 查询（学员二维码页展示用）
 * 历史订课无 checkin_code → lazy 回填随机码（BUGS-INBOX #11）
 * @returns {object|null} 课程/时间/场地/签到状态/签到码
 */
async function getCheckinInfo(bookingId) {
  const info = await driver.get(`
    SELECT b.id, b.session_id, b.status, b.checkin_at, b.checkin_code, b.user_openid,
           s.date, s.start_time, s.end_time,
           c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.id = ?
  `, [bookingId]) || null;
  if (info && !info.checkin_code) {
    const code = await genCheckinCode();
    await driver.run('UPDATE bookings SET checkin_code = ? WHERE id = ?', [code, bookingId]);
    info.checkin_code = code;
  }
  return info;
}

/**
 * 教练按签到码核销（BUGS-INBOX #11：随机 5 位码 → 反查订课）
 * @param {object} p { code, coachOpenid }
 * @returns {{ok:true, booking:object}|{ok:false, error:string}}
 */
async function checkinByCode({ code, coachOpenid }) {
  const text = String(code || '').trim();
  if (!/^\d{5}$/.test(text)) return { ok: false, error: '签到码格式不正确（应为 5 位数字）' };
  const booking = await driver.get('SELECT id FROM bookings WHERE checkin_code = ?', [text]);
  if (!booking) return { ok: false, error: '签到码不存在' };
  return await checkinBooking({ bookingId: booking.id, coachOpenid });
}

/**
 * 按场次查订课名单（教练端学员名单，含学员昵称与签到状态）
 */
async function listBookingsBySession(sessionId) {
  return await driver.all(`
    SELECT b.id, b.session_id, b.status, b.checkin_at, b.user_openid,
           u.nickname AS student_name, u.avatar AS student_avatar,
           s.date, s.start_time, s.end_time,
           c.name AS course_name, v.name AS venue_name
    FROM bookings b
    JOIN users u ON u.openid = b.user_openid
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.session_id = ? AND b.status = 'booked'
    ORDER BY b.checkin_at IS NULL, b.created_at
  `, [sessionId]);
}

/**
 * 教练核销签到（扫码后调用）
 * @param {object} p { bookingId, coachOpenid }
 * @returns {{ok:true, booking:object}|{ok:false, error:string}}
 */
async function checkinBooking({ bookingId, coachOpenid }) {
  // 校验教练身份（coaches 表或 users.role='coach'）
  const coach = await driver.get("SELECT * FROM users WHERE openid = ? AND \`role\` = 'coach'", [coachOpenid])
    || await driver.get('SELECT * FROM coaches WHERE user_openid = ?', [coachOpenid]);
  if (!coach) return { ok: false, error: '无教练权限' };

  const booking = await driver.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) return { ok: false, error: '订课记录不存在' };
  if (booking.status !== 'booked') return { ok: false, error: '该订课已失效' };
  if (booking.checkin_at) return { ok: false, error: '该学员已签到，请勿重复签到' };

  const session = await driver.get('SELECT * FROM course_sessions WHERE id = ?', [booking.session_id]);
  if (!session) return { ok: false, error: '场次不存在' };

  // 时间校验：只允许当天签到（开课前 30 分钟至课程结束后 30 分钟）
  // 取时间走 time.js（显式北京时间，不依赖容器系统时区，BUG-LEDGER #28）
  const todayStr = time.todayStr();
  if (session.date !== todayStr) {
    return { ok: false, error: `仅支持当天签到（场次日期 ${session.date}）` };
  }
  // 时间窗口：开课前 30 分钟 ～ 课程结束后 30 分钟（防提前/过期签到，BUG-LEDGER #10；2026-08-16 统一为课后 30 分钟，DESIGN #D1）
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const nowMin = time.nowMin();
  const startMin = toMin(session.start_time);
  const endMin = toMin(session.end_time);
  const EARLY_WINDOW = 30;   // 开课前可提前 30 分钟
  const LATE_WINDOW = 30;    // 结束后可补签 30 分钟
  if (nowMin < startMin - EARLY_WINDOW) {
    return { ok: false, error: `未到签到时间，开课前 ${EARLY_WINDOW} 分钟开始可签到（${session.start_time} 开课）` };
  }
  if (nowMin > endMin + LATE_WINDOW) {
    return { ok: false, error: '课程已结束超过 30 分钟，无法签到' };
  }

  await driver.run('UPDATE bookings SET checkin_at = ? WHERE id = ?', [time.nowDateTimeStr(), bookingId]);
  // 同步用户累计次数（total_classes +1）
  await driver.run('UPDATE users SET total_classes = total_classes + 1 WHERE openid = ?', [booking.user_openid]);
  // 能量币：签到 + 上课
  const checkinCoins = ENERGY_CONFIG.earnRules.checkin || 0;
  const attendCoins = ENERGY_CONFIG.earnRules.attendClass || 0;
  if (checkinCoins > 0) await addCoins(booking.user_openid, checkinCoins, '签到奖励', `CK-${bookingId}`);
  if (attendCoins > 0) await addCoins(booking.user_openid, attendCoins, '完成课程奖励', `CK-${bookingId}`);
  // 站内信：签到成功
  const sInfo = await getSessionById(booking.session_id);
  await sendMessage({
    user_openid: booking.user_openid, type: 'booking', title: '签到成功',
    content: `「${sInfo ? sInfo.course_name : '课程'}」签到成功，训练愉快，记得拉伸放松`,
    biz_type: 'course', biz_id: bookingId, jump_url: '/pages/student-my-courses/index',
    dedup_key: `checkin:${bookingId}`
  });

  return { ok: true, booking: await getCheckinInfo(bookingId) };
}

/**
 * 退订：取消订单 + 恢复场次余位（事务）
 */
async function cancelBooking(openid, bookingId) {
  const booking = await driver.get('SELECT * FROM bookings WHERE id = ? AND user_openid = ?', [bookingId, openid]);
  if (!booking) return { ok: false, error: '订单不存在' };
  if (booking.status === 'cancelled') return { ok: false, error: '该订单已退订' };

  await driver.exec('BEGIN');
  let promoted = null;
  let refundOrder = null;   // 声明在外层，事务后退钱使用
  try {
    await driver.run("UPDATE bookings SET status = 'cancelled', cancel_reason = '用户退订' WHERE id = ?", [bookingId]);
    // 关联订单标记退款（仅已支付的订单），并记录订单号用于退钱
    refundOrder = await driver.get("SELECT id FROM orders WHERE booking_id = ? AND status = 'paid'", [bookingId]);
    if (refundOrder) {
      await driver.run(`UPDATE orders SET status = 'refunded', refunded_at = ?, cancel_reason = '用户退订'
                  WHERE id = ?`, [time.nowDateTimeStr(), refundOrder.id]);
    }
    // 仅未签到订单恢复余位
    if (!booking.checkin_at) {
      await driver.run('UPDATE course_sessions SET booked_count = MAX(booked_count - 1, 0) WHERE id = ?', [booking.session_id]);
      await syncSessionStatus(booking.session_id);
      // 有候补者 → 最早排位者自动转正（候补队列先进先出）
      promoted = await promoteFromWaitlist(booking.session_id);
    }
    await driver.exec('COMMIT');
  } catch (e) {
    await driver.exec('ROLLBACK');
    throw e;
  }
  // 事务外对称退：次卡→退次（卡已过期作废清理）；余额→退余额；微信→原路（模拟）
  if (refundOrder) {
    const o = await driver.get('SELECT pay_source FROM orders WHERE id = ?', [refundOrder.id]);
    if (o && o.pay_source === 'pass') {
      const r = await refundPass(booking.pass_id);
      if (r === 'refunded') {
        await sendMessage({
          user_openid: openid, type: 'pass', title: '次卡已退回',
          content: '退订成功，已退回 1 次次卡次数',
          biz_type: 'pass', biz_id: booking.pass_id || 0, jump_url: '/pages/member-level/index',
          dedup_key: `pass_refund:${bookingId}`
        });
      }
      // 'expired'：卡已过期 → 次数作废清理（不提示退回）
    } else {
      await refundOrderMoney(refundOrder.id);
    }
  }
  // 站内信：退款到账（次卡订课金额为 0，仅余额/微信单退钱）
  const sInfo = await getSessionById(booking.session_id);
  const refundAmt = (booking.amount_fen || 0) / 100;
  await sendMessage({
    user_openid: openid, type: 'order', title: '退款到账',
    content: refundAmt > 0
      ? `退订「${sInfo ? sInfo.course_name : '课程'}」成功，¥${refundAmt.toFixed(0)} 已原路退回`
      : `退订「${sInfo ? sInfo.course_name : '课程'}」成功`,
    biz_type: 'order', biz_id: bookingId, jump_url: '/pages/student-orders/index',
    dedup_key: `refund:${bookingId}`
  });
  return { ok: true, promoted };
}

// ===== 消息中心（站内信）=====

/**
 * 发送站内信（带 dedup_key 时自动去重，防重复推送）
 * @param {object} m { user_openid, type, title, content, biz_type, biz_id, jump_url, dedup_key }
 * @returns {number|null} 消息 id 或 null(重复)
 */

async function countBookingsByUser(openid) {
  return (await driver.get("SELECT COUNT(*) c FROM bookings WHERE user_openid = ? AND status = 'booked'", [openid])).c;
}

/**
 * 统计已完成的锻炼次数 = 已订（booked）且场次已结束的总数
 * 场次已结束：日期早于今天，或日期=今天且结束时间早于当前时间
 */
async function countFinishedWorkouts(openid) {
  const row = await driver.get(`
    SELECT COUNT(*) c
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE b.user_openid = ? AND b.status = 'booked'
      AND (s.date < ?
           OR (s.date = ? AND s.end_time < ?))
  `, [openid, time.todayStr(), time.todayStr(), time.nowTimeStr()]);
  return row.c;
}

/**
 * 统计当前未开始的已订课（待上课）
 */
async function countUpcomingBookings(openid) {
  const row = await driver.get(`
    SELECT COUNT(*) c
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE b.user_openid = ? AND b.status = 'booked'
      AND (s.date > ?
           OR (s.date = ? AND s.start_time >= ?))
  `, [openid, time.todayStr(), time.todayStr(), time.nowTimeStr()]);
  return row.c;
}

// ===== 导出 =====
module.exports = { createBooking, listBookingsByUser, getCheckinInfo, listBookingsBySession, checkinBooking, checkinByCode, cancelBooking, countBookingsByUser, countFinishedWorkouts, countUpcomingBookings };
