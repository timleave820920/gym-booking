/**
 * 运营 Dashboard 聚合（DESIGN #D4，2026-08-18）
 *
 * 口径（用户两轮探讨拍板）：
 *  - 订课率 = 预约人数 ÷ 总席位（当日课 capacity 之和）
 *  - 签到率 = 已签到 ÷ 预约（当日课，签到是唯一到课证明 B1）
 *  - 留存   = 行为留存：注册后 N 天仍有订课/签到（无行为即流失）
 *  - 储值   = 两轨：当日充值（现金流）+ 余额负债（用户账上未消费）
 *  - 确认收入 = 已签到 OR 已过退订截止（课前 2 小时锁定）的 paid 订课订单
 *  - 未确认收入 = 可退订（未签到且未过截止）+ 候补 waiting 排位费
 *  - 沉睡   = 双档位：14 天无订课/签到 = 预警；30 天 = 重沉睡
 */
const time = require('../time.js');
const { driver } = require('../db-core');

const fen = (n) => Number(n || 0);
const pct = (a, b) => (b > 0 ? +(Number(a) / Number(b) * 100).toFixed(1) : 0);

/** 近 N 天连续日期数组（含今天，升序），用于趋势图 x 轴 */
function daysWindow(day, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(time.nowDateTimeStr(new Date(new Date(`${day}T00:00:00+08:00`).getTime() - i * 864e5)).slice(0, 10));
  }
  return out;
}

/**
 * 当日 + 趋势 + 4 组运营指标全量聚合
 * @param {string} dateStr 北京时区日期 YYYY-MM-DD（默认今天）
 */
async function getDashboard(dateStr) {
  const day = dateStr || time.todayStr();

  // ================= 当日核心 7 指标 =================
  const newUsers = (await driver.get('SELECT COUNT(*) c FROM users WHERE date(created_at) = ?', [day])).c;

  const capRow = await driver.get(
    "SELECT COALESCE(SUM(capacity),0) cap, COALESCE(SUM(booked_count),0) booked FROM course_sessions WHERE date = ? AND status IN ('published','full')", [day]);
  const bookingRate = pct(capRow.booked, capRow.cap);

  const ckRow = await driver.get(`
    SELECT COUNT(*) total, SUM(CASE WHEN b.checkin_at IS NOT NULL THEN 1 ELSE 0 END) done
    FROM bookings b JOIN course_sessions s ON s.id = b.session_id
    WHERE s.date = ? AND b.status = 'booked'`, [day]);
  const checkinRate = pct(ckRow.done, ckRow.total);

  // 行为留存三档（注册日 = N 天前 → 此后有订课/签到即活跃；无样本返回 null）
  const retention = {};
  for (const [key, n] of [['d7', 7], ['d14', 14], ['d30', 30]]) {
    const cohort = await driver.get(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN EXISTS(SELECT 1 FROM bookings b WHERE b.user_openid = u.openid AND b.status = 'booked' AND b.created_at > u.created_at)
              OR EXISTS(SELECT 1 FROM bookings b2 WHERE b2.user_openid = u.openid AND b2.checkin_at IS NOT NULL)
             THEN 1 ELSE 0 END) active
      FROM users u WHERE date(created_at) = ?`, [time.nowDateTimeStr(new Date(Date.now() - n * 864e5)).slice(0, 10)]);
    retention[key] = cohort.total > 0 ? pct(cohort.active, cohort.total) : null;
  }

  // 储值两轨：当日充值（现金流）+ 余额负债 + 累计充值→消费转化
  const rc = await driver.get('SELECT COUNT(*) cnt, COALESCE(SUM(amount_fen),0) s FROM member_recharges WHERE date(created_at) = ?', [day]);
  const bal = await driver.get('SELECT COALESCE(SUM(balance_fen),0) s FROM users');
  const balanceFlow = await driver.get(`SELECT
      COALESCE(SUM(CASE WHEN change_fen > 0 THEN change_fen ELSE 0 END),0) in_fen,
      COALESCE(SUM(CASE WHEN change_fen < 0 THEN -change_fen ELSE 0 END),0) out_fen
    FROM balance_logs`);

  // 确认/未确认收入（当日课 paid 订课 + 候补 waiting）：业务层判定（签到 or 过退订截止）
  const paidRows = await driver.all(`
    SELECT o.id, o.amount_fen, s.start_time,
           (SELECT b.checkin_at FROM bookings b WHERE b.id = o.booking_id) AS checkin_at
    FROM orders o JOIN course_sessions s ON s.id = o.session_id
    WHERE o.status = 'paid' AND o.order_type = 'book' AND s.date = ?`, [day]);
  let confirmedFen = 0, unconfirmedFen = 0;
  const now = Date.now();
  for (const r of paidRows) {
    const locked = r.checkin_at || now >= time.parseBeijing(`${day} ${r.start_time}`).getTime() - 2 * 3600 * 1000;
    if (locked) confirmedFen += fen(r.amount_fen);
    else unconfirmedFen += fen(r.amount_fen);
  }
  // 候补 waiting 排位费（全额未确认——随时可退）
  const waitFen = (await driver.get(`
    SELECT COALESCE(SUM(o.amount_fen),0) s FROM orders o JOIN waitlist w ON w.id = o.wait_id
    WHERE o.status = 'paid' AND w.status = 'waiting'`)).s;
  unconfirmedFen += fen(waitFen);
  const refundFen = (await driver.get(
    "SELECT COALESCE(SUM(amount_fen),0) s FROM orders WHERE status = 'refunded' AND date(refunded_at) = ?", [day])).s;

  // ================= 趋势（近 7/30 天）=================
  const trend = {};
  for (const [tk, n] of [['d7', 7], ['d30', 30]]) {
    const since = time.nowDateTimeStr(new Date(Date.now() - (n - 1) * 864e5)).slice(0, 10);
    const days = daysWindow(day, n);
    const uMap = new Map((await driver.all('SELECT date(created_at) d, COUNT(*) c FROM users WHERE date(created_at) >= ? GROUP BY d', [since])).map(r => [r.d, r.c]));
    const bMap = new Map((await driver.all(
      "SELECT s.date d, SUM(s.capacity) cap, SUM(s.booked_count) booked FROM course_sessions s WHERE s.date >= ? AND s.status IN ('published','full') GROUP BY s.date", [since])).map(r => [r.d, r]));
    const cMap = new Map((await driver.all(`
      SELECT s.date d, COUNT(*) total, SUM(CASE WHEN b.checkin_at IS NOT NULL THEN 1 ELSE 0 END) done
      FROM bookings b JOIN course_sessions s ON s.id = b.session_id
      WHERE s.date >= ? AND b.status = 'booked' GROUP BY s.date`, [since])).map(r => [r.d, r]));
    const rMap = new Map((await driver.all(
      "SELECT date(paid_at) d, COALESCE(SUM(amount_fen),0) s FROM orders WHERE status = 'paid' AND date(paid_at) >= ? GROUP BY d", [since])).map(r => [r.d, r.s]));
    trend[tk] = {
      days,
      newUsers: days.map(d => uMap.get(d) || 0),
      bookingRate: days.map(d => { const b = bMap.get(d); return b ? pct(b.booked, b.cap) : 0; }),
      checkinRate: days.map(d => { const c = cMap.get(d); return c ? pct(c.done, c.total) : 0; }),
      revenueFen: days.map(d => rMap.get(d) || 0)
    };
  }

  // ================= 4 组折叠卡 =================
  // A 收入线索
  const bkStatus = await driver.all(`SELECT b.status, COUNT(*) c FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id WHERE s.date = ? GROUP BY b.status`, [day]);
  const bkTotal = bkStatus.reduce((a, r) => a + r.c, 0);
  const cancelled = (bkStatus.find(r => r.status === 'cancelled') || {}).c || 0;
  const wlOutcome = await driver.get("SELECT COUNT(*) total, SUM(CASE WHEN status = 'promoted' THEN 1 ELSE 0 END) ok FROM waitlist WHERE status IN ('promoted','refunded')");
  const emptyLoss = (await driver.get(`
    SELECT COALESCE(SUM((s.capacity - s.booked_count) * c.price_fen),0) s FROM course_sessions s
    JOIN courses c ON c.id = s.course_id WHERE s.date = ? AND s.status IN ('published','full')`, [day])).s;

  // B 用户增长
  const funnel = await driver.get(`
    SELECT COUNT(*) registered,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM bookings b WHERE b.user_openid = u.openid AND b.status = 'booked') THEN 1 ELSE 0 END) first_booked,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM bookings b2 WHERE b2.user_openid = u.openid AND b2.checkin_at IS NOT NULL) THEN 1 ELSE 0 END) first_checkin
    FROM users u WHERE date(created_at) = ?`, [day]);
  const dormant = {};
  for (const [key, n] of [['d14', 14], ['d30', 30]]) {
    dormant[key] = (await driver.get(`
      SELECT COUNT(*) c FROM users u WHERE u.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.user_openid = u.openid AND b.status = 'booked' AND b.created_at >= ?)
      AND NOT EXISTS (SELECT 1 FROM bookings b2 WHERE b2.user_openid = u.openid AND b2.checkin_at >= ?)`,
      [time.nowDateTimeStr(new Date(Date.now() - n * 864e5)), time.nowDateTimeStr(new Date(Date.now() - n * 864e5)), time.nowDateTimeStr(new Date(Date.now() - n * 864e5))])).c;
  }
  const repurchase = await driver.get(`
    SELECT COUNT(DISTINCT user_openid) users FROM bookings WHERE session_id IN
      (SELECT id FROM course_sessions WHERE date = ?) AND status = 'booked'`, [day]);
  const repurchaseMany = await driver.get(`
    SELECT COUNT(*) c FROM (SELECT user_openid FROM bookings WHERE session_id IN
      (SELECT id FROM course_sessions WHERE date = ?) AND status = 'booked'
      GROUP BY user_openid HAVING COUNT(*) >= 2) t`, [day]);

  // C 课程热度（当日课预约率排行 + 时段 + 教练）
  const heatRows = await driver.all(`
    SELECT c.name, s.capacity, s.booked_count, ROUND(s.booked_count * 100.0 / s.capacity, 1) rate
    FROM course_sessions s JOIN courses c ON c.id = s.course_id
    WHERE s.date = ? AND s.status IN ('published','full') AND s.capacity > 0`, [day]);
  const heatSort = [...heatRows].sort((a, b) => b.rate - a.rate);
  const hourRows = await driver.all(`
    SELECT substr(s.start_time,1,2) h, COALESCE(SUM(s.booked_count),0) booked, COALESCE(SUM(s.capacity),0) cap
    FROM course_sessions s WHERE s.date = ? AND s.status IN ('published','full') GROUP BY h ORDER BY h`, [day]);
  const coachRows = await driver.all(`
    SELECT co.name, COALESCE(SUM(s.booked_count),0) booked, COALESCE(SUM(s.capacity),0) cap
    FROM course_sessions s JOIN coaches co ON co.id = s.coach_id
    WHERE s.date = ? AND s.status IN ('published','full') GROUP BY co.id ORDER BY booked DESC`, [day]);

  // D 系统健康
  const coins = await driver.get(`SELECT
      COALESCE(SUM(CASE WHEN change > 0 THEN change ELSE 0 END),0) issued,
      COALESCE(SUM(CASE WHEN change < 0 THEN -change ELSE 0 END),0) spent
    FROM coin_logs WHERE date(created_at) = ?`, [day]);
  const exchanges = (await driver.get('SELECT COUNT(*) c FROM coin_exchanges WHERE date(created_at) = ?', [day])).c;
  const msg = await driver.get(`SELECT COUNT(*) total, SUM(is_read) read FROM messages WHERE date(created_at) = ?`, [day]);
  const members = await driver.all('SELECT level_lv, COUNT(*) c FROM users GROUP BY level_lv ORDER BY level_lv');
  const passes = await driver.get(`SELECT
      (SELECT COUNT(*) FROM user_passes WHERE date(created_at) = ?) bought,
      (SELECT COUNT(*) FROM bookings WHERE pay_source = 'pass' AND date(created_at) = ? AND status = 'booked') used`,
    [day, day]);

  return {
    code: 200,
    date: day,
    core: {
      new_users: newUsers,
      booking_rate: bookingRate,
      checkin_rate: checkinRate,
      retention,
      recharge: { count: rc.cnt, fen: fen(rc.s), balance_fen: fen(bal.s), consume_ratio: pct(balanceFlow.out_fen, balanceFlow.in_fen) },
      confirmed_revenue_fen: confirmedFen,
      unconfirmed_revenue_fen: unconfirmedFen,
      refund_fen: fen(refundFen)
    },
    trend,
    groups: {
      revenue: {
        cancel_rate: pct(cancelled, bkTotal),
        waitlist_promote_rate: pct((wlOutcome.ok || 0), wlOutcome.total),
        empty_seat_loss_fen: fen(emptyLoss)
      },
      growth: {
        funnel: { registered: funnel.registered, first_booked: funnel.first_booked, first_checkin: funnel.first_checkin },
        dormant,
        repurchase_users: repurchase.users,
        repurchase_many: repurchaseMany.c
      },
      courses: {
        top: heatSort.slice(0, 5),
        cold: heatSort.slice(-5).reverse(),
        hours: hourRows.map(r => ({ ...r, rate: pct(r.booked, r.cap) })),
        coaches: coachRows.map(r => ({ ...r, rate: pct(r.booked, r.cap) }))
      },
      system: {
        coins: { issued: coins.issued, spent: coins.spent, exchanges },
        msg_total: msg.total,
        msg_read_rate: pct(msg.read, msg.total),
        members,
        passes: { bought: passes.bought, used: passes.used }
      }
    }
  };
}

module.exports = { getDashboard };
