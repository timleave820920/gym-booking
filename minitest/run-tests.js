/**
 * 综合训练馆订课系统 · 自动化测试脚本
 * 用法：node minitest/run-tests.js [BASE_URL]
 * 默认 BASE_URL: http://127.0.0.1:3000
 * 自动创建/清理测试数据（uid_test_* 前缀）
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3000';

// ===== 轻量 HTTP 客户端 =====
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = BASE + path;
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? require('node:https') : require('node:http');
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    };
    const r = mod.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, data: json, raw: data });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ===== 断言工具 =====
let passed = 0, failed = 0;
const failures = [];
const started = Date.now();

function check(id, name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${id} ${name}`);
  } else {
    failed++;
    failures.push({ id, name, detail });
    console.log(`  ❌ ${id} ${name}  → ${detail}`);
  }
}

function ok(res, code) {
  return res.data && res.data.code === code;
}

// ===== 测试数据 =====
const T = {
  user1: { openid: 'uid_test_tianli', nickname: '测试学员田立' },
  user2: { openid: 'uid_test_student2', nickname: '测试学员二号' },
  coach: { openid: 'uid_test_coach', nickname: '测试教练', role: 'coach' },
  holder: { openid: 'uid_test_holder', nickname: '占位学员' }
};
const today = new Date();
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const tomorrow = new Date(today.getTime() + 86400000);
const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

// 运行时状态
const ctx = {
  bookingId: null, orderId: null, waitId: null, sessionId: null,
  fullSessionId: null, checkedBookingId: null, paidOrderId: null,
  tomorrowSessionId: null, promotedWaitId: null
};

async function main() {
  console.log(`\n========== 综合训练馆订课系统 自动化测试 ==========`);
  console.log(`目标: ${BASE} ｜ 开始: ${new Date().toLocaleString()}\n`);

  // 预清理上次残留的测试数据（保证用例可重复执行）
  try {
    const db = require('../server/db.js');
    db.db.prepare("DELETE FROM orders WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM course_sessions WHERE source='test_suite'").run();
    db.db.prepare("DELETE FROM coin_logs WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM coin_exchanges WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM member_recharges WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM invitations WHERE inviter LIKE 'uid_test_%' OR invitee LIKE 'uid_test_%'").run();
    ['uid_test_tianli','uid_test_student2','uid_test_coach','uid_test_holder'].forEach(o => {
      const u = db.findUserByOpenid(o);
      if (u) db.deleteUserById(u.id);
    });
    console.log('  [预清理] 上次残留测试数据已清除');
  } catch (e) {
    console.log('  [预清理] 跳过: ' + e.message);
  }

  // ===== 0. 健康检查 =====
  console.log('── 1. 系统健康 ──');
  let r = await req('GET', '/api/health');
  check('SYS-01', '健康检查', ok(r, 200), `status=${r.status}`);
  r = await req('GET', '/api/meta');
  check('SYS-02', '下拉元数据', ok(r, 200), `status=${r.status}`);

  // ===== 1. 账号登录 =====
  console.log('\n── 2. 账号与登录 ──');
  r = await req('POST', '/api/auth/login', T.user1);
  check('AUTH-01', '注册新用户', (r.status === 201 || r.status === 200) && r.data.user && r.data.user.openid === T.user1.openid, `status=${r.status}`);
  r = await req('POST', '/api/auth/login', T.user1);
  check('AUTH-02', '重复登录幂等', r.status === 200, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/auth/login', {});
  check('AUTH-03', '缺 openid', r.status === 400 && (r.data.message || '').includes('openid'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/auth/profile', { openid: T.user1.openid, nickname: '田立新版', avatar: 'x' });
  check('AUTH-04', '更新资料', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/users');
  check('AUTH-05', '用户列表', ok(r, 200) && Array.isArray(r.data.users), `count=${r.data && r.data.users && r.data.users.length}`);
  r = await req('GET', '/api/users/stats');
  check('AUTH-06', '用户统计', ok(r, 200) && r.data.totalUsers >= 0, `total=${r.data && r.data.totalUsers}`);
  // 创建其余测试用户
  await req('POST', '/api/auth/login', T.user2);
  await req('POST', '/api/auth/login', T.coach);
  await req('POST', '/api/auth/login', T.holder);

  // ===== 2. 课程与场次 =====
  console.log('\n── 3. 课程与场次 ──');
  r = await req('GET', '/api/courses');
  check('CRS-01', '课程列表', ok(r, 200) && r.data.courses.length > 0, `count=${r.data && r.data.courses && r.data.courses.length}`);
  r = await req('POST', '/api/courses', {});
  check('CRS-02', '创建课程缺参', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/sessions?date=' + todayStr);
  check('SES-01', '按日期查场次', ok(r, 200) && Array.isArray(r.data.sessions), `count=${r.data && r.data.sessions && r.data.sessions.length}`);
  r = await req('GET', '/api/sessions');
  check('SES-02', '缺日期参数', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/sessions/1');
  check('SES-03', '场次详情', ok(r, 200) && r.data.session && r.data.session.course_name, `course=${r.data && r.data.session && r.data.session.course_name}`);
  r = await req('GET', '/api/sessions/9999');
  check('SES-05', '场次不存在', r.status === 404, `status=${r.status}`);

  // 造一个今天的测试场次（有余位）
  const mkSession = (date, start, end, cap, booked) => new Promise((resolve) => {
    const db = require('../server/db.js');
    db.db.prepare(`INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source)
                   VALUES (1, 1, 1, ?, ?, ?, ?, ?, 'published', 'test_suite')`).run(date, start, end, cap, booked);
    const s = db.db.prepare("SELECT id FROM course_sessions WHERE source='test_suite' ORDER BY id DESC LIMIT 1").get();
    resolve(s.id);
  });
  ctx.sessionId = await mkSession(todayStr, '21:00', '22:00', 10, 0);
  ctx.fullSessionId = await mkSession(todayStr, '22:00', '23:00', 1, 1);   // 满员（未来时段避免过期退款干扰）
  ctx.tomorrowSessionId = await mkSession(tomorrowStr, '09:00', '10:00', 5, 0);
  console.log(`  [准备] 测试场次: 普通#${ctx.sessionId} 满员#${ctx.fullSessionId} 明日#${ctx.tomorrowSessionId}`);

  // ===== 3. 订课链路（订单化）=====
  console.log('\n── 4. 订课链路 ──');
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  check('ORD-01', '下单(订课)', r.status === 201 && r.data.order.status === 'pending', `msg=${r.data && r.data.message}`);
  ctx.orderId = r.data.order.id;
  r = await req('POST', `/api/orders/${ctx.orderId}/pay`, { openid: T.user1.openid, payMethod: 'wxpay' });
  check('ORD-02', '支付回写', ok(r, 200) && r.data.order.status === 'paid' && r.data.booking, `status=${r.data && r.data.order && r.data.order.status}`);
  ctx.bookingId = r.data.booking.id;
  ctx.paidOrderId = ctx.orderId;
  r = await req('POST', `/api/orders/${ctx.orderId}/pay`, { openid: T.user1.openid });
  check('ORD-03', '重复支付幂等', ok(r, 200) && r.data.already === true, `already=${r.data && r.data.already}`);
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  check('ORD-04', '重复下单拒绝', r.status === 400 && (r.data.message || '').includes('已预订'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'book' });
  check('ORD-05', '满员下单拒绝', r.status === 400 && (r.data.message || '').includes('满员'), `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/orders?openid=${T.user1.openid}`);
  check('ORD-06', '我的订单列表', ok(r, 200) && r.data.orders.length >= 1, `count=${r.data && r.data.orders && r.data.orders.length}`);
  r = await req('GET', `/api/sessions/${ctx.sessionId}?openid=${T.user1.openid}`);
  check('SES-04', '带openid标记已订', r.data.session.booked_by_me === true, `booked_by_me=${r.data && r.data.session && r.data.session.booked_by_me}`);
  // 越权退订
  r = await req('DELETE', `/api/bookings/${ctx.bookingId}?openid=${T.user2.openid}`);
  check('SEC-02', '越权退订拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  // 无效场次下单
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: 99999, amountFen: 6800 });
  check('SEC-03', '无效场次下单', r.status === 400 && (r.data.message || '').includes('不存在'), `msg=${r.data && r.data.message}`);
  // 未登录下单
  r = await req('POST', '/api/orders', { openid: 'uid_test_nobody', sessionId: ctx.sessionId, amountFen: 6800 });
  check('SEC-01', '未登录下单', r.status === 400 && (r.data.message || '').includes('用户不存在'), `msg=${r.data && r.data.message}`);

  // ===== 4. 候补排位 =====
  console.log('\n── 5. 候补排位 ──');
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'waitlist' });
  check('WTL-01', '满员排位下单', r.status === 201 && r.data.order.status === 'pending', `msg=${r.data && r.data.message}`);
  ctx.waitOrderId = r.data.order.id;
  r = await req('POST', `/api/orders/${ctx.waitOrderId}/pay`, { openid: T.user1.openid });
  check('WTL-02', '排位支付', ok(r, 200) && r.data.wait && r.data.wait.status === 'waiting', `wait=${r.data && r.data.wait && r.data.wait.status}`);
  ctx.waitId = r.data.wait.id;
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'waitlist' });
  check('WTL-03', '有余位排位拒绝', r.status === 400 && (r.data.message || '').includes('余位'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'waitlist' });
  check('WTL-04a', '二号排位成功', r.status === 201, `msg=${r.data && r.data.message}`);
  const wait2Order = r.data.order;
  await req('POST', `/api/orders/${wait2Order.id}/pay`, { openid: T.user2.openid });
  r = await req('GET', `/api/waitlist?openid=${T.user2.openid}`);
  check('WTL-05', '我的候补列表', ok(r, 200) && r.data.waits.length >= 1, `count=${r.data && r.data.waits && r.data.waits.length}`);

  // 退订触发转正：holder 订满员场次(调低余位) → 退订 → 最早排位者(田立)转正
  const db = require('../server/db.js');
  db.db.prepare(`UPDATE course_sessions SET booked_count = 0 WHERE id = ${ctx.fullSessionId}`).run();
  r = await req('POST', '/api/orders', { openid: T.holder.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'book' });
  const holderOrder = r.data.order;
  await req('POST', `/api/orders/${holderOrder.id}/pay`, { openid: T.holder.openid, payMethod: 'wxpay' });
  // 查 holder 的 bookingId
  r = await req('GET', `/api/orders?openid=${T.holder.openid}`);
  const holderPaid = r.data.orders.find(o => o.session_id === ctx.fullSessionId && o.status === 'paid');
  r = await req('DELETE', `/api/bookings/${holderPaid.booking_id}?openid=${T.holder.openid}`);
  check('WTL-06', '退订触发转正', ok(r, 200) && r.data.promoted && r.data.promoted.openid === T.user1.openid, `promoted=${r.data && r.data.promoted && r.data.promoted.openid}`);
  // 验证田立已转正为 booked
  r = await req('GET', `/api/waitlist?openid=${T.user1.openid}`);
  const wl1 = (r.data.waits || []).find(w => w.session_id === ctx.fullSessionId);
  check('WTL-06b', '转正状态 promoted', wl1 && wl1.status === 'promoted', `status=${wl1 && wl1.status}`);

  // 退出候补（二号）
  r = await req('GET', `/api/waitlist?openid=${T.user2.openid}`);
  const w2 = (r.data.waits || []).find(w => w.status === 'waiting');
  if (w2) {
    r = await req('DELETE', `/api/waitlist/${w2.id}?openid=${T.user2.openid}`);
    check('WTL-07', '退出候补退款', ok(r, 200), `msg=${r.data && r.data.message}`);
    // 订单应 refunded
    r = await req('GET', `/api/orders?openid=${T.user2.openid}`);
    const w2Order = (r.data.orders || []).find(o => o.wait_id === w2.id);
    check('WTL-07b', '候补订单已退款', w2Order && w2Order.status === 'refunded', `status=${w2Order && w2Order.status}`);
  } else {
    check('WTL-07', '退出候补退款', false, '未找到 waiting 记录');
  }

  // 过期退款：明天场次（先设满员）排队 → 改日期为昨天 → 触发
  db.db.prepare(`UPDATE course_sessions SET booked_count = capacity WHERE id = ${ctx.tomorrowSessionId}`).run();
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.tomorrowSessionId, amountFen: 6800, orderType: 'waitlist' });
  const wlT = r.data.order;
  if (wlT) {
    await req('POST', `/api/orders/${wlT.id}/pay`, { openid: T.user2.openid });
    db.db.prepare(`UPDATE course_sessions SET date = '2026-08-09' WHERE id = ${ctx.tomorrowSessionId}`).run();
    r = await req('GET', `/api/waitlist?openid=${T.user2.openid}`);
    const wlT2 = (r.data.waits || []).find(w => w.session_id === ctx.tomorrowSessionId);
    check('WTL-08', '过期自动退款', wlT2 && wlT2.status === 'refunded', `status=${wlT2 && wlT2.status}`);
  } else {
    check('WTL-08', '过期自动退款', false, '排位下单失败: ' + r.data.message);
  }

  // ===== 5. 签到考勤 =====
  console.log('\n── 6. 签到考勤 ──');
  // 独立的"明天场次"（避免 WTL-08 改日期污染）
  const tmr2 = await mkSession(tomorrowStr, '13:00', '14:00', 5, 0);
  r = await req('GET', `/api/checkin/${ctx.bookingId}`);
  check('CHK-01', '凭证信息', ok(r, 200) && r.data.info && r.data.info.course_name, `course=${r.data && r.data.info && r.data.info.course_name}`);
  r = await req('POST', `/api/bookings/${ctx.bookingId}/checkin`, { openid: T.coach.openid });
  check('CHK-02', '教练核销成功', ok(r, 200) && r.data.booking.checkin_at, `checkin=${r.data && r.data.booking && r.data.booking.checkin_at}`);
  r = await req('POST', `/api/bookings/${ctx.bookingId}/checkin`, { openid: T.user1.openid });
  check('CHK-03', '非教练核销拒绝', r.status === 400 && (r.data.message || '').includes('教练'), `msg=${r.data && r.data.message}`);
  r = await req('POST', `/api/bookings/${ctx.bookingId}/checkin`, { openid: T.coach.openid });
  check('CHK-04', '重复签到拒绝', r.status === 400 && (r.data.message || '').includes('已签到'), `msg=${r.data && r.data.message}`);
  // 非当天场次（独立明天场次）签到
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: tmr2, amountFen: 6800, orderType: 'book' });
  const tmrOrder = r.data.order;
  await req('POST', `/api/orders/${tmrOrder.id}/pay`, { openid: T.user2.openid, payMethod: 'wxpay' });
  r = await req('GET', `/api/orders?openid=${T.user2.openid}`);
  const tmrPaid = r.data.orders.find(o => o.session_id === tmr2 && o.status === 'paid');
  r = await req('POST', `/api/bookings/${tmrPaid.booking_id}/checkin`, { openid: T.coach.openid });
  check('CHK-05', '非当天签到拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  // 场次名单
  r = await req('GET', `/api/sessions/${ctx.sessionId}/students`);
  check('CHK-06', '场次名单', ok(r, 200) && r.data.students.length >= 1 && r.data.students[0].student_name, `count=${r.data && r.data.students && r.data.students.length}`);

  // ===== 6. 营收统计 =====
  console.log('\n── 7. 营收统计 ──');
  r = await req('GET', '/api/revenue');
  check('REV-01', '营收统计', ok(r, 200) && r.data.stats.length === 4 && Array.isArray(r.data.monthly), `stats=${r.data && r.data.stats && r.data.stats.length}`);
  const refundBefore = (r.data.stats[3].value || '').replace(/[^0-9.]/g, '');
  // 退订用户1的订课 → 订单 refunded → 退款总额变化
  r = await req('DELETE', `/api/bookings/${ctx.bookingId}?openid=${T.user1.openid}`);
  check('ORD-07', '退订→订单退款', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/orders?openid=${T.user1.openid}`);
  const refundedOrder = (r.data.orders || []).find(o => o.id === ctx.paidOrderId);
  check('ORD-07b', '订单状态 refunded', refundedOrder && refundedOrder.status === 'refunded', `status=${refundedOrder && refundedOrder.status}`);
  r = await req('DELETE', `/api/bookings/${ctx.bookingId}?openid=${T.user1.openid}`);
  check('ORD-09', '已退订再退订', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/revenue');
  const refundAfter = (r.data.stats[3].value || '').replace(/[^0-9.]/g, '');
  check('REV-02', '退款后营收联动', Number(refundAfter) >= Number(refundBefore), `before=${refundBefore} after=${refundAfter}`);

  // 超卖防护：并发订满员场次
  console.log('\n── 8. 边界与安全 ──');
  const fullSid2 = await mkSession(todayStr, '23:00', '24:00', 1, 1);
  const results = await Promise.all([
    req('POST', '/api/orders', { openid: T.user1.openid, sessionId: fullSid2, amountFen: 6800 }),
    req('POST', '/api/orders', { openid: T.user2.openid, sessionId: fullSid2, amountFen: 6800 })
  ]);
  const fullRejected = results.filter(x => x.status === 400 && (x.data.message || '').includes('满员')).length;
  check('SEC-04', '超卖防护(满员并发)', fullRejected >= 1, `拒绝数=${fullRejected}`);
  // SEC-04b：订满后场次状态联动为 full（回归 BUG-LEDGER #2：booked_count 变更点须联动 status）
  // 注意：下单只建订单不动余位，booked_count+1 在支付（payOrder→createBooking）时才发生，故走完整链路
  const fullSid3 = await mkSession(todayStr, '23:30', '24:30', 1, 0);   // 容量1、初始0人
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: fullSid3, amountFen: 6800 });
  check('SEC-04b-1', '订满链路下单', ok(r, 201), `msg=${r.data && r.data.message}`);
  const ordSid3 = r.data.order.id;
  r = await req('POST', `/api/orders/${ordSid3}/pay`, { openid: T.user1.openid, payMethod: 'wxpay' });
  check('SEC-04b-2', '订满链路支付', ok(r, 200) && r.data.booking, `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/sessions/${fullSid3}`);
  check('SEC-04b', '支付满员后场次状态=full', ok(r, 200) && r.data.session.status === 'full', `status=${r.data && r.data.session && r.data.session.status}`);
  // 创建课程缺参已在 CRS-02 覆盖
  r = await req('POST', '/api/courses/9999/publish', {});
  check('CRS-04a', '发布缺日期参数', r.status === 400 && (r.data.message || '').includes('日期'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/courses/9999/publish', { start_date: '2026-08-11', end_date: '2026-08-17' });
  check('CRS-04b', '发布不存在课程', r.status === 404 && (r.data.message || '').includes('不存在'), `status=${r.status} msg=${r.data && r.data.message}`);

  // ===== 9. 会员体系 =====
  console.log('\n── 9. 会员体系 ──');
  r = await req('GET', `/api/member/level?openid=${T.user1.openid}`);
  check('MEM-01', '会员等级查询', ok(r, 200) && r.data.level && r.data.level.levelName, `level=${r.data && r.data.level && r.data.level.levelName}`);
  r = await req('GET', '/api/member/plans');
  check('MEM-02', '充值套餐列表', ok(r, 200) && r.data.plans.length === 3, `count=${r.data && r.data.plans && r.data.plans.length}`);
  // 储值充值：下单 → 支付 → 余额增加（500 档首充送 30% = 150 → 共 650）
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: 0, amountFen: 50000, orderType: 'recharge' });
  check('MEM-03', '充值下单', r.status === 201 && r.data.order.order_type === 'recharge', `msg=${r.data && r.data.message}`);
  const rcOrder = r.data.order;
  // MEM-03b：充值订单 session_id 必须为 NULL（回归 BUG-LEDGER #1：orders.session_id NOT NULL 与充值写 NULL 冲突，本地旧表掩盖、仅 CI 干净库可抓）
  check('MEM-03b', '充值订单session_id为NULL', rcOrder.session_id == null, `session_id=${rcOrder && rcOrder.session_id}`);
  r = await req('POST', `/api/orders/${rcOrder.id}/pay`, { openid: T.user1.openid });
  check('MEM-04', '充值支付到账(首充30%)', ok(r, 200) && r.data.recharge && r.data.recharge.total === 65000 && r.data.recharge.isFirst, `total=${r.data && r.data.recharge && r.data.recharge.total} first=${r.data && r.data.recharge && r.data.recharge.isFirst}`);
  r = await req('GET', `/api/member/level?openid=${T.user1.openid}`);
  check('MEM-05', '余额增加', r.data.level.balanceFen === 65000, `balance=${r.data && r.data.level && r.data.level.balanceFen}`);
  r = await req('GET', `/api/member/recharges?openid=${T.user1.openid}`);
  check('MEM-06', '充值记录', ok(r, 200) && r.data.recharges.length >= 1, `count=${r.data && r.data.recharges && r.data.recharges.length}`);
  // 无效套餐拒绝
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: 0, amountFen: 12345, orderType: 'recharge' });
  check('MEM-07', '无效套餐拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  // 复充：同档第二次充值 → 送 10%（500 → 送 50 → 共 550）
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: 0, amountFen: 50000, orderType: 'recharge' });
  const rcOrder2 = r.data.order;
  r = await req('POST', `/api/orders/${rcOrder2.id}/pay`, { openid: T.user1.openid });
  check('MEM-07b', '复充送10%', ok(r, 200) && r.data.recharge && r.data.recharge.total === 55000 && r.data.recharge.isFirst === false, `total=${r.data && r.data.recharge && r.data.recharge.total} first=${r.data && r.data.recharge && r.data.recharge.isFirst}`);
  // 邀请奖励：绑定+首订 → 阶梯1奖励
  r = await req('POST', '/api/invite', { inviter: T.user1.openid, invitee: T.user2.openid });
  check('MEM-08', '绑定邀请', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/invite/stats?openid=${T.user1.openid}`);
  check('MEM-09', '邀请统计', ok(r, 200) && r.data.invited >= 1, `invited=${r.data && r.data.invited}`);
  // 未读奖励（充值也会产生未读流水）
  r = await req('GET', `/api/member/rewards?openid=${T.user1.openid}`);
  check('MEM-10', '未读奖励', ok(r, 200) && (r.data.rewards || []).length >= 1, `count=${r.data && r.data.rewards && r.data.rewards.length}`);
  r = await req('POST', '/api/member/rewards/read', { openid: T.user1.openid });
  check('MEM-11', '标记奖励已读', ok(r, 200), `msg=${r.data && r.data.message}`);

  // ===== 9.5 关键链路补充：余额不足 / 会员价取整 / 充值分页 =====
  console.log('\n── 9.5 关键链路补充（余额不足/取整/分页） ──');
  const dbx = require('../server/db.js');

  // BAL-01 余额不足拒绝（新用户余额 0，余额支付必须被拒且不产生脏数据）
  const balSessionId = await mkSession(todayStr, '20:00', '21:00', 5, 0);
  r = await req('POST', '/api/auth/login', { openid: 'uid_test_bal', nickname: '余额测试' });
  r = await req('POST', '/api/orders', { openid: 'uid_test_bal', sessionId: balSessionId, amountFen: 8000, orderType: 'book' });
  check('BAL-01a', '余额不足用户可下单', r.status === 201, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: 'uid_test_bal', payMethod: 'balance' });
  check('BAL-01', '余额不足支付拒绝', r.status === 400 && (r.data.message || '').includes('余额不足'), `msg=${r.data && r.data.message}`);

  // MEM-12 会员价向下取整到元（¥80 课程 × 青铜 98 折 = 78.4 → 实扣 ¥78，无角分）
  const memSessionId = await mkSession(todayStr, '20:30', '21:30', 5, 0);
  const balBefore = dbx.getMemberLevel(T.user1.openid).balanceFen;
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: memSessionId, amountFen: 8000, orderType: 'book' });
  check('MEM-12a', '取整用例下单', r.status === 201, `status=${r.status}`);
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: T.user1.openid, payMethod: 'balance' });
  check('MEM-12b', '取整用例支付成功', ok(r, 200), `msg=${r.data && r.data.message}`);
  const balAfter = dbx.getMemberLevel(T.user1.openid).balanceFen;
  check('MEM-12', '会员价取整实扣¥78（非78.4）', (balBefore - balAfter) === 7800, `扣款=${(balBefore - balAfter) / 100}元（应 78）`);

  // RCG-01/02 充值分页（插 25 笔模拟历史，验证 10/10/5 + hasMore 边界）
  const rcgOpenid = 'uid_test_rcg';
  await req('POST', '/api/auth/login', { openid: rcgOpenid, nickname: '分页测试' });
  for (let i = 0; i < 25; i++) {
    dbx.db.prepare("INSERT INTO member_recharges (recharge_no, user_openid, order_id, amount_fen, bonus_fen, status, created_at) VALUES (?, ?, 0, 50000, 5000, 'paid', datetime('now','localtime','-' || ? || ' minutes'))")
      .run('RCG_' + i, rcgOpenid, i + 1);
  }
  r = await req('GET', `/api/member/recharges?openid=${rcgOpenid}`);
  check('RCG-01', '分页第1页10笔+hasMore', (r.data.recharges || []).length === 10 && r.data.hasMore === true, `count=${r.data.recharges && r.data.recharges.length} hasMore=${r.data.hasMore}`);
  r = await req('GET', `/api/member/recharges?openid=${rcgOpenid}&offset=20`);
  check('RCG-02', '第3页5笔+无更多', (r.data.recharges || []).length === 5 && r.data.hasMore === false, `count=${r.data.recharges && r.data.recharges.length} hasMore=${r.data.hasMore}`);
  dbx.db.prepare("DELETE FROM member_recharges WHERE user_openid=?").run(rcgOpenid);

  // ===== 10. 能量币 =====
  console.log('\n── 10. 能量币 ──');
  r = await req('GET', `/api/coin/balance?openid=${T.user1.openid}`);
  check('COIN-01', '能量币余额', ok(r, 200) && typeof r.data.balance === 'number', `balance=${r.data && r.data.balance}`);
  r = await req('GET', '/api/coin/shop');
  check('COIN-02', '商店奖品', ok(r, 200) && r.data.items.length >= 1, `count=${r.data && r.data.items && r.data.items.length}`);
  r = await req('GET', '/api/coin/config');
  check('COIN-03', '能量币配置', ok(r, 200) && r.data.config && r.data.config.earnRules, `rules=${r.data && r.data.config && JSON.stringify(r.data.config.earnRules)}`);
  // 充值获得能量币：user2 充 500 → 5% = 250 币（验证比例）
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: 0, amountFen: 50000, orderType: 'recharge' });
  let coinOrder = r.data.order;
  await req('POST', `/api/orders/${coinOrder.id}/pay`, { openid: T.user2.openid });
  r = await req('GET', `/api/coin/balance?openid=${T.user2.openid}`);
  check('COIN-04', '充值得币(5%比例)', r.data.balance === 250, `balance=${r.data && r.data.balance}`);
  // 再充 1500 → 应得 750，但每日上限 500 → 补发 250（验证日限截断）
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: 0, amountFen: 150000, orderType: 'recharge' });
  coinOrder = r.data.order;
  await req('POST', `/api/orders/${coinOrder.id}/pay`, { openid: T.user2.openid });
  r = await req('GET', `/api/coin/balance?openid=${T.user2.openid}`);
  check('COIN-04b', '充值得币(日限截断)', r.data.balance === 500, `balance=${r.data && r.data.balance}`);
  // 余额不足兑换拒绝
  r = await req('POST', '/api/coin/exchange', { openid: T.user2.openid, itemId: 'coach-1v1' });
  check('COIN-05', '余额不足兑换拒绝', r.status === 400 && (r.data.message || '').includes('不足'), `msg=${r.data && r.data.message}`);
  // 兑换水杯（300 币）
  r = await req('POST', '/api/coin/exchange', { openid: T.user2.openid, itemId: 'water-bottle' });
  check('COIN-06', '兑换成功', ok(r, 200) && r.data.exchange.item_id === 'water-bottle', `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/coin/exchanges?openid=${T.user2.openid}`);
  check('COIN-07', '兑换记录', ok(r, 200) && r.data.exchanges.length >= 1, `count=${r.data && r.data.exchanges && r.data.exchanges.length}`);
  r = await req('GET', `/api/coin/logs?openid=${T.user2.openid}`);
  check('COIN-08', '能量币流水', ok(r, 200) && r.data.logs.length >= 2, `count=${r.data && r.data.logs && r.data.logs.length}`);
  // 无效奖品
  r = await req('POST', '/api/coin/exchange', { openid: T.user2.openid, itemId: 'nope' });
  check('COIN-09', '无效奖品拒绝', r.status === 400, `msg=${r.data && r.data.message}`);

  // ===== 清理测试数据 =====
  console.log('\n── 11. 清理测试数据 ──');
  try {
    db.db.prepare("DELETE FROM orders WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM course_sessions WHERE source='test_suite'").run();
    db.db.prepare("DELETE FROM invitations WHERE inviter LIKE 'uid_test_%' OR invitee LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM member_recharges WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM coin_logs WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM coin_exchanges WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("UPDATE users SET coin_balance = 0 WHERE openid LIKE 'uid_test_%'").run();
    // 清理测试用户（注意可能被引用）
    ['uid_test_tianli','uid_test_student2','uid_test_coach','uid_test_holder'].forEach(o => {
      const u = db.findUserByOpenid(o);
      if (u) db.deleteUserById(u.id);
    });
    console.log('  ✅ 测试数据已清理');
  } catch (e) {
    console.log('  ⚠️ 清理异常（不影响结果）: ' + e.message);
  }

  // ===== 汇总 =====
  const duration = ((Date.now() - started) / 1000).toFixed(1);
  const total = passed + failed;
  const rate = total > 0 ? (passed / total * 100).toFixed(1) : 0;
  console.log(`\n========== 测试完成 ==========`);
  console.log(`总用例: ${total} ｜ 通过: ${passed} ✅ ｜ 失败: ${failed} ❌ ｜ 通过率: ${rate}% ｜ 耗时: ${duration}s`);
  if (failures.length > 0) {
    console.log('\n失败明细:');
    failures.forEach(f => console.log(`  ❌ ${f.id} ${f.name} → ${f.detail}`));
  }
  console.log('=============================\n');

  // 输出 JSON 结果供报告使用
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    total, passed, failed, rate: Number(rate), duration: Number(duration),
    failures
  };
  require('node:fs').writeFileSync(__dirname + '/report.json', JSON.stringify(report, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试脚本异常:', e);
  process.exit(2);
});
