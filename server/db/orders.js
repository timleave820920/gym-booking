/**
 * 订单域（orders）：下单、支付（含会员价/余额/候补/充值）、候补排位与退款、营收
 */
const { db, driver } = require('../db-core');
const { findUserByOpenid } = require('./users');
const { addCoins, checkLevelUpReward } = require('./coin');
const { getMemberLevel, addBalance, applyRecharge, refundOrderMoney, calcRechargeBonus, RECHARGE_PLANS } = require('./members');
const { getSessionById, syncSessionStatus, isCancelCutoffReached } = require('./courses');
const { rewardInviter } = require('./invite');
const { sendMessage } = require('./messages');
const { listPassPackages, getUserPass, getUserPassForDate, consumePass, refundPass, applyPassPurchase } = require('./passes');
const MEMBER_CONFIG = require('../member-config.js');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）
const ENERGY_CONFIG = require('../energy-config.js');

const ORDER_SELECT = `
  SELECT o.id, o.order_no, o.user_openid, o.session_id, o.booking_id, o.wait_id, o.order_type,
         o.amount_fen, o.status, o.pay_method, o.pay_source, o.paid_at, o.refunded_at, o.cancel_reason, o.created_at,
         COALESCE(s.date, '') AS date, COALESCE(s.start_time, '') AS start_time, COALESCE(s.end_time, '') AS end_time,
         COALESCE(c.name, '储值充值') AS course_name, COALESCE(c.level, 0) AS level, COALESCE(c.duration_min, 0) AS duration_min,
         COALESCE(co.name, '') AS coach_name, COALESCE(v.name, '') AS venue_name
  FROM orders o
  LEFT JOIN course_sessions s ON s.id = o.session_id
  LEFT JOIN courses c ON c.id = s.course_id
  LEFT JOIN coaches co ON co.id = s.coach_id
  LEFT JOIN venues v ON v.id = s.venue_id`;

function genOrderNo() {
  return 'ORD' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/**
 * 下单（创建待支付订单）
 * @param {object} p { user_openid, session_id, amount_fen, order_type }
 * @returns {{ok:true, order:object}|{ok:false, error:string}}
 */
async function createOrder({ user_openid, session_id, amount_fen = 0, order_type = 'book', expire_mode = 'start' }) {
  const user = await findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  // 次卡购买：无场次依赖，按套餐金额校验
  if (order_type === 'pass') {
    const pkg = (await listPassPackages()).find(p => p.price_fen === amount_fen);
    if (!pkg) return { ok: false, error: '无效的次卡套餐' };
    const orderNo = await genOrderNo();
    const r = await driver.run(`INSERT INTO orders (order_no, user_openid, session_id, order_type, amount_fen, status)
                VALUES (?, ?, NULL, ?, ?, 'pending')`, [orderNo, user_openid, order_type, amount_fen]);
    const order = await driver.get(`${ORDER_SELECT} WHERE o.id = ?`, [r.lastInsertRowid]);
    return { ok: true, order };
  }

  // 储值充值：无场次依赖，校验套餐金额
  if (order_type === 'recharge') {
    const plan = RECHARGE_PLANS.find(p => p.amount === amount_fen);
    if (!plan) return { ok: false, error: '无效的充值套餐' };
    const orderNo = await genOrderNo();
    const r = await driver.run(`INSERT INTO orders (order_no, user_openid, session_id, order_type, amount_fen, status)
                VALUES (?, ?, NULL, ?, ?, 'pending')`, [orderNo, user_openid, order_type, amount_fen]);
    const order = await driver.get(`${ORDER_SELECT} WHERE o.id = ?`, [r.lastInsertRowid]);
    return { ok: true, order };
  }

  const session = await getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  // published=可订；full=已满员（候补入口）——修复：syncSessionStatus 置 full 后候补被误拒（BUG-LEDGER #5）
  if (session.status !== 'published' && session.status !== 'full') return { ok: false, error: '课程已下线' };

  // 已订过 → 拒绝下单
  const existing = await driver.get("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'", [user_openid, session_id]);
  if (existing) return { ok: false, error: '您已预订该课程，请勿重复下单' };
  // 已有待支付订单 → 拒绝重复下单（防连点/并发：BUG-LEDGER #13 狂点狂扣费，bookings 查重在下单时无效，需查 pending 订单）
  // 加锁防重（BUG-LEDGER #57b）：pending 查重「读-判-插」非原子——压测 500 并发下单，多个请求同时
  // 通过检查 → 残留多笔 pending 单（每次 await 都是让出点，node:sqlite 同步底层也躲不过微任务交错）。
  // SQLite: BEGIN IMMEDIATE 立即持写锁串行化；MySQL: getExclusive 的 FOR UPDATE 行/间隙锁串行化。
  await driver.beginExclusive();
  try {
    const pendingOrder = await driver.getExclusive("SELECT id FROM orders WHERE user_openid = ? AND session_id = ? AND status = 'pending' AND order_type = ?", [user_openid, session_id, order_type]);
    if (pendingOrder) {
      await driver.exec('ROLLBACK');
      return { ok: false, error: '您已有待支付订单，请勿重复下单' };
    }

    if (order_type === 'book') {
      if (session.remaining <= 0) { await driver.exec('ROLLBACK'); return { ok: false, error: '该课程已满员，请选择候补排位' }; }
    } else if (order_type === 'waitlist') {
      if (session.remaining > 0) { await driver.exec('ROLLBACK'); return { ok: false, error: '该课程仍有余位，请直接预订' }; }
      const queued = await driver.get("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ? AND status = 'waiting'", [user_openid, session_id]);
      if (queued) { await driver.exec('ROLLBACK'); return { ok: false, error: '您已在候补队列中' }; }
    } else {
      await driver.exec('ROLLBACK');
      return { ok: false, error: '未知订单类型' };
    }

    // 候补订单记录自动取消节点（仅 waitlist 生效，其余忽略）
    const em = (order_type === 'waitlist' && ['start', '1h', '2h'].includes(expire_mode)) ? expire_mode : 'start';
    const orderNo = await genOrderNo();
    const r = await driver.run(`INSERT INTO orders (order_no, user_openid, session_id, order_type, amount_fen, status, expire_mode)
                VALUES (?, ?, ?, ?, ?, 'pending', ?)`, [orderNo, user_openid, session_id, order_type, amount_fen, em]);

    const order = await driver.get(`${ORDER_SELECT} WHERE o.id = ?`, [r.lastInsertRowid]);
    await driver.exec('COMMIT');
    return { ok: true, order };
  } catch (e) {
    await driver.exec('ROLLBACK');
    throw e;
  }
}

/**
 * 支付回写（本地支付确认/微信回调确认后调用；幂等：已支付订单重复调用直接返回成功）
 * 事务：订单 pending→paid + 生成 booking（扣余位）或 waitlist 记录
 * @param {object} p { openid, orderId, pay_method, wxpayVerified }
 *   wxpayVerified=true 仅限微信支付回调验签解密通过后传入（B2 钱闭环闸门，
 *   2026-08-18）：wxpay 订单没有回调确认一律拒绝，前端无法绕过微信直接标 paid。
 * @returns {{ok:true, order:object, booking?:object, wait?:object}|{ok:false, error:string}}
 */
/**
 * 生日月首订 8 折（DESIGN #D5-4）：生日月 == 当前月（北京时间）且当月无其他已支付书订单（仅首订享）
 * 与会员价同口径：原价 × 80%，向下取整到元；返回 null 表示不适用
 */
async function calcBirthdayDiscount(openid, orderId, amountFen) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.birthday) return null;
  const month = time.todayStr().slice(0, 7);   // YYYY-MM（北京时区）
  if (user.birthday.slice(0, 7) !== month) return null;
  // 当月已付书订单计数（排除自身：调用时当前订单可能已标 paid；substr 兼容 SQLite/MySQL）
  const cnt = await driver.get(
    "SELECT COUNT(*) AS cnt FROM orders WHERE user_openid = ? AND order_type = 'book' AND status = 'paid' AND id != ? AND substr(paid_at, 1, 7) = ?",
    [openid, orderId, month]);
  if (cnt.cnt > 0) return null;
  // 原价 × 0.8，向下取整到元（与会员价同口径：Math.floor(amount×rate/100)*100，无角分）
  return Math.floor(amountFen * 0.8 / 100) * 100;
}

async function payOrder({ openid, orderId, pay_method = 'balance', wxpayVerified = false }) {
  const order = await driver.get('SELECT * FROM orders WHERE id = ? AND user_openid = ?', [orderId, openid]);
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.status === 'paid') {
    return { ok: true, order: await driver.get(`${ORDER_SELECT} WHERE o.id = ?`, [orderId]), already: true };
  }
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return { ok: false, error: '订单已失效，无法支付' };
  }

  // 次卡（设计方案 R3/D3 + 2026-08-15 调整）：订课/候补且用户**显式选择次卡**（payMethod='pass'）才用次卡
  // ——留选择余地：用户可用储值/微信支付；后端仍校验卡有效性（覆盖上课日）
  // 2026-08-15: 按上课日期判断——卡必须覆盖上课日（卡今天过期不能预订明天及以后场次）
  let pass = null;
  if (order.order_type === 'book' || order.order_type === 'waitlist') {
    if (order.session_id) {
      const sRow = await driver.get('SELECT \`date\` FROM course_sessions WHERE id = ?', [order.session_id]);
      pass = sRow ? await getUserPassForDate(order.user_openid, sRow.date) : await getUserPass(order.user_openid);
    } else {
      pass = await getUserPass(order.user_openid);
    }
  }
  // 仅用户选次卡且卡可用 → 用次卡；选次卡但卡不可用 → 回退微信支付（杜绝白嫖：不扣次但金额 0）
  const canUsePass = (pay_method === 'pass') && !!pass;
  const effMethod = canUsePass ? 'pass' : (pay_method === 'pass' ? 'wxpay' : pay_method);

  // 钱闭环闸门（强制规矩 4）：微信支付必须由微信回调确认——最终实付方式为 wxpay
  // （含「选次卡但卡不可用」回退场景）而无 wxpayVerified 一律拒绝，杜绝「模拟微信支付成功」
  // （历史：前端调 payOrder('wxpay') 即标 paid）
  if (effMethod === 'wxpay' && !wxpayVerified) {
    return { ok: false, error: '微信支付须由微信回调确认' };
  }

  // 会员价预校验：储值支付需余额充足（不足直接拒绝，避免事务回滚）
  // 订课 + 候补都校验（修复 BUG-LEDGER #9：候补 balance 支付原不校验不扣款，退出却退款=刷钱漏洞）
  // 次卡购买也校验（BUG-LEDGER #49：pass 购买原不扣款=白嫖次卡）
  if ((order.order_type === 'book' || order.order_type === 'waitlist' || order.order_type === 'pass') && effMethod === 'balance'
      && MEMBER_CONFIG.memberPrice && MEMBER_CONFIG.memberPrice.enabled) {
    const lv = await getMemberLevel(order.user_openid);
    // 会员价 = 原价 × 折扣率，向下取整到元（无角分）；书订单叠加生日月首订 8 折（DESIGN #D5-4，与扣款同口径）
    let payFen = lv ? Math.floor(order.amount_fen * lv.discount / 100) * 100 : order.amount_fen;
    if (order.order_type === 'book') {
      const bday = await calcBirthdayDiscount(order.user_openid, orderId, order.amount_fen);
      if (bday !== null && bday < payFen) payFen = bday;
    }
    const user = await findUserByOpenid(order.user_openid);
    if ((user.balance_fen || 0) < payFen) {
      return { ok: false, error: '储值余额不足，请先充值或改用微信支付' };
    }
  }

  let booking = null, wait = null, recharge = null;
  let bdayApplied = false;   // 生日月首订 8 折已生效（DESIGN #D5-4，站内信提示用）
  await driver.exec('BEGIN');
  try {
    // 1. 订单标记已支付（pay_source 记录实付来源：pass / balance / wxpay）
    await driver.run("UPDATE orders SET status = 'paid', pay_method = ?, pay_source = ?, paid_at = ? WHERE id = ?", [effMethod, effMethod, time.nowDateTimeStr(), orderId]);

    if (order.order_type === 'pass') {
      // 次卡购买：先扣款（BUG-LEDGER #49：原不扣款=白嫖次卡）再单卡累加发卡（次数叠加 + 作废日期顺延）
      const pkg = (await listPassPackages()).find(p => p.price_fen === order.amount_fen);   // 套餐按原价匹配
      if (!pkg) {
        await driver.exec('ROLLBACK');
        return { ok: false, error: '无效的次卡套餐' };
      }
      if (effMethod === 'balance') {
        let payFen = order.amount_fen;
        if (MEMBER_CONFIG.memberPrice && MEMBER_CONFIG.memberPrice.enabled) {
          const lv = await getMemberLevel(order.user_openid);
          if (lv) payFen = Math.floor(order.amount_fen * lv.discount / 100) * 100;
        }
        await addBalance(order.user_openid, -payFen, '次卡购买', order.order_no);
        await driver.run('UPDATE orders SET amount_fen = ? WHERE id = ?', [payFen, orderId]);  // 订单金额落实付（退款严格一致）
      }
      const r = await applyPassPurchase({ openid: order.user_openid, orderId, packageId: pkg.id });
      if (!r.ok) {
        await driver.exec('ROLLBACK');
        return { ok: false, error: r.error };
      }
      recharge = { pass: r.pass, added: r.added, pkgName: pkg.name };
    } else if (order.order_type === 'recharge') {
      // 储值充值：发放储值 + 写充值记录（每档首充送30% / 复充送10%，比例在配置）
      const { plan, bonus, isFirst } = await calcRechargeBonus(order.user_openid, order.amount_fen);
      if (!plan) {
        await driver.exec('ROLLBACK');
        return { ok: false, error: '无效的充值套餐' };
      }
      recharge = await applyRecharge({ user_openid: order.user_openid, order_id: orderId, amount_fen: order.amount_fen, bonus_fen: bonus });
      recharge = { ...recharge, isFirst, bonus, rate: isFirst ? plan.firstBonusRate : plan.repeatBonusRate };
    } else if (order.order_type === 'waitlist') {
      // 候补排位：次卡扣次 / 余额按会员价扣款（产品决策 2026-08-13：候补余额支付享会员价）
      // 修复 BUG-LEDGER #9：原实现不扣款，退出候补却退款=刷钱漏洞
      let payFen = order.amount_fen;
      let passId = 0;
      if (effMethod === 'pass') {
        payFen = 0;
        passId = await consumePass(order.user_openid) || 0;
      } else if (pay_method === 'balance' && MEMBER_CONFIG.memberPrice && MEMBER_CONFIG.memberPrice.enabled) {
        const lv = await getMemberLevel(order.user_openid);
        if (lv) payFen = Math.floor(order.amount_fen * lv.discount / 100) * 100;
        await addBalance(order.user_openid, -payFen, '候补排位', order.order_no);
      }
      const waitNo = 'WL' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
      // 防唯一约束冲突（UNIQUE user_openid+session_id）：该用户该场次已有 waitlist 记录 → 复用更新
      // （场景：上次支付失败回滚后残留 cancelled 记录 / 并发双订单；修复 BUG：原直接 INSERT 撞约束 500 → 订单卡 pending）
      const existingWait = await driver.get("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ?", [order.user_openid, order.session_id]);
      let waitId;
      if (existingWait) {
        await driver.run("UPDATE waitlist SET wait_no = ?, amount_fen = ?, status = 'waiting', expire_mode = ?, pay_source = ?, pass_id = ? WHERE id = ?", [waitNo, payFen, order.expire_mode || 'start', effMethod, passId, existingWait.id]);
        waitId = existingWait.id;
      } else {
        await driver.run(`INSERT INTO waitlist (wait_no, user_openid, session_id, amount_fen, status, expire_mode, pay_source, pass_id)
                    VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?)`, [waitNo, order.user_openid, order.session_id, payFen, order.expire_mode || 'start', effMethod, passId]);
        waitId = (await driver.get('SELECT id FROM waitlist WHERE wait_no = ?', [waitNo])).id;
      }
      // 订单金额落实付（会员价），与退款保持严格一致
      await driver.run('UPDATE orders SET wait_id = ?, amount_fen = ?, pay_source = ? WHERE id = ?', [waitId, payFen, effMethod, orderId]);
      wait = await driver.get(`
        SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.created_at,
               s.date, s.start_time, s.end_time, c.name AS course_name
        FROM waitlist w
        JOIN course_sessions s ON s.id = w.session_id
        JOIN courses c ON c.id = s.course_id
        WHERE w.id = ?
      `, [waitId]);
    } else {
      // 订课：复用订课逻辑（事务内调用，不再嵌套 BEGIN）
      // 幂等防重（BUG-LEDGER #13）：该用户该场次已有 booked 记录 → 拒绝，防「多个订单同场次」连点重复扣款
      const dupBooked = await driver.get("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'", [order.user_openid, order.session_id]);
      if (dupBooked) {
        await driver.exec('ROLLBACK');
        return { ok: false, error: '您已预订该课程，请勿重复支付' };
      }
      // 会员价：仅储值支付享受等级折扣（member-config.js 配置）；次卡支付金额为 0
      let payFen = order.amount_fen;
      let passId = 0;
      if (effMethod === 'pass') {
        payFen = 0;
        passId = await consumePass(order.user_openid) || 0;
      } else if (pay_method === 'balance' && MEMBER_CONFIG.memberPrice && MEMBER_CONFIG.memberPrice.enabled) {
        const lv = await getMemberLevel(order.user_openid);
        if (lv) {
          // 会员价 = 原价 × 折扣率，向下取整到元（无角分）
          payFen = Math.floor(order.amount_fen * lv.discount / 100) * 100;
          // 生日月首订 8 折（DESIGN #D5-4）：与会员价取更优（8 折 < 98 折即生日月享 8 折）
          const bday = await calcBirthdayDiscount(order.user_openid, orderId, order.amount_fen);
          if (bday !== null) {
            payFen = Math.min(payFen, bday);
            bdayApplied = true;
          }
          // 扣减余额 + 消费流水（余额不足时 addBalance 会让余额为负，事务回滚兜底）
          await addBalance(order.user_openid, -payFen, '订课消费', order.order_no);
        }
      }
      const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
      const exists = await driver.get("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ?", [order.user_openid, order.session_id]);
      // 原子容量闸门（BUG-LEDGER #57 超卖）：下单时 remaining 是宽松快照检查，支付才真正占位，
      // 并发下单-支付下 256 人可同时通过下单检查 → 支付全部成功 = 超卖。占位必须原子比较-更新：
      // booked_count < capacity 才 +1（MySQL 行锁/SQLite 单写锁保证同一时刻仅一个事务能通过），
      // changes===0 = 已满员 → 回滚（订单 paid 标记/余额扣减/booking 插入全部撤销）
      const up = await driver.run('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ? AND booked_count < capacity', [order.session_id]);
      if (up.changes === 0) {
        await driver.exec('ROLLBACK');
        // 满员支付被拒：订单作废而非停留 pending——否则用户被「已有待支付订单」拦截，
        // 无法转候补也无法重下单（压测 A 场景暴露：40 笔 pending 死锁）
        await driver.run("UPDATE orders SET status = 'cancelled', cancel_reason = '该课程已满员，支付被拒' WHERE id = ? AND status = 'pending'", [orderId]);
        return { ok: false, error: '该课程已满员，请选择候补排位' };
      }
      if (exists) {
        // 复用 booking 时同步金额（BUG：原不更新 amount_fen，次卡支付残留旧值 80 → 站内信/展示金额错）
        await driver.run("UPDATE bookings SET status = 'booked', pay_status = 'paid', cancel_reason = '', checkin_at = NULL, amount_fen = ?, pay_source = ?, pass_id = ? WHERE id = ?", [payFen, effMethod, passId, exists.id]);
        await syncSessionStatus(order.session_id);
        booking = await driver.get(`SELECT id, booking_no, amount_fen FROM bookings WHERE id = ?`, [exists.id]);
      } else {
        const r = await driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status, pay_source, pass_id)
                    VALUES (?, ?, ?, ?, 'booked', 'paid', ?, ?)`, [bookingNo, order.user_openid, order.session_id, payFen, effMethod, passId]);
        booking = await driver.get('SELECT id, booking_no, amount_fen FROM bookings WHERE id = ?', [r.lastInsertRowid]);
        await syncSessionStatus(order.session_id);
      }
      // 订单金额落实付（次卡=0/余额=会员价/微信=原价），与 booking/退款保持严格一致
      await driver.run('UPDATE orders SET amount_fen = ?, booking_id = ?, pay_source = ? WHERE id = ?', [payFen, booking.id, effMethod, orderId]);
    }
    await driver.exec('COMMIT');
  } catch (e) {
    await driver.exec('ROLLBACK');
    throw e;
  }

  // 订课成功 → 触发邀请奖励（好友完成首订，邀请人得储值；事务外执行）
  let reward = null;
  if (order.order_type === 'book' && !order.reward_triggered) {
    reward = await rewardInviter(order.user_openid);
    if (reward) {
      await driver.run("UPDATE orders SET reward_triggered = 1 WHERE id = ?", [orderId]);
    }
  }

  // 站内信：支付成功确认（事务外，钱已落账才发；BUG-LEDGER #12：原 payOrder 直接内联建 booking，绕过 createBooking 的埋点）
  if (order.order_type === 'book' && booking) {
    const sInfo = await getSessionById(order.session_id);
    await sendMessage({
      user_openid: order.user_openid, type: 'booking', title: '订课成功',
      content: `已成功预约「${sInfo ? sInfo.course_name : '课程'}」${sInfo ? sInfo.date + ' ' + sInfo.start_time : ''}，实付 ¥${(booking.amount_fen / 100).toFixed(0)}${bdayApplied ? '（生日月首订 8 折 🎂）' : ''}`,
      biz_type: 'course', biz_id: order.session_id, jump_url: '/pages/student-my-courses/index',
      dedup_key: `book_paid:${orderId}`
    });
  } else if (order.order_type === 'recharge' && recharge) {
    await sendMessage({
      user_openid: order.user_openid, type: 'order', title: '充值到账',
      content: `充值 ¥${(order.amount_fen / 100).toFixed(0)} 已到账${recharge.bonus ? `，赠送 ¥${(recharge.bonus / 100).toFixed(0)}` : ''}，当前余额可前往「我的」查看`,
      biz_type: 'order', biz_id: orderId, jump_url: '/pages/member-level/index',
      dedup_key: `recharge_paid:${orderId}`
    });
  }

  const finalOrder = await driver.get(`${ORDER_SELECT} WHERE o.id = ?`, [orderId]);
  return { ok: true, order: finalOrder, booking, wait, recharge, reward };
}

/**
 * 查询某学员的全部订单
 */
async function listOrdersByUser(openid, status) {
  const where = status ? 'WHERE o.user_openid = ? AND o.status = ?' : 'WHERE o.user_openid = ?';
  const params = status ? [openid, status] : [openid];
  return await driver.all(`${ORDER_SELECT} ${where} ORDER BY o.created_at DESC, o.id DESC`, [...params]);
}

/** 按订单号查订单（支付回调/对账用） */
async function getOrderByNo(orderNo) {
  return await driver.get(`${ORDER_SELECT} WHERE o.order_no = ?`, [orderNo]) || null;
}

/**
 * 营收统计（管理后台营收页，基于真实订单）
 * @returns {object} { stats, monthly, sources }
 */
async function getRevenueStats() {
  const fen = (n) => Number(n || 0);

  // 本月营收（已支付订单，按支付时间当月）
  const thisMonth = await driver.get(`
    SELECT COALESCE(SUM(amount_fen), 0) revenue, COUNT(*) cnt
    FROM orders WHERE status = 'paid'
      AND substr(paid_at, 1, 7) = ?
  `, [time.todayStr().slice(0, 7)]);
  // 总营收 + 总订单数 + 退款总额
  const totals = await driver.get(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_fen ELSE 0 END), 0) paid_revenue,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_fen ELSE 0 END), 0) refund_revenue,
      COUNT(*) total_orders
    FROM orders
  `);
  // 客单价（已支付订单）
  const paidCnt = (await driver.get("SELECT COUNT(*) c FROM orders WHERE status = 'paid'")).c;
  const avgPrice = paidCnt > 0 ? totals.paid_revenue / paidCnt : 0;

  // 近 8 个月月度营收
  const monthlyRows = await driver.all(`
    SELECT substr(paid_at, 1, 7) ym, COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL
    GROUP BY ym ORDER BY ym DESC LIMIT 8
  `);
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const monthly = monthlyRows.reverse().map(r => {
    const m = Number(r.ym.split('-')[1]);
    return { month: monthNames[m - 1], value: Number((r.revenue / 10000).toFixed(1)) };
  });

  // 收入来源（按订单类型 book/waitlist 分组占比）
  const srcRows = await driver.all(`
    SELECT order_type, COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid'
    GROUP BY order_type
  `);
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
  const lastMonth = (await driver.get(`
    SELECT COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid'
      AND substr(paid_at, 1, 7) = ?
  `, [time.prevMonthStr()])).revenue;

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
async function promoteFromWaitlist(sessionId) {
  const waiting = await driver.get("SELECT * FROM waitlist WHERE session_id = ? AND status = 'waiting' ORDER BY created_at, id LIMIT 1", [sessionId]);
  if (!waiting) return null;

  // 生成订课单号并创建 booking（沿用排位支付来源：次卡/余额/微信，不重复扣次）
  const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
  await driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status, pay_source, pass_id)
              VALUES (?, ?, ?, ?, 'booked', 'paid', ?, ?)`, [bookingNo, waiting.user_openid, waiting.session_id, waiting.amount_fen, waiting.pay_source || 'wxpay', waiting.pass_id || 0]);
  const bookingId = (await driver.get('SELECT id FROM bookings WHERE booking_no = ?', [bookingNo])).id;
  // 扣减余位（退订时已 +1，这里 -1 抵消，保持满员状态）
  await driver.run('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?', [sessionId]);
        await syncSessionStatus(sessionId);
  // 更新排位记录为已转正
  await driver.run("UPDATE waitlist SET status = 'promoted', promoted_at = ? WHERE id = ?", [time.nowDateTimeStr(), waiting.id]);
  // 订单联动：原排位订单关联到新 booking（订单保持 paid，即排位费转为订课费）
  await driver.run("UPDATE orders SET booking_id = ?, wait_id = ?, order_type = 'book' WHERE wait_id = ? AND status = 'paid'", [bookingId, waiting.id, waiting.id]);

  // 站内信：候补转正
  const sInfo = await getSessionById(sessionId);
  await sendMessage({
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
async function joinWaitlist({ user_openid, session_id, amount_fen = 0, expire_mode = 'start' }) {
  const user = await findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  const session = await getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  // published=可订；full=已满员（候补入口）——修复：syncSessionStatus 置 full 后候补被误拒（BUG-LEDGER #5）
  if (session.status !== 'published' && session.status !== 'full') return { ok: false, error: '课程已下线' };

  // 已订过 → 无需排位
  const existing = await driver.get("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'", [user_openid, session_id]);
  if (existing) return { ok: false, error: '您已预订该课程' };

  // 已在排位 → 防重复
  const queued = await driver.get("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ? AND status = 'waiting'", [user_openid, session_id]);
  if (queued) return { ok: false, error: '您已在候补队列中' };

  // 有余位 → 直接订课更合适（前端应引导，这里兜底拒绝排位）
  if (session.remaining > 0) {
    return { ok: false, error: '该课程仍有余位，请直接预订' };
  }

  const waitNo = 'WL' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const em = ['start', '1h', '2h'].includes(expire_mode) ? expire_mode : 'start';
  const r = await driver.run(`INSERT INTO waitlist (wait_no, user_openid, session_id, amount_fen, status, expire_mode)
              VALUES (?, ?, ?, ?, 'waiting', ?)`, [waitNo, user_openid, session_id, amount_fen, em]);
  const wait = await driver.get(`
    SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.expire_mode, w.created_at,
           s.date, s.start_time, s.end_time, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE w.id = ?
  `, [r.lastInsertRowid]);
  return { ok: true, wait };
}

/**
 * 主动退出候补（退款）
 */
async function cancelWaitlist(openid, waitId) {
  const wait = await driver.get('SELECT * FROM waitlist WHERE id = ? AND user_openid = ?', [waitId, openid]);
  if (!wait) return { ok: false, error: '排位记录不存在' };
  if (wait.status !== 'waiting') return { ok: false, error: '该排位已不在队列中' };
  // B3（2026-08-18）：退出候补与退订同规则——开课前 2 小时内不可退（用户拍板）
  if (await isCancelCutoffReached(wait.session_id)) {
    return { ok: false, error: '距离开课不足 2 小时，无法退出候补' };
  }
  await driver.exec('BEGIN');
  let refundOrder = null;   // 声明在外层，事务后退钱使用
  try {
    await driver.run("UPDATE waitlist SET status = 'cancelled', cancel_reason = '用户退出候补', refunded_at = ? WHERE id = ?", [time.nowDateTimeStr(), waitId]);
    // 关联订单标记退款，并记录订单号用于退钱
    refundOrder = await driver.get("SELECT id FROM orders WHERE wait_id = ? AND status = 'paid'", [waitId]);
    if (refundOrder) {
      await driver.run(`UPDATE orders SET status = 'refunded', refunded_at = ?, cancel_reason = '用户退出候补'
                  WHERE id = ?`, [time.nowDateTimeStr(), refundOrder.id]);
    }
    await driver.exec('COMMIT');
  } catch (e) {
    await driver.exec('ROLLBACK');
    throw e;
  }
  // 事务外对称退：次卡→退次（卡已过期则作废清理）；余额→退余额；微信→原路（模拟）
  if (refundOrder) {
    const o = await driver.get('SELECT pay_source FROM orders WHERE id = ?', [refundOrder.id]);
    if (o && o.pay_source === 'pass') {
      const r = await refundPass(wait.pass_id);
      if (r === 'refunded') {
        await sendMessage({
          user_openid: openid, type: 'pass', title: '次卡已退回',
          content: '退出候补成功，已退回 1 次次卡次数',
          biz_type: 'pass', biz_id: wait.pass_id || 0, jump_url: '/pages/member-level/index',
          dedup_key: `pass_refund:${waitId}`
        });
      }
      // 'expired'：卡已过期 → 次数作废清理（不提示退回）
    } else {
      await refundOrderMoney(refundOrder.id);
    }
  }
  return { ok: true };
}

/**
 * 查询某学员的全部候补记录
 */
async function listWaitlistByUser(openid) {
  return await driver.all(`
    SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.expire_mode, w.created_at, w.promoted_at, w.refunded_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.id AS course_id, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name,
           -- 排队总人数 + 我的位置（DESIGN #D3：您前面还有 N 人）；个人候补量小，相关子查询可接受
           (SELECT COUNT(*) FROM waitlist w2 WHERE w2.session_id = w.session_id AND w2.status = 'waiting') AS waitlist_count,
           (SELECT COUNT(*) FROM waitlist w2 WHERE w2.session_id = w.session_id AND w2.status = 'waiting'
             AND (w2.created_at < w.created_at OR (w2.created_at = w.created_at AND w2.id < w.id))) AS my_wait_position
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE w.user_openid = ?
    ORDER BY w.created_at DESC
  `, [openid]);
}

/**
 * 过期退款任务：课程已开始仍未排到 → 自动退款（标记 refunded）
 * @returns {number} 退款的条数
 */
async function refundExpiredWaitlist() {
  // 截止时间 = 开课时间 - 所选偏移（start=开课时 / 1h / 2h）
  // deadline 业务层计算（DESIGN #D2 S2）：去掉 SQL 内 datetime(±min)/|| 拼接（MySQL 不兼容），
  // 候补列表量小，逐行过滤性能可接受；time.addMinutesStr 北京时间语义无时区依赖
  const now = time.nowDateTimeStr();
  const expired = (await driver.all(`
    SELECT w.id, w.user_openid, w.amount_fen, w.pass_id, s.date, s.start_time, s.course_id, c.name AS course_name,
           (SELECT o.id FROM orders o WHERE o.wait_id = w.id AND o.status = 'paid' LIMIT 1) AS order_id,
           w.expire_mode
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    WHERE w.status = 'waiting'
  `)).filter(r => {
    const offsetMin = r.expire_mode === '1h' ? -60 : r.expire_mode === '2h' ? -120 : 0;
    return time.addMinutesStr(`${r.date} ${r.start_time}`, offsetMin) < now;
  });
  for (const row of expired) {
    await driver.exec('BEGIN');
    try {
      await driver.run("UPDATE waitlist SET status = 'refunded', cancel_reason = '课程开始未排到，自动退款', refunded_at = ? WHERE id = ?", [time.nowDateTimeStr(), row.id]);
      await driver.run(`UPDATE orders SET status = 'refunded', refunded_at = ?, cancel_reason = '课程开始未排到，自动退款'
                  WHERE wait_id = ? AND status = 'paid'`, [time.nowDateTimeStr(), row.id]);
      await driver.exec('COMMIT');
    } catch (e) {
      await driver.exec('ROLLBACK');
      throw e;
    }
    // 事务外对称退：次卡→退次（卡已过期作废）；余额→退余额
    if (row.order_id) {
      const o = await driver.get('SELECT pay_source FROM orders WHERE id = ?', [row.order_id]);
      if (o && o.pay_source === 'pass') {
        const r = await refundPass(row.pass_id);
        if (r === 'refunded') {
          await sendMessage({
            user_openid: row.user_openid, type: 'pass', title: '次卡已退回',
            content: '候补过期未转正，已退回 1 次次卡次数',
            biz_type: 'pass', biz_id: row.pass_id || 0, jump_url: '/pages/member-level/index',
            dedup_key: `pass_refund_expire:${row.id}`
          });
        }
      } else {
        await refundOrderMoney(row.order_id);
      }
    }
    // 站内信：候补过期退款
    await sendMessage({
      user_openid: row.user_openid, type: 'waitlist', title: '候补退款',
      content: `「${row.course_name}」${row.start_time} 开课前未排到空位，已自动退回`,
      biz_type: 'order', biz_id: row.id, jump_url: '/pages/student-orders/index',
      dedup_key: `refund_expire:${row.id}`
    });
  }
  return expired.length;
}

/**
 * 统计某学员订课数量
 */
// ===== 导出 =====
module.exports = { genOrderNo, createOrder, payOrder, calcBirthdayDiscount, listOrdersByUser, getOrderByNo, getRevenueStats, promoteFromWaitlist, joinWaitlist, cancelWaitlist, listWaitlistByUser, refundExpiredWaitlist };
