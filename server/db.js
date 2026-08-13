/**
 * 数据库层聚合入口
 * 连接/建表：db-core.js；按域拆分：db/users.js、db/coin.js、db/members.js、db/invite.js、db/courses.js
 * 说明：db 内跨域函数通过下方解构保持可见；bookings/orders/messages 域待批 2b
 */
const { db, courseCols } = require('./db-core');
const { findUserByOpenid, createUser, touchLogin, updateProfile, countUsers, listUsers, deleteUserById, deleteUserByOpenid, clearUsers } = require('./db/users');
const { todayCoinsEarned, addCoins, getCoinInfo, listCoinLogs, listShopItems, exchangeCoinItem, listMyExchanges, checkLevelUpReward, rewardInviterCoins } = require('./db/coin');
const { getMemberLevel, addBalance, refundOrderMoney, hasRechargedPlan, calcRechargeBonus, applyRecharge, listRecharges, listUnreadBalanceLogs, markBalanceLogsRead, RECHARGE_PLANS } = require('./db/members');
const { listInvitationDetails, inviteBoardStats, bindInvitation, rewardInviter, getInviteStats } = require('./db/invite');
const { listCoaches, listVenues, listCourses, getRules, replaceRules, createCourse, updateCourse, deleteCourse, publishSessions, listSessionsByDate, listSessionsByCoach, listSessionsByRange, cancelSession, updateSessionCapacity, listSessionsByDateForUser, getSessionById } = require('./db/courses');

// 配置（剩余订单/签到等域仍使用）
const MEMBER_CONFIG = require('./member-config.js');
const ENERGY_CONFIG = require('./energy-config.js');

function createBooking({ user_openid, session_id, amount_fen = 0, pay_status = 'paid' }) {
  // 校验用户存在
  const user = findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  // 校验场次存在且可订
  const session = getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };
  if (session.remaining <= 0) return { ok: false, error: '该课程已满员' };

  // 检查是否已订（UNIQUE 约束兜底）
  const exists = db.prepare('SELECT id, status FROM bookings WHERE user_openid = ? AND session_id = ?').get(user_openid, session_id);
  if (exists && exists.status === 'booked') return { ok: false, error: '您已预订该课程，请勿重复预订' };

  const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();

  db.exec('BEGIN');
  try {
    if (exists) {
      // 曾退订 → 重新激活原订单（保留历史 booking_no）
      db.prepare("UPDATE bookings SET status = 'booked', pay_status = ?, cancel_reason = '', checkin_at = NULL WHERE id = ?")
        .run(pay_status, exists.id);
    } else {
      // 1. 创建订单
      db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
                  VALUES (?, ?, ?, ?, 'booked', ?)`)
        .run(bookingNo, user_openid, session_id, amount_fen, pay_status);
    }
    // 2. 扣减余位
    db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(session_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    if (e.message.includes('UNIQUE')) return { ok: false, error: '您已预订该课程，请勿重复预订' };
    throw e;
  }

  const booking = db.prepare(`
    SELECT b.id, b.booking_no, b.session_id, b.amount_fen, b.status, b.pay_status, b.checkin_at, b.created_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.id = last_insert_rowid()
  `).get();
  // 站内信：订课成功
  sendMessage({
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
function listBookingsByUser(openid, status) {
  const where = status ? 'WHERE b.user_openid = ? AND b.status = ?' : 'WHERE b.user_openid = ?';
  const params = status ? [openid, status] : [openid];
  return db.prepare(`
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
  `).all(...params);
}

/**
 * 签到凭证信息：按订课 ID 查询（学员二维码页展示用）
 * @returns {object|null} 课程/时间/场地/签到状态
 */
function getCheckinInfo(bookingId) {
  return db.prepare(`
    SELECT b.id, b.session_id, b.status, b.checkin_at, b.user_openid,
           s.date, s.start_time, s.end_time,
           c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.id = ?
  `).get(bookingId) || null;
}

/**
 * 按场次查订课名单（教练端学员名单，含学员昵称与签到状态）
 */
function listBookingsBySession(sessionId) {
  return db.prepare(`
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
  `).all(sessionId);
}

/**
 * 教练核销签到（扫码后调用）
 * @param {object} p { bookingId, coachOpenid }
 * @returns {{ok:true, booking:object}|{ok:false, error:string}}
 */
function checkinBooking({ bookingId, coachOpenid }) {
  // 校验教练身份（coaches 表或 users.role='coach'）
  const coach = db.prepare("SELECT * FROM users WHERE openid = ? AND role = 'coach'").get(coachOpenid)
    || db.prepare('SELECT * FROM coaches WHERE user_openid = ?').get(coachOpenid);
  if (!coach) return { ok: false, error: '无教练权限' };

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return { ok: false, error: '订课记录不存在' };
  if (booking.status !== 'booked') return { ok: false, error: '该订课已失效' };
  if (booking.checkin_at) return { ok: false, error: '该学员已签到，请勿重复签到' };

  const session = db.prepare('SELECT * FROM course_sessions WHERE id = ?').get(booking.session_id);
  if (!session) return { ok: false, error: '场次不存在' };

  // 时间校验：只允许当天签到（开课前 30 分钟至课程结束后 2 小时）
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (session.date !== todayStr) {
    return { ok: false, error: `仅支持当天签到（场次日期 ${session.date}）` };
  }

  db.prepare("UPDATE bookings SET checkin_at = datetime('now','localtime') WHERE id = ?").run(bookingId);
  // 同步用户累计次数（total_classes +1）
  db.prepare('UPDATE users SET total_classes = total_classes + 1 WHERE openid = ?').run(booking.user_openid);
  // 能量币：签到 + 上课
  const checkinCoins = ENERGY_CONFIG.earnRules.checkin || 0;
  const attendCoins = ENERGY_CONFIG.earnRules.attendClass || 0;
  if (checkinCoins > 0) addCoins(booking.user_openid, checkinCoins, '签到奖励', `CK-${bookingId}`);
  if (attendCoins > 0) addCoins(booking.user_openid, attendCoins, '完成课程奖励', `CK-${bookingId}`);
  // 站内信：签到成功
  const sInfo = getSessionById(booking.session_id);
  sendMessage({
    user_openid: booking.user_openid, type: 'booking', title: '签到成功',
    content: `「${sInfo ? sInfo.course_name : '课程'}」签到成功，训练愉快，记得拉伸放松`,
    biz_type: 'course', biz_id: bookingId, jump_url: '/pages/student-my-courses/index',
    dedup_key: `checkin:${bookingId}`
  });

  return { ok: true, booking: getCheckinInfo(bookingId) };
}

/**
 * 退订：取消订单 + 恢复场次余位（事务）
 */
function cancelBooking(openid, bookingId) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_openid = ?').get(bookingId, openid);
  if (!booking) return { ok: false, error: '订单不存在' };
  if (booking.status === 'cancelled') return { ok: false, error: '该订单已退订' };

  db.exec('BEGIN');
  let promoted = null;
  let refundOrder = null;   // 声明在外层，事务后退钱使用
  try {
    db.prepare("UPDATE bookings SET status = 'cancelled', cancel_reason = '用户退订' WHERE id = ?").run(bookingId);
    // 关联订单标记退款（仅已支付的订单），并记录订单号用于退钱
    refundOrder = db.prepare("SELECT id FROM orders WHERE booking_id = ? AND status = 'paid'").get(bookingId);
    if (refundOrder) {
      db.prepare(`UPDATE orders SET status = 'refunded', refunded_at = datetime('now','localtime'), cancel_reason = '用户退订'
                  WHERE id = ?`).run(refundOrder.id);
    }
    // 仅未签到订单恢复余位
    if (!booking.checkin_at) {
      db.prepare('UPDATE course_sessions SET booked_count = MAX(booked_count - 1, 0) WHERE id = ?').run(booking.session_id);
      // 有候补者 → 最早排位者自动转正（候补队列先进先出）
      promoted = promoteFromWaitlist(booking.session_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // 事务外真正退钱（余额支付退回余额）
  if (refundOrder) refundOrderMoney(refundOrder.id);
  // 站内信：退款到账
  const sInfo = getSessionById(booking.session_id);
  sendMessage({
    user_openid: openid, type: 'order', title: '退款到账',
    content: `退订「${sInfo ? sInfo.course_name : '课程'}」成功，¥${(booking.amount_fen / 100).toFixed(0)} 已原路退回`,
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
function sendMessage(m) {
  if (!m || !m.user_openid || !m.title) return null;
  if (m.dedup_key) {
    const exists = db.prepare('SELECT id FROM messages WHERE user_openid = ? AND dedup_key = ?').get(m.user_openid, m.dedup_key);
    if (exists) return null;
  }
  const res = db.prepare(`INSERT INTO messages (user_openid, type, title, content, biz_type, biz_id, jump_url, dedup_key)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(m.user_openid, m.type || 'system', m.title, m.content || '', m.biz_type || '', m.biz_id || 0, m.jump_url || '', m.dedup_key || '');
  return res.lastInsertRowid;
}

/** 全员广播（openids 不传则发给所有已注册用户） */
function broadcastMessage(m, openids) {
  if (!m) return 0;
  if (!openids || openids.length === 0) {
    openids = db.prepare('SELECT DISTINCT user_openid FROM users').all().map(r => r.user_openid);
  }
  let count = 0;
  for (const oid of openids) {
    if (sendMessage({ ...m, user_openid: oid })) count += 1;
  }
  return count;
}

/** 消息列表（分页，每页 20 条） */
function listMessages(openid, page = 1) {
  const size = 20;
  const off = (Math.max(1, Number(page) || 1) - 1) * size;
  return db.prepare('SELECT * FROM messages WHERE user_openid = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(openid, size, off);
}

/** 未读数 */
function unreadMessageCount(openid) {
  return db.prepare('SELECT COUNT(*) c FROM messages WHERE user_openid = ? AND is_read = 0').get(openid).c;
}

/** 标记单条已读（校验归属） */
function markMessageRead(id, openid) {
  return db.prepare('UPDATE messages SET is_read = 1 WHERE id = ? AND user_openid = ?').run(id, openid).changes > 0;
}

/** 全部已读 */
function markAllMessagesRead(openid) {
  return db.prepare('UPDATE messages SET is_read = 1 WHERE user_openid = ? AND is_read = 0').run(openid).changes;
}

/** 未来 N 小时内开场的已发布场次（开课提醒用） */
function listSessionsStartingSoon(hours) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hh = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const startHH = hh(now);
  const end = new Date(now.getTime() + hours * 3600e3);
  const endHH = hh(end);
  return db.prepare(`
    SELECT s.id, s.date, s.start_time, s.end_time, s.course_id, c.name AS course_name, v.name AS venue_name
    FROM course_sessions s
    JOIN courses c ON c.id = s.course_id
    JOIN venues v ON v.id = s.venue_id
    WHERE s.status = 'published' AND s.date = ? AND s.start_time > ? AND s.start_time <= ?
  `).all(today, startHH, endHH);
}

/** 某场次已订学员 openid 列表 */
function listBookedUsersBySession(sessionId) {
  return db.prepare("SELECT DISTINCT user_openid FROM bookings WHERE session_id = ? AND status = 'booked'").all(sessionId).map(r => r.user_openid);
}

// ===== 订单（orders）=====

const ORDER_SELECT = `
  SELECT o.id, o.order_no, o.user_openid, o.session_id, o.booking_id, o.wait_id, o.order_type,
         o.amount_fen, o.status, o.pay_method, o.paid_at, o.refunded_at, o.cancel_reason, o.created_at,
         COALESCE(s.date, '') AS date, COALESCE(s.start_time, '') AS start_time, COALESCE(s.end_time, '') AS end_time,
         COALESCE(c.name, '储值充值') AS course_name, COALESCE(c.level, 0) AS level, COALESCE(c.duration_min, 0) AS duration_min,
         COALESCE(co.name, '') AS coach_name, COALESCE(v.name, '') AS venue_name
  FROM orders o
  LEFT JOIN course_sessions s ON s.id = o.session_id
  LEFT JOIN courses c ON c.id = s.course_id
  LEFT JOIN coaches co ON co.id = s.coach_id
  LEFT JOIN venues v ON v.id = s.venue_id`;

/** 生成订单号 */
function genOrderNo() {
  return 'ORD' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/**
 * 下单（创建待支付订单）
 * @param {object} p { user_openid, session_id, amount_fen, order_type }
 * @returns {{ok:true, order:object}|{ok:false, error:string}}
 */
function createOrder({ user_openid, session_id, amount_fen = 0, order_type = 'book', expire_mode = 'start' }) {
  const user = findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  // 储值充值：无场次依赖，校验套餐金额
  if (order_type === 'recharge') {
    const plan = RECHARGE_PLANS.find(p => p.amount === amount_fen);
    if (!plan) return { ok: false, error: '无效的充值套餐' };
    const orderNo = genOrderNo();
    db.prepare(`INSERT INTO orders (order_no, user_openid, session_id, order_type, amount_fen, status)
                VALUES (?, ?, NULL, ?, ?, 'pending')`)
      .run(orderNo, user_openid, order_type, amount_fen);
    const order = db.prepare(`${ORDER_SELECT} WHERE o.id = last_insert_rowid()`).get();
    return { ok: true, order };
  }

  const session = getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };

  // 已订过 → 拒绝下单
  const existing = db.prepare("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'").get(user_openid, session_id);
  if (existing) return { ok: false, error: '您已预订该课程，请勿重复下单' };

  if (order_type === 'book') {
    if (session.remaining <= 0) return { ok: false, error: '该课程已满员，请选择候补排位' };
  } else if (order_type === 'waitlist') {
    if (session.remaining > 0) return { ok: false, error: '该课程仍有余位，请直接预订' };
    const queued = db.prepare("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ? AND status = 'waiting'").get(user_openid, session_id);
    if (queued) return { ok: false, error: '您已在候补队列中' };
  } else {
    return { ok: false, error: '未知订单类型' };
  }

  // 候补订单记录自动取消节点（仅 waitlist 生效，其余忽略）
  const em = (order_type === 'waitlist' && ['start', '1h', '2h'].includes(expire_mode)) ? expire_mode : 'start';
  const orderNo = genOrderNo();
  db.prepare(`INSERT INTO orders (order_no, user_openid, session_id, order_type, amount_fen, status, expire_mode)
              VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
    .run(orderNo, user_openid, session_id, order_type, amount_fen, em);

  const order = db.prepare(`${ORDER_SELECT} WHERE o.id = last_insert_rowid()`).get();
  return { ok: true, order };
}

/**
 * 支付回写（模拟支付成功后调用；幂等：已支付订单重复调用直接返回成功）
 * 事务：订单 pending→paid + 生成 booking（扣余位）或 waitlist 记录
 * @param {object} p { openid, orderId, pay_method }
 * @returns {{ok:true, order:object, booking?:object, wait?:object}|{ok:false, error:string}}
 */
function payOrder({ openid, orderId, pay_method = 'balance' }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_openid = ?').get(orderId, openid);
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.status === 'paid') {
    return { ok: true, order: db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(orderId), already: true };
  }
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return { ok: false, error: '订单已失效，无法支付' };
  }

  // 会员价预校验：储值支付需余额充足（不足直接拒绝，避免事务回滚）
  if (order.order_type === 'book' && pay_method === 'balance'
      && MEMBER_CONFIG.memberPrice && MEMBER_CONFIG.memberPrice.enabled) {
    const lv = getMemberLevel(order.user_openid);
    // 会员价 = 原价 × 折扣率，向下取整到元（无角分）
    const payFen = lv ? Math.floor(order.amount_fen * lv.discount / 100) * 100 : order.amount_fen;
    const user = findUserByOpenid(order.user_openid);
    if ((user.balance_fen || 0) < payFen) {
      return { ok: false, error: '储值余额不足，请先充值或改用微信支付' };
    }
  }

  let booking = null, wait = null, recharge = null;
  db.exec('BEGIN');
  try {
    // 1. 订单标记已支付
    db.prepare("UPDATE orders SET status = 'paid', pay_method = ?, paid_at = datetime('now','localtime') WHERE id = ?")
      .run(pay_method, orderId);

    if (order.order_type === 'recharge') {
      // 储值充值：发放储值 + 写充值记录（每档首充送30% / 复充送10%，比例在配置）
      const { plan, bonus, isFirst } = calcRechargeBonus(order.user_openid, order.amount_fen);
      if (!plan) {
        db.exec('ROLLBACK');
        return { ok: false, error: '无效的充值套餐' };
      }
      recharge = applyRecharge({ user_openid: order.user_openid, order_id: orderId, amount_fen: order.amount_fen, bonus_fen: bonus });
      recharge = { ...recharge, isFirst, bonus, rate: isFirst ? plan.firstBonusRate : plan.repeatBonusRate };
    } else if (order.order_type === 'waitlist') {
      // 候补排位：写 waitlist（带自动取消节点，默认开课时）
      const waitNo = 'WL' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
      db.prepare(`INSERT INTO waitlist (wait_no, user_openid, session_id, amount_fen, status, expire_mode)
                  VALUES (?, ?, ?, ?, 'waiting', ?)`)
        .run(waitNo, order.user_openid, order.session_id, order.amount_fen, order.expire_mode || 'start');
      const waitId = db.prepare('SELECT id FROM waitlist WHERE wait_no = ?').get(waitNo).id;
      db.prepare('UPDATE orders SET wait_id = ? WHERE id = ?').run(waitId, orderId);
      wait = db.prepare(`
        SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.created_at,
               s.date, s.start_time, s.end_time, c.name AS course_name
        FROM waitlist w
        JOIN course_sessions s ON s.id = w.session_id
        JOIN courses c ON c.id = s.course_id
        WHERE w.id = ?
      `).get(waitId);
    } else {
      // 订课：复用订课逻辑（事务内调用，不再嵌套 BEGIN）
      // 会员价：仅储值支付享受等级折扣（member-config.js 配置）
      let payFen = order.amount_fen;
      if (pay_method === 'balance' && MEMBER_CONFIG.memberPrice && MEMBER_CONFIG.memberPrice.enabled) {
        const lv = getMemberLevel(order.user_openid);
        if (lv) {
          // 会员价 = 原价 × 折扣率，向下取整到元（无角分）
          payFen = Math.floor(order.amount_fen * lv.discount / 100) * 100;
          // 扣减余额 + 消费流水（余额不足时 addBalance 会让余额为负，事务回滚兜底）
          addBalance(order.user_openid, -payFen, '订课消费', order.order_no);
        }
      }
      const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
      const exists = db.prepare("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ?").get(order.user_openid, order.session_id);
      if (exists) {
        db.prepare("UPDATE bookings SET status = 'booked', pay_status = 'paid', cancel_reason = '', checkin_at = NULL WHERE id = ?").run(exists.id);
        db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(order.session_id);
        booking = db.prepare(`SELECT id, booking_no, amount_fen FROM bookings WHERE id = ?`).get(exists.id);
      } else {
        db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
                    VALUES (?, ?, ?, ?, 'booked', 'paid')`)
          .run(bookingNo, order.user_openid, order.session_id, payFen);
        booking = db.prepare('SELECT id, booking_no, amount_fen FROM bookings WHERE id = last_insert_rowid()').get();
        db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(order.session_id);
      }
      // 订单金额落实付（余额支付=会员折扣价；微信支付=原价），与 booking/退款保持严格一致
      db.prepare('UPDATE orders SET amount_fen = ?, booking_id = ? WHERE id = ?').run(payFen, booking.id, orderId);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // 订课成功 → 触发邀请奖励（好友完成首订，邀请人得储值；事务外执行）
  let reward = null;
  if (order.order_type === 'book' && !order.reward_triggered) {
    reward = rewardInviter(order.user_openid);
    if (reward) {
      db.prepare("UPDATE orders SET reward_triggered = 1 WHERE id = ?").run(orderId);
    }
  }

  const finalOrder = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(orderId);
  return { ok: true, order: finalOrder, booking, wait, recharge, reward };
}

/**
 * 查询某学员的全部订单
 */
function listOrdersByUser(openid, status) {
  const where = status ? 'WHERE o.user_openid = ? AND o.status = ?' : 'WHERE o.user_openid = ?';
  const params = status ? [openid, status] : [openid];
  return db.prepare(`${ORDER_SELECT} ${where} ORDER BY o.created_at DESC, o.id DESC`).all(...params);
}

/** 按订单号查订单（支付回调/对账用） */
function getOrderByNo(orderNo) {
  return db.prepare(`${ORDER_SELECT} WHERE o.order_no = ?`).get(orderNo) || null;
}

/**
 * 营收统计（管理后台营收页，基于真实订单）
 * @returns {object} { stats, monthly, sources }
 */
function getRevenueStats() {
  const fen = (n) => Number(n || 0);

  // 本月营收（已支付订单，按支付时间当月）
  const thisMonth = db.prepare(`
    SELECT COALESCE(SUM(amount_fen), 0) revenue, COUNT(*) cnt
    FROM orders WHERE status = 'paid'
      AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now', 'localtime')
  `).get();
  // 总营收 + 总订单数 + 退款总额
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_fen ELSE 0 END), 0) paid_revenue,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_fen ELSE 0 END), 0) refund_revenue,
      COUNT(*) total_orders
    FROM orders
  `).get();
  // 客单价（已支付订单）
  const paidCnt = db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'paid'").get().c;
  const avgPrice = paidCnt > 0 ? totals.paid_revenue / paidCnt : 0;

  // 近 8 个月月度营收
  const monthlyRows = db.prepare(`
    SELECT strftime('%Y-%m', paid_at) ym, COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL
    GROUP BY ym ORDER BY ym DESC LIMIT 8
  `).all();
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const monthly = monthlyRows.reverse().map(r => {
    const m = Number(r.ym.split('-')[1]);
    return { month: monthNames[m - 1], value: Number((r.revenue / 10000).toFixed(1)) };
  });

  // 收入来源（按订单类型 book/waitlist 分组占比）
  const srcRows = db.prepare(`
    SELECT order_type, COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid'
    GROUP BY order_type
  `).all();
  const srcTotal = srcRows.reduce((s, r) => s + fen(r.revenue), 0);
  const srcMeta = {
    book: { name: '单次课程', color: '#5B57EB' },
    waitlist: { name: '候补排位', color: '#B9FF66' }
  };
  const sources = srcRows.map(r => {
    const meta = srcMeta[r.order_type] || { name: r.order_type, color: '#F8D044' };
    const pct = srcTotal > 0 ? (fen(r.revenue) / srcTotal * 100).toFixed(1) : '0';
    return { name: meta.name, pct: pct + '%', color: meta.color };
  });

  // 上月营收（算环比）
  const lastMonth = db.prepare(`
    SELECT COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid'
      AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now', 'localtime', '-1 month')
  `).get().revenue;

  const thisRev = fen(thisMonth.revenue);
  const lastRev = fen(lastMonth);
  const trendPct = lastRev > 0 ? ((thisRev - lastRev) / lastRev * 100).toFixed(1) : 0;

  return {
    stats: [
      { label: '本月营收', value: '¥ ' + (thisRev / 100).toLocaleString(), trend: (trendPct >= 0 ? '↑ ' : '↓ ') + Math.abs(trendPct) + '% 较上月', dark: true },
      { label: '本月订单', value: String(thisMonth.cnt), trend: '已支付订单' },
      { label: '累计营收', value: '¥ ' + (fen(totals.paid_revenue) / 100).toLocaleString(), trend: '累计 ' + totals.total_orders + ' 笔' },
      { label: '退款总额', value: '¥ ' + (fen(totals.refund_revenue) / 100).toLocaleString(), trend: '客单价 ¥' + (avgPrice / 100).toFixed(1) }
    ],
    monthly,
    sources
  };
}

/**
 * 候补转正：把某场次最早的 waiting 排位者转正为正式订课（需在事务内调用）
 * @returns {object|null} 转正的排位记录（含用户/场次信息）
 */
function promoteFromWaitlist(sessionId) {
  const waiting = db.prepare("SELECT * FROM waitlist WHERE session_id = ? AND status = 'waiting' ORDER BY created_at, id LIMIT 1").get(sessionId);
  if (!waiting) return null;

  // 生成订课单号并创建 booking
  const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
              VALUES (?, ?, ?, ?, 'booked', 'paid')`)
    .run(bookingNo, waiting.user_openid, waiting.session_id, waiting.amount_fen);
  const bookingId = db.prepare('SELECT id FROM bookings WHERE booking_no = ?').get(bookingNo).id;
  // 扣减余位（退订时已 +1，这里 -1 抵消，保持满员状态）
  db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(sessionId);
  // 更新排位记录为已转正
  db.prepare("UPDATE waitlist SET status = 'promoted', promoted_at = datetime('now','localtime') WHERE id = ?").run(waiting.id);
  // 订单联动：原排位订单关联到新 booking（订单保持 paid，即排位费转为订课费）
  db.prepare("UPDATE orders SET booking_id = ?, wait_id = ?, order_type = 'book' WHERE wait_id = ? AND status = 'paid'")
    .run(bookingId, waiting.id, waiting.id);

  // 站内信：候补转正
  const sInfo = getSessionById(sessionId);
  sendMessage({
    user_openid: waiting.user_openid, type: 'waitlist', title: '候补转正',
    content: `你候补的「${sInfo ? sInfo.course_name : '课程'}」${sInfo ? sInfo.date + ' ' + sInfo.start_time : ''} 已有空位，已为你自动转正`,
    biz_type: 'course', biz_id: sessionId, jump_url: '/pages/student-my-courses/index',
    dedup_key: `promote:${waiting.id}`
  });

  return {
    id: waiting.id,
    wait_no: waiting.wait_no,
    user_openid: waiting.user_openid,
    session_id: waiting.session_id,
    amount_fen: waiting.amount_fen
  };
}

/**
 * 满员付费排位
 * @param {object} p { user_openid, session_id, amount_fen }
 * @returns {{ok:true, wait:{}}|{ok:false, error:string}}
 */
function joinWaitlist({ user_openid, session_id, amount_fen = 0, expire_mode = 'start' }) {
  const user = findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  const session = getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };

  // 已订过 → 无需排位
  const existing = db.prepare("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'").get(user_openid, session_id);
  if (existing) return { ok: false, error: '您已预订该课程' };

  // 已在排位 → 防重复
  const queued = db.prepare("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ? AND status = 'waiting'").get(user_openid, session_id);
  if (queued) return { ok: false, error: '您已在候补队列中' };

  // 有余位 → 直接订课更合适（前端应引导，这里兜底拒绝排位）
  if (session.remaining > 0) {
    return { ok: false, error: '该课程仍有余位，请直接预订' };
  }

  const waitNo = 'WL' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const em = ['start', '1h', '2h'].includes(expire_mode) ? expire_mode : 'start';
  db.prepare(`INSERT INTO waitlist (wait_no, user_openid, session_id, amount_fen, status, expire_mode)
              VALUES (?, ?, ?, ?, 'waiting', ?)`)
    .run(waitNo, user_openid, session_id, amount_fen, em);
  const wait = db.prepare(`
    SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.expire_mode, w.created_at,
           s.date, s.start_time, s.end_time, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE w.id = last_insert_rowid()
  `).get();
  return { ok: true, wait };
}

/**
 * 主动退出候补（退款）
 */
function cancelWaitlist(openid, waitId) {
  const wait = db.prepare('SELECT * FROM waitlist WHERE id = ? AND user_openid = ?').get(waitId, openid);
  if (!wait) return { ok: false, error: '排位记录不存在' };
  if (wait.status !== 'waiting') return { ok: false, error: '该排位已不在队列中' };
  db.exec('BEGIN');
  let refundOrder = null;   // 声明在外层，事务后退钱使用
  try {
    db.prepare("UPDATE waitlist SET status = 'cancelled', cancel_reason = '用户退出候补', refunded_at = datetime('now','localtime') WHERE id = ?").run(waitId);
    // 关联订单标记退款，并记录订单号用于退钱
    refundOrder = db.prepare("SELECT id FROM orders WHERE wait_id = ? AND status = 'paid'").get(waitId);
    if (refundOrder) {
      db.prepare(`UPDATE orders SET status = 'refunded', refunded_at = datetime('now','localtime'), cancel_reason = '用户退出候补'
                  WHERE id = ?`).run(refundOrder.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // 事务外退钱（余额支付退回余额）
  if (refundOrder) refundOrderMoney(refundOrder.id);
  return { ok: true };
}

/**
 * 查询某学员的全部候补记录
 */
function listWaitlistByUser(openid) {
  return db.prepare(`
    SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.expire_mode, w.created_at, w.promoted_at, w.refunded_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.id AS course_id, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE w.user_openid = ?
    ORDER BY w.created_at DESC
  `).all(openid);
}

/**
 * 过期退款任务：课程已开始仍未排到 → 自动退款（标记 refunded）
 * @returns {number} 退款的条数
 */
function refundExpiredWaitlist() {
  // 截止时间 = 开课时间 - 所选偏移（start=开课时 / 1h / 2h）
  const expired = db.prepare(`
    SELECT * FROM (
      SELECT w.id, w.user_openid, w.amount_fen, s.course_id, s.start_time, c.name AS course_name,
             (SELECT o.id FROM orders o WHERE o.wait_id = w.id AND o.status = 'paid' LIMIT 1) AS order_id,
             CASE w.expire_mode
               WHEN '1h' THEN datetime(s.date || ' ' || s.start_time, '-60 minutes')
               WHEN '2h' THEN datetime(s.date || ' ' || s.start_time, '-120 minutes')
               ELSE datetime(s.date || ' ' || s.start_time)
             END AS deadline
      FROM waitlist w
      JOIN course_sessions s ON s.id = w.session_id
      JOIN courses c ON c.id = s.course_id
      WHERE w.status = 'waiting'
    ) WHERE deadline < datetime('now', 'localtime')
  `).all();
  for (const row of expired) {
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE waitlist SET status = 'refunded', cancel_reason = '课程开始未排到，自动退款', refunded_at = datetime('now','localtime') WHERE id = ?").run(row.id);
      db.prepare(`UPDATE orders SET status = 'refunded', refunded_at = datetime('now','localtime'), cancel_reason = '课程开始未排到，自动退款'
                  WHERE wait_id = ? AND status = 'paid'`).run(row.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    // 事务外退钱（余额支付退回余额）
    if (row.order_id) refundOrderMoney(row.order_id);
    // 站内信：候补过期退款
    sendMessage({
      user_openid: row.user_openid, type: 'waitlist', title: '候补退款',
      content: `「${row.course_name}」${row.start_time} 开课前未排到空位，¥${(row.amount_fen / 100).toFixed(0)} 已自动退回`,
      biz_type: 'order', biz_id: row.id, jump_url: '/pages/student-orders/index',
      dedup_key: `refund_expire:${row.id}`
    });
  }
  return expired.length;
}

/**
 * 统计某学员订课数量
 */
function countBookingsByUser(openid) {
  return db.prepare("SELECT COUNT(*) c FROM bookings WHERE user_openid = ? AND status = 'booked'").get(openid).c;
}

/**
 * 统计已完成的锻炼次数 = 已订（booked）且场次已结束的总数
 * 场次已结束：日期早于今天，或日期=今天且结束时间早于当前时间
 */
function countFinishedWorkouts(openid) {
  const row = db.prepare(`
    SELECT COUNT(*) c
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE b.user_openid = ? AND b.status = 'booked'
      AND (s.date < date('now','localtime')
           OR (s.date = date('now','localtime') AND s.end_time < time('now','localtime')))
  `).get(openid);
  return row.c;
}

/**
 * 统计当前未开始的已订课（待上课）
 */
function countUpcomingBookings(openid) {
  const row = db.prepare(`
    SELECT COUNT(*) c
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE b.user_openid = ? AND b.status = 'booked'
      AND (s.date > date('now','localtime')
           OR (s.date = date('now','localtime') AND s.start_time >= time('now','localtime')))
  `).get(openid);
  return row.c;
}

module.exports = {
  db,
  findUserByOpenid,
  createUser,
  touchLogin,
  updateProfile,
  countUsers,
  listUsers,
  listInvitationDetails,
  inviteBoardStats,
  deleteUserById,
  deleteUserByOpenid,
  clearUsers,
  // 课程相关
  listCoaches,
  listVenues,
  listCourses,
  getRules,
  replaceRules,
  createCourse,
  updateCourse,
  deleteCourse,
  publishSessions,
  // 场次查询
  listSessionsByDate,
  listSessionsByDateForUser,
  listSessionsByCoach,
  listSessionsByRange,
  cancelSession,
  updateSessionCapacity,
  getSessionById,
  sendMessage,
  broadcastMessage,
  listMessages,
  unreadMessageCount,
  markMessageRead,
  markAllMessagesRead,
  listSessionsStartingSoon,
  listBookedUsersBySession,
  // 订课
  createBooking,
  listBookingsByUser,
  cancelBooking,
  countBookingsByUser,
  countFinishedWorkouts,
  countUpcomingBookings,
  // 签到
  getCheckinInfo,
  checkinBooking,
  listBookingsBySession,
  // 候补排位
  joinWaitlist,
  cancelWaitlist,
  listWaitlistByUser,
  refundExpiredWaitlist,
  // 订单
  createOrder,
  payOrder,
  listOrdersByUser,
  getOrderByNo,
  // 营收统计
  getRevenueStats,
  // 会员体系
  getMemberLevel,
  addBalance,
  refundOrderMoney,
  applyRecharge,
  hasRechargedPlan,
  calcRechargeBonus,
  RECHARGE_PLANS,
  listRecharges,
  bindInvitation,
  rewardInviter,
  getInviteStats,
  listUnreadBalanceLogs,
  markBalanceLogsRead,
  // 能量币
  addCoins,
  getCoinInfo,
  listCoinLogs,
  listShopItems,
  exchangeCoinItem,
  listMyExchanges,
  checkLevelUpReward,
  rewardInviterCoins,
  ENERGY_CONFIG
};
