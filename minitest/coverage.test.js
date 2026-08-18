/**
 * 覆盖率探针测试（node:test + assert）
 * 用法: node --test --experimental-test-coverage minitest/coverage.test.js
 *       （可用 --test-coverage-include='server/**' 只看 server 代码）
 * 在同进程加载 server（require.main 守卫保证不自动 listen），
 * 走一遍核心接口，产出 server 代码覆盖率报告。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// 同进程加载 server + db（同一 SQLite 文件，WAL 并发安全）
const { server, db } = require('../server/index.js');
// 日期/时间统一取北京时间（time.js 显式时区），CI（UTC）与本地口径一致（BUG-LEDGER #28）
const timeMod = require('../server/time.js');

// ===== 测试数据（独立前缀，避免与端到端测试冲突） =====
const U1 = { openid: 'uid_cov_u1', nickname: '覆盖测试A' };
const U2 = { openid: 'uid_cov_u2', nickname: '覆盖测试B' };
const COACH = { openid: 'uid_cov_coach', nickname: '覆盖教练', role: 'coach' };

// 管理后台段创建的测试课程 id（clean 时清理其规则/场次/课程本体）
let covCourseId = null;

// ===== 预清理 =====
function clean() {
  // 各表按实际列清理（invitations 无 user_openid 列，需专用 SQL——CI 干净环境验证发现）
  for (const t of ['orders', 'bookings', 'waitlist', 'coin_logs', 'coin_exchanges',
    'member_recharges', 'balance_logs', 'messages']) {
    db.db.prepare(`DELETE FROM ${t} WHERE user_openid LIKE 'uid_cov_%'`).run();
  }
  db.db.prepare("DELETE FROM invitations WHERE inviter LIKE 'uid_cov_%' OR invitee LIKE 'uid_cov_%'").run();
  db.db.prepare("DELETE FROM coach_notes WHERE coach_openid LIKE 'uid_cov_%' OR student_openid LIKE 'uid_cov_%'").run();
  db.db.prepare("UPDATE coaches SET user_openid = NULL WHERE user_openid LIKE 'uid_cov_%'").run();
  db.db.prepare("DELETE FROM course_sessions WHERE source='cov_suite'").run();
  if (covCourseId) {
    db.db.prepare('DELETE FROM schedule_templates WHERE course_id = ?').run(covCourseId);
    db.db.prepare('DELETE FROM course_sessions WHERE course_id = ?').run(covCourseId);
    db.db.prepare('DELETE FROM courses WHERE id = ?').run(covCourseId);
    covCourseId = null;
  }
  db.db.prepare("DELETE FROM users WHERE openid LIKE 'uid_cov_%'").run();
}
clean();

// ===== 同进程 HTTP 客户端 =====
let port = 0;
function req(method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const u = new URL('http://127.0.0.1:' + port + path);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(extraHeaders || {})
      }
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
    // B2（2026-08-18）：探针支付改走储值余额（wxpay 未开通被闸门拒）→ 补余额
    db.db.prepare('UPDATE users SET balance_fen = balance_fen + 500000 WHERE openid IN (?, ?, ?)')
      .run(U1.openid, U2.openid, COACH.openid);
    r = await req('GET', '/api/users/stats?openid=' + U1.openid);
    assert.equal(r.data.code, 200, '用户统计');
    // 手机号换号（B1 合规 2026-08-18：未企业认证 → 400，不写假号）
    r = await req('POST', '/api/auth/phone-login', { code: 'fake' });
    assert.ok(r.status === 400, '手机号换号未认证 → 400');

    // ---- 02 课程与场次 ----
    r = await req('GET', '/api/courses');
    assert.ok(r.data.courses.length > 0, '课程列表');
    const todayStr = timeMod.todayStr();
    r = await req('GET', '/api/sessions?date=' + todayStr);
    assert.ok(Array.isArray(r.data.sessions), '场次列表');
    // 造一个独立测试场次（容量 2：用于订课/满员/候补/签到全链路）
    // 时间=当前+30分钟（签到窗口是开课前30分~课后30分，BUG-LEDGER #10/#28 统一后固定时刻会被窗口拒绝）
    const course = db.db.prepare('SELECT id FROM courses LIMIT 1').get();
    const ckStart = new Date(Date.now() + 30 * 60000);
    const ckEnd = new Date(ckStart.getTime() + 60 * 60000);
    const pad2 = n => String(n).padStart(2, '0');
    const ckStartStr = `${pad2(timeMod.parts(ckStart).h)}:${pad2(timeMod.parts(ckStart).mi)}`;
    const ckEndStr = `${pad2(timeMod.parts(ckEnd).h)}:${pad2(timeMod.parts(ckEnd).mi)}`;
    const ins = db.db.prepare(
      "INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source) VALUES (?,1,1,?,?,?,2,0,'published','cov_suite')"
    ).run(course.id, todayStr, ckStartStr, ckEndStr);
    const sid = ins.lastInsertRowid;

    // ---- 03 订课（U1 订 + 支付；下单走 /api/orders，返回 order+booking） ----
    r = await req('POST', '/api/orders', { openid: U1.openid, sessionId: sid, amountFen: 8000, orderType: 'book' });
    assert.equal(r.status, 201, '下单');
    const orderId = r.data.order.id;
    r = await req('POST', `/api/orders/${orderId}/pay`, { openid: U1.openid, payMethod: 'balance' });
    assert.equal(r.data.code, 200, '支付（储值余额）');
    const bookingId = r.data.booking.id;   // booking 在支付后返回
    r = await req('GET', '/api/orders?openid=' + U1.openid);
    assert.ok(r.data.orders.length >= 1, '订单列表');
    r = await req('GET', '/api/sessions/' + sid + '?openid=' + U1.openid);
    assert.equal(r.data.session.booked_by_me, true, '已订标记');

    // ---- 04 满员 → U2 候补（U2 下单+支付后才真正满员） ----
    r = await req('POST', '/api/orders', { openid: U2.openid, sessionId: sid, amountFen: 8000, orderType: 'book' });
    assert.equal(r.status, 201, 'U2 下单');
    const u2OrderId = r.data.order.id;
    r = await req('POST', `/api/orders/${u2OrderId}/pay`, { openid: U2.openid, payMethod: 'balance' });
    assert.equal(r.data.code, 200, 'U2 支付');
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
    r = await req('GET', '/api/coin/balance?openid=' + U1.openid);
    assert.ok(r.data.balance >= 0, '能量币');
    r = await req('POST', '/api/invite', { inviter: U1.openid, invitee: U2.openid });
    assert.ok(r.data.code === 200, '绑定邀请');

    // ---- 06 签到 ----
    r = await req('GET', '/api/checkin/' + bookingId);
    assert.ok(r.data.info, '凭证信息');
    r = await req('POST', `/api/bookings/${bookingId}/checkin`, { openid: COACH.openid });
    assert.equal(r.data.code, 200, '教练核销');
    // 按码核销探针（BUGS-INBOX #11）：凭证含 5 位码；格式错/已签到的码拒绝
    r = await req('GET', '/api/checkin/' + bookingId);
    const ckCode = r.data.info && r.data.info.checkin_code;
    assert.ok(/^\d{5}$/.test(ckCode || ''), '签到码 5 位纯数字');
    r = await req('POST', '/api/checkin/by-code', { code: '12', openid: COACH.openid });
    assert.equal(r.status, 400, '格式错误码拒绝');
    r = await req('POST', '/api/checkin/by-code', { code: ckCode, openid: COACH.openid });
    assert.equal(r.status, 400, '已签到码重复核销拒绝');
    r = await req('GET', `/api/sessions/${sid}/students`);
    assert.ok(Array.isArray(r.data.students), '场次名单');

    // ---- 07 退订退款（B3 2026-08-18：开课前 2 小时内不可退订，签到窗口场次(now+30m)已过截止 → 独立造 now+3h 场次退订） ----
    const rfT = new Date(Date.now() + 3 * 3600 * 60000);
    const rfDate = `${timeMod.parts(rfT).y}-${pad2(timeMod.parts(rfT).mo)}-${pad2(timeMod.parts(rfT).d)}`;
    const rfStart = `${pad2(timeMod.parts(rfT).h)}:${pad2(timeMod.parts(rfT).mi)}`;
    const rfEndT = new Date(rfT.getTime() + 3600 * 60000);
    const rfEnd = `${pad2(timeMod.parts(rfEndT).h)}:${pad2(timeMod.parts(rfEndT).mi)}`;
    const sidRf = db.db.prepare(
      "INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source) VALUES (?,1,1,?,?,?,2,0,'published','cov_suite')"
    ).run(course.id, rfDate, rfStart, rfEnd).lastInsertRowid;
    r = await req('POST', '/api/orders', { openid: U1.openid, sessionId: sidRf, amountFen: 8000, orderType: 'book' });
    assert.equal(r.status, 201, '退订场次下单');
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: U1.openid, payMethod: 'balance' });
    assert.equal(r.data.code, 200, '退订场次支付');
    r = await req('DELETE', `/api/bookings/${r.data.booking.id}?openid=${U1.openid}`);
    assert.equal(r.data.code, 200, '退订退款');

    // ---- 08 后台统计 ----
    r = await req('GET', '/api/revenue');
    assert.ok(r.data.stats, '营收统计');
    r = await req('GET', '/api/users');
    assert.ok(Array.isArray(r.data.users), '用户列表');
    r = await req('GET', '/api/health');
    assert.equal(r.data.code, 200, '健康检查');

    // ---- 09 消息中心（订课/退款/签到已触发业务埋点） ----
    r = await req('GET', '/api/messages?openid=' + U1.openid);
    assert.ok(Array.isArray(r.data.messages), '消息列表');
    r = await req('GET', '/api/messages/unread-count?openid=' + U1.openid);
    assert.ok(typeof r.data.unread === 'number', '未读数');
    const msgId = r.data.messages && r.data.messages[0] && r.data.messages[0].id;
    if (msgId) {
      r = await req('POST', `/api/messages/${msgId}/read`, { openid: U1.openid });
      assert.equal(r.data.code, 200, '单条已读');
    }
    r = await req('POST', '/api/messages/read-all', { openid: U1.openid });
    assert.equal(r.data.code, 200, '全部已读');

    // ---- 10 邀请完整链路（绑定 → 好友首订 → 邀请人奖励） ----
    const U3 = { openid: 'uid_cov_u3', nickname: '覆盖测试C' };
    r = await req('POST', '/api/auth/login', U3);
    assert.equal(r.status, 201, '注册C');
    db.db.prepare('UPDATE users SET balance_fen = balance_fen + 500000 WHERE openid = ?').run(U3.openid);
    r = await req('POST', '/api/invite', { inviter: U1.openid, invitee: U3.openid });
    assert.equal(r.data.code, 200, '绑定邀请C');
    const s3 = db.db.prepare(
      "INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source) VALUES (?,1,1,?,'18:00','19:00',5,0,'published','cov_suite')"
    ).run(course.id, todayStr).lastInsertRowid;
    r = await req('POST', '/api/orders', { openid: U3.openid, sessionId: s3, amountFen: 8000, orderType: 'book' });
    assert.equal(r.status, 201, '好友下单');
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: U3.openid, payMethod: 'balance' });
    assert.equal(r.data.code, 200, '好友首订支付（触发邀请奖励）');
    r = await req('GET', '/api/member/rewards?openid=' + U1.openid);
    assert.ok(r.data.rewards.length >= 1, '邀请奖励未读');
    r = await req('POST', '/api/member/rewards/read', { openid: U1.openid });
    assert.equal(r.data.code, 200, '奖励已读');
    r = await req('GET', '/api/invite/stats?openid=' + U1.openid);
    assert.ok(r.data.invited >= 1, '邀请统计');
    r = await req('GET', '/api/invite/details?openid=' + U1.openid);
    assert.ok(Array.isArray(r.data.details), '邀请明细');
    // 邀请看板属 ADMIN_PATHS（#14 保护）：配置 ADMIN_TOKEN 后须带 header（.env 已配生产值，探针自身成对开关）
    process.env.ADMIN_TOKEN = 'cov-admin';
    r = await req('GET', '/api/admin/invite-board', null, { 'Admin-Token': 'cov-admin' });
    delete process.env.ADMIN_TOKEN;
    assert.ok(r.data.board, '邀请看板（带访问码）');
    // 次卡包探针
    r = await req('GET', '/api/passes/packages');
    assert.strictEqual(r.status, 200, 'passes/packages 200');
    r = await req('GET', '/api/passes/my?openid=' + U1.openid);
    assert.strictEqual(r.status, 200, 'passes/my 200');
    r = await req('GET', '/api/passes/available?openid=' + U1.openid);
    assert.strictEqual(r.status, 200, 'passes/available 200');
    // 课程详情页重构字段
    r = await req('GET', '/api/sessions/1?openid=' + U1.openid);
    assert.ok(Array.isArray(r.data.session.images), '详情 images 数组');
    assert.ok(Array.isArray(r.data.session.bookedUsers), '详情 bookedUsers 数组');

    // ---- 11 能量币：兑换失败/成功/记录/配置 ----
    r = await req('GET', '/api/coin/shop');
    assert.ok(Array.isArray(r.data.items), '能量商店');
    r = await req('GET', '/api/coin/config');
    assert.ok(r.data.config, '能量币配置');
    r = await req('POST', '/api/coin/exchange', { openid: U1.openid, itemId: 'coach-1v1' }); // 1200币 > 当前余额（250+邀请奖励）
    assert.equal(r.status, 400, '余额不足兑换拒绝');
    // 直接设足能量币（探针控制数据，避免依赖充值/邀请的币量计算链）
    db.db.prepare('UPDATE users SET coin_balance = 2000 WHERE openid = ?').run(U1.openid);
    r = await req('POST', '/api/coin/exchange', { openid: U1.openid, itemId: 'coach-1v1' });
    assert.equal(r.data.code, 200, '兑换成功');
    r = await req('GET', '/api/coin/exchanges?openid=' + U1.openid);
    assert.ok(r.data.exchanges.length >= 1, '兑换记录');
    r = await req('GET', '/api/coin/logs?openid=' + U1.openid);
    assert.ok(r.data.logs.length >= 1, '能量币流水');
    r = await req('POST', '/api/coin/exchange', { openid: U1.openid, itemId: 'nope' });
    assert.equal(r.status, 400, '无效奖品拒绝');

    // ---- 12 管理后台：课程 CRUD / 排课规则 / 发布 / 场次管理 ----
    r = await req('POST', '/api/courses', { name: '覆盖测试课程', category: '测试分类', level: 3, duration_min: 60, price_fen: 8800, status: 'draft' });
    assert.equal(r.status, 201, '创建课程');
    covCourseId = r.data.course.id;
    r = await req('PUT', `/api/courses/${covCourseId}`, { name: '覆盖测试课程改', tags: '测试' });
    assert.equal(r.data.code, 200, '更新课程');
    // 时段用 14:00-15:00（避开 seed 场次 10:00/11:00/15:00/16:00/20:00/21:00，排课冲突检测 BUG-LEDGER #7 相关功能会跳过重叠时段）
    const [cy, cm, cd] = todayStr.split('-').map(Number);
    const wd = new Date(Date.UTC(cy, cm - 1, cd)).getUTCDay(); // 无时区依赖的星期
    r = await req('PUT', `/api/courses/${covCourseId}/rules`, { rules: [{ weekday: wd === 0 ? 7 : wd, start_time: '14:00', end_time: '15:00', venue_id: 1, coach_id: 1, capacity: 5 }] });
    assert.equal(r.data.code, 200, '保存排课规则');
    r = await req('POST', `/api/courses/${covCourseId}/publish`, { start_date: todayStr, end_date: todayStr });
    assert.equal(r.data.code, 200, '发布场次');
    const pubSid = db.db.prepare("SELECT id FROM course_sessions WHERE course_id=? AND source='manual' LIMIT 1").get(covCourseId);
    assert.ok(pubSid, '发布产生场次');
    r = await req('GET', `/api/admin/sessions?from=${todayStr}&to=${todayStr}&course_id=${covCourseId}`);
    assert.ok(Array.isArray(r.data.sessions), '范围场次');
    // 访问码保护探针（BUGS-INBOX #8）：env 配置后管理接口 401，随后清除恢复（探针成对）
    process.env.ADMIN_TOKEN = 'cov-admin';
    r = await req('GET', `/api/admin/sessions?from=${todayStr}&to=${todayStr}&course_id=${covCourseId}`);
    assert.equal(r.status, 401, '配置 ADMIN_TOKEN 后 /api/admin/sessions 需 401');
    delete process.env.ADMIN_TOKEN;
    r = await req('GET', `/api/admin/sessions?from=${todayStr}&to=${todayStr}&course_id=${covCourseId}`);
    assert.equal(r.data.code, 200, '清除 ADMIN_TOKEN 后放行');
    r = await req('PUT', `/api/sessions/${pubSid.id}`, { capacity: 15 });
    assert.equal(r.data.code, 200, '改容量');
    r = await req('DELETE', `/api/sessions/${pubSid.id}`);
    assert.equal(r.data.code, 200, '取消场次');
    r = await req('DELETE', `/api/courses/${covCourseId}`);
    assert.equal(r.data.code, 200, '删除课程');
    covCourseId = null;

    // ---- 13 教练端 / 元数据 / 会员配置 ----
    r = await req('GET', `/api/coach/schedule?date=${todayStr}&coach_id=1`);
    assert.ok(Array.isArray(r.data.sessions), '教练今日课表');
    r = await req('GET', '/api/meta');
    assert.ok(Array.isArray(r.data.coaches), '下拉元数据');
    r = await req('GET', '/api/member/config');
    assert.ok(r.data.config, '会员配置');

    // ---- 13.5 教练工作台（DESIGN #D1）：学员/笔记/结算/设教练探针 ----
    r = await req('POST', '/api/admin/coach-assign', { openid: COACH.openid, coach_id: 1 });
    assert.equal(r.data.code, 200, '设教练');
    r = await req('GET', '/api/coach/students?coach_openid=' + COACH.openid);
    assert.ok(r.data.students, '我的学员');
    r = await req('PUT', '/api/coach/notes', { coach_openid: COACH.openid, student_openid: U1.openid, content: '探针笔记' });
    assert.equal(r.data.note.content, '探针笔记', '笔记写入');
    r = await req('GET', '/api/coach/notes?coach_openid=' + COACH.openid + '&student_openid=' + U1.openid);
    assert.equal(r.data.note.content, '探针笔记', '笔记读取');
    r = await req('GET', '/api/coach/student-lessons?coach_openid=' + COACH.openid + '&student_openid=' + U1.openid);
    assert.ok(Array.isArray(r.data.lessons), '跟课记录');
    const covMonth = `${timeMod.parts().y}-${String(timeMod.parts().mo).padStart(2, '0')}`;
    r = await req('GET', `/api/coach/settlement?coach_id=1&month=${covMonth}`);
    assert.ok(r.data.settlement && r.data.settlement.total_fen >= 0, '月度结算');
    r = await req('GET', '/api/coach/settlement?coach_id=1&month=2026-13');
    assert.equal(r.status, 400, '非法月份拒绝');

    // ---- 13.6 教练分配管理页（BUGS-INBOX #40）：列表 / 解绑探针 ----
    r = await req('GET', '/api/admin/coaches');
    assert.ok(Array.isArray(r.data.coaches) && Array.isArray(r.data.users), '教练分配列表');
    assert.equal(r.data.coaches.find(c => c.id === 1).user_openid, COACH.openid, '列表反映绑定');
    r = await req('POST', '/api/admin/coach-unassign', { coach_id: 1 });
    assert.equal(r.data.code, 200, '解绑教练');
    r = await req('POST', '/api/admin/coach-assign', { openid: COACH.openid, coach_id: 1 }); // 恢复绑定（后续探针依赖）
    assert.equal(r.data.code, 200, '重新绑定教练');
    // 用户级设/取消教练（DESIGN #D2）
    const R = { openid: 'uid_cov_role', nickname: '覆盖测试教练' };
    r = await req('POST', '/api/auth/login', R);
    assert.equal(r.status, 201, '注册R');
    r = await req('POST', '/api/admin/user-role', { openid: R.openid, role: 'coach' });
    assert.ok(r.data.coach_id >= 1, 'user-role 自动建档');
    r = await req('POST', '/api/admin/user-role', { openid: R.openid, role: 'student' });
    assert.equal(r.data.code, 200, 'user-role 取消教练');
    // 教练档案编辑（DESIGN #D2）：PUT 档案 + 课程「教练介绍」落库
    r = await req('PUT', '/api/admin/coaches/1', { name: '覆盖教练', skills: '探针技能', bio: '探针简介' });
    assert.equal(r.data.code, 200, 'PUT 教练档案');
    r = await req('PUT', `/api/courses/${course.id}`, { name: course.name || '覆盖测试课程', coach_bio: '课程保存探针简介' });
    assert.equal(r.data.code, 200, '课程保存教练介绍');
    r = await req('GET', '/api/admin/coaches');
    assert.equal(r.data.coaches.find(c => c.id === 1).bio, '课程保存探针简介', '教练 bio 已由课程写入');
    // ---- 13.7 B3 管理新接口（2026-08-18）：操作日志 / 到课率 / 数据导出探针 ----
    process.env.ADMIN_TOKEN = 'cov-admin';
    r = await req('GET', '/api/admin/logs', null, { 'Admin-Token': 'cov-admin' });
    assert.ok(Array.isArray(r.data.logs), '操作日志');
    r = await req('GET', '/api/admin/attendance?start=2026-01-01&end=2030-01-01', null, { 'Admin-Token': 'cov-admin' });
    assert.ok(r.data.summary && typeof r.data.summary.attended === 'number', '到课率汇总');
    r = await req('GET', '/api/admin/export/users', null, { 'Admin-Token': 'cov-admin' });
    assert.equal(r.status, 200, '学员导出');
    delete process.env.ADMIN_TOKEN;

    // ---- 14 候补复杂路径：排位 / 退订转正 / 退出退款 / 过期退款 ----
    // s4 动态 now+3h（B3 2026-08-18：固定 20:00 场次在 18:00 后跑探针会被退订截止拒绝，退订转正用例失效）
    const s4t = new Date(Date.now() + 3 * 3600 * 60000);
    const s4Date = `${timeMod.parts(s4t).y}-${pad2(timeMod.parts(s4t).mo)}-${pad2(timeMod.parts(s4t).d)}`;
    const s4Start = `${pad2(timeMod.parts(s4t).h)}:${pad2(timeMod.parts(s4t).mi)}`;
    const s4EndT = new Date(s4t.getTime() + 3600 * 60000);
    const s4End = `${pad2(timeMod.parts(s4EndT).h)}:${pad2(timeMod.parts(s4EndT).mi)}`;
    const s4 = db.db.prepare(
      "INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source) VALUES (?,1,1,?,?,?,1,0,'published','cov_suite')"
    ).run(course.id, s4Date, s4Start, s4End).lastInsertRowid;
    r = await req('POST', '/api/orders', { openid: U2.openid, sessionId: s4, amountFen: 8000, orderType: 'book' });
    assert.equal(r.status, 201, '订满下单');
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: U2.openid, payMethod: 'balance' });
    assert.equal(r.data.code, 200, '订满支付');
    r = await req('POST', '/api/waitlist', { openid: U3.openid, sessionId: s4, amountFen: 8000 });
    assert.equal(r.status, 201, '候补排位');
    const w3Id = r.data.wait.id;
    r = await req('GET', '/api/orders?openid=' + U2.openid);
    const s4Order = r.data.orders.find(o => o.session_id === s4 && o.status === 'paid');
    r = await req('DELETE', `/api/bookings/${s4Order.booking_id}?openid=${U2.openid}`);
    assert.equal(r.data.code, 200, '退订触发转正');
    r = await req('GET', '/api/waitlist?openid=' + U3.openid);
    const promoted = r.data.waits.find(w => w.id === w3Id);
    assert.equal(promoted && promoted.status, 'promoted', '候补转正');
    const W4 = { openid: 'uid_cov_u4', nickname: '覆盖测试D' };
    r = await req('POST', '/api/auth/login', W4);
    assert.equal(r.status, 201, '注册D');
    r = await req('POST', '/api/waitlist', { openid: W4.openid, sessionId: s4, amountFen: 8000 });
    assert.equal(r.status, 201, 'W4排位');
    const w4Id = r.data.wait.id;
    // DESIGN #D3 排位人数探针：U3 已转正，队列只剩 W4 → 总数 1、位置 0
    r = await req('GET', '/api/sessions/' + s4 + '?openid=' + W4.openid);
    assert.equal(r.data.session.waitlist_count, 1, 'D3 排队人数探针');
    assert.equal(r.data.session.my_wait_position, 0, 'D3 我的位置探针');
    r = await req('DELETE', `/api/waitlist/${w4Id}?openid=${W4.openid}`);
    assert.equal(r.data.code, 200, '退出候补退款');
    // 过期退款：造「今天已开始且满员」的场次，GET /api/waitlist 顺带触发 refundExpiredWaitlist
    const s5 = db.db.prepare(
      "INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source) VALUES (?,1,1,?,'00:00','01:00',1,1,'published','cov_suite')"
    ).run(course.id, todayStr).lastInsertRowid;
    r = await req('POST', '/api/waitlist', { openid: W4.openid, sessionId: s5, amountFen: 8000 });
    assert.equal(r.status, 201, '过期场次排位');
    r = await req('GET', '/api/waitlist?openid=' + W4.openid);
    const refundedW = r.data.waits.find(w => w.session_id === s5);
    assert.ok(refundedW && refundedW.status === 'refunded', '过期自动退款');

    console.log('覆盖率探针：核心链路全部通过 ✓');
  } finally {
    clean();
    server.close();
  }
});
