/**
 * 覆盖率探针测试（node:test + assert）
 * 用法: node --test --experimental-test-coverage minitest/coverage.test.js
 *       （可用 --test-coverage-include='server/**' 只看 server 代码）
 * 在同进程加载 server（require.main 守卫保证不自动 listen），
 * 走一遍核心接口，产出 server 代码覆盖率报告。
 */
const { test } = require('node:test');
const assert = require('node:assert');

// 同进程加载 server + db（同一 SQLite 文件，WAL 并发安全）
const { server, db } = require('../server/index.js');

// ===== 测试数据（独立前缀，避免与端到端测试冲突） =====
const U1 = { openid: 'uid_cov_u1', nickname: '覆盖测试A' };
const U2 = { openid: 'uid_cov_u2', nickname: '覆盖测试B' };
const COACH = { openid: 'uid_cov_coach', nickname: '覆盖教练', role: 'coach' };

// ===== 预清理 =====
function clean() {
  for (const t of ['orders', 'bookings', 'waitlist', 'coin_logs', 'coin_exchanges',
    'member_recharges', 'balance_logs', 'messages', 'invitations']) {
    db.db.prepare(`DELETE FROM ${t} WHERE user_openid LIKE 'uid_cov_%' OR inviter LIKE 'uid_cov_%' OR invitee LIKE 'uid_cov_%'`).run();
  }
  db.db.prepare("DELETE FROM course_sessions WHERE source='cov_suite'").run();
}
clean();

// ===== 同进程 HTTP 客户端 =====
let port = 0;
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL('http://127.0.0.1:' + port + path);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    };
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, data: json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

test('核心链路覆盖率探针（同进程）', async (t) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  try {
    // ---- 01 认证 ----
    let r = await req('POST', '/api/auth/login', U1);
    assert.equal(r.status, 201, '注册');
    r = await req('POST', '/api/auth/login', U2);
    assert.equal(r.status, 201, '注册B');
    r = await req('POST', '/api/auth/login', COACH);
    assert.equal(r.status, 201, '注册教练');
    r = await req('GET', '/api/users/stats?openid=' + U1.openid);
    assert.equal(r.data.code, 200, '用户统计');

    // ---- 02 课程与场次 ----
    r = await req('GET', '/api/courses');
    assert.ok(r.data.courses.length > 0, '课程列表');
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    r = await req('GET', '/api/sessions?date=' + todayStr);
    assert.ok(Array.isArray(r.data.sessions), '场次列表');
    // 造一个独立测试场次（容量 2：用于订课/满员/候补/签到全链路）
    const course = db.db.prepare('SELECT id FROM courses LIMIT 1').get();
    const ins = db.db.prepare(
      "INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source) VALUES (?,1,1,?,'19:00','20:00',2,0,'published','cov_suite')"
    ).run(course.id, todayStr);
    const sid = ins.lastInsertRowid;

    // ---- 03 订课（U1 订 + 支付） ----
    r = await req('POST', '/api/bookings', { openid: U1.openid, sessionId: sid });
    assert.equal(r.status, 201, '下单');
    const orderId = r.data.order.id;
    const bookingId = r.data.booking.id;
    r = await req('POST', `/api/orders/${orderId}/pay`, { openid: U1.openid, payMethod: 'balance' });
    assert.equal(r.data.code, 200, '余额支付');
    r = await req('GET', '/api/orders?openid=' + U1.openid);
    assert.ok(r.data.orders.length >= 1, '订单列表');
    r = await req('GET', '/api/sessions/' + sid + '?openid=' + U1.openid);
    assert.equal(r.data.session.booked_by_me, true, '已订标记');

    // ---- 04 满员 → U2 候补 ----
    r = await req('POST', '/api/bookings', { openid: U2.openid, sessionId: sid });
    assert.equal(r.status, 201, 'U2 订满');
    r = await req('GET', '/api/sessions/' + sid);
    assert.equal(r.data.session.status, 'full', '满员状态');
    r = await req('POST', '/api/orders', { openid: U2.openid, sessionId: sid, orderType: 'waitlist' });
    assert.equal(r.status, 400, '满员排位走 waitlist 接口被拒（由 bookings 处理）');

    // ---- 05 会员/充值/能量币/邀请 ----
    r = await req('GET', '/api/member/level?openid=' + U1.openid);
    assert.ok(r.data.level, '会员等级');
    r = await req('GET', '/api/member/plans');
    assert.equal(r.data.plans.length, 3, '充值套餐');
    r = await req('POST', '/api/orders', { openid: U1.openid, orderType: 'recharge', amountFen: 50000 });
    assert.equal(r.status, 201, '充值下单');
    const rcOrderId = r.data.order.id;
    r = await req('POST', `/api/orders/${rcOrderId}/pay`, { openid: U1.openid, payMethod: 'balance' });
    assert.equal(r.data.code, 200, '充值支付');
    r = await req('GET', '/api/member/recharges?openid=' + U1.openid);
    assert.ok(r.data.recharges.length >= 1, '充值记录');
    r = await req('GET', '/api/coin/info?openid=' + U1.openid);
    assert.ok(r.data.balance >= 0, '能量币');
    r = await req('POST', '/api/invite', { openid: U1.openid, invitee: U2.openid });
    assert.ok(r.data.code === 200, '绑定邀请');

    // ---- 06 签到 ----
    r = await req('GET', '/api/checkin/' + bookingId);
    assert.ok(r.data.info, '凭证信息');
    r = await req('POST', `/api/bookings/${bookingId}/checkin`, { openid: COACH.openid });
    assert.equal(r.data.code, 200, '教练核销');
    r = await req('GET', `/api/sessions/${sid}/students`);
    assert.ok(Array.isArray(r.data.students), '场次名单');

    // ---- 07 退订退款（走满员触发的候补转正路径） ----
    r = await req('DELETE', `/api/bookings/${bookingId}?openid=${U1.openid}`);
    assert.equal(r.data.code, 200, '退订退款');

    // ---- 08 后台统计 ----
    r = await req('GET', '/api/revenue');
    assert.ok(r.data.stats, '营收统计');
    r = await req('GET', '/api/users');
    assert.ok(Array.isArray(r.data.users), '用户列表');
    r = await req('GET', '/api/health');
    assert.equal(r.data.code, 200, '健康检查');

    console.log('覆盖率探针：核心链路全部通过 ✓');
  } finally {
    clean();
    server.close();
  }
});
