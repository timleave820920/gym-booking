/**
 * 综合训练馆订课系统 · 自动化测试脚本
 * 用法：node minitest/run-tests.js [BASE_URL]
 * 默认 BASE_URL: http://127.0.0.1:3000
 * 自动创建/清理测试数据（uid_test_* 前缀）
 *
 * 干净库模式：设置 DB_PATH 环境变量后，脚本自管生命周期——
 *   ① 删除旧临时库 → ② seed 基础数据 → ③ 起独立端口后端 → ④ 跑测试 → ⑤ 杀进程+删库
 *   不依赖外部后端、不污染共享开发库（schema 类 bug 本地即可抓，见 BUG-LEDGER #1）
 */
let BASE = process.argv[2] || 'http://127.0.0.1:3000';
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const PROJECT_ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || null;
// 管理访问码（BUGS-INBOX #8）：进程配置 ADMIN_TOKEN 时 req 默认自动带头。
// 干净库模式强制开启（默认 test-admin-token 注入后端，req 同步带头），
// 保证现有管理写操作用例通过 + 新增 ADMIN 用例可测 401；普通模式不设则行为不变
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (DB_PATH ? 'test-admin-token' : '');

// ===== 轻量 HTTP 客户端 =====
// opts: { noToken: true 不带默认 Admin-Token; headers: {...} 附加/覆盖 header }
function req(method, path, body, opts) {
  return new Promise((resolve, reject) => {
    // opts.base 覆盖默认后端（WX-M 独立 mock 后端用，2026-08-18）
    const base = (opts && opts.base) || BASE;
    const url = base + path;
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? require('node:https') : require('node:http');
    const payload = body ? JSON.stringify(body) : null;
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    if (ADMIN_TOKEN && !(opts && opts.noToken)) headers['Admin-Token'] = ADMIN_TOKEN;
    if (opts && opts.headers) Object.assign(headers, opts.headers);
    const options = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers
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
// 日期/时间统一取北京时间（time.js 显式时区），保证测试在任何系统时区
// （本地 Windows / CI UTC / 模拟容器 TZ=UTC）下与后端判定口径一致（BUG-LEDGER #28）
const timeMod = require('../server/time.js');
const todayStr = timeMod.todayStr();
const _tm = timeMod.parts(new Date(Date.now() + 86400000));
const tomorrowStr = `${_tm.y}-${String(_tm.mo).padStart(2, '0')}-${String(_tm.d).padStart(2, '0')}`;
const beijingHM = (d) => { const p = timeMod.parts(d); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };

// 运行时状态
const ctx = {
  bookingId: null, orderId: null, waitId: null, sessionId: null,
  fullSessionId: null, checkedBookingId: null, paidOrderId: null,
  tomorrowSessionId: null, promotedWaitId: null
};

async function main() {
  // ===== 干净库模式（DB_PATH 设置时）：自管临时库 + 独立后端生命周期 =====
  let child = null;
  let logPath = null; // 后端日志落盘路径（if(DB_PATH) 块内赋值，finally 块内读取——必须提升到函数级作用域）
  if (DB_PATH) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(DB_PATH + suffix, { force: true }); } catch (e) {}
    }
    console.log(`[干净库模式] 临时库: ${DB_PATH}`);
    // ① seed 基础数据（教练/场地/课程等，测试用例依赖）
    // timeout 60s：MySQL 模式 seed 挂起检测（2026-08-18 CI test-mysql 首次跑全量即无限挂起，
    // spawnSync 无超时则 run-tests.js 永远等；超时即打印尾部输出定位挂点）
    const seedRes = spawnSync(process.execPath, ['server/seed.js'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DB_PATH },
      encoding: 'utf8',
      timeout: 60000
    });
    if (seedRes.error && seedRes.error.code === 'ETIMEDOUT') {
      console.error('✖ [干净库模式] seed 超时（60s）——疑似 MySQL 连接挂起:\n' + (seedRes.stdout || '').slice(0, 800));
      process.exit(2);
    }
    if (seedRes.status !== 0) {
      console.error('✖ [干净库模式] seed 失败:\n' + (seedRes.stderr || seedRes.stdout || '').slice(0, 800));
      process.exit(2);
    }
    // ② 独立端口起后端（不与开发中的 3000 冲突）
    // 后端日志落盘（stdio:'ignore' 曾致 CI test-mysql 失败时 [server error] 完全不可见，2026-08-18 排障教训：
    // 无法判断 500 是业务错还是连接池挂起——测试失败/启动失败时打印尾部定位）
    logPath = require('node:path').join(require('node:os').tmpdir(), `gym-backend-${process.pid}.log`);
    const logFd = fs.openSync(logPath, 'w');
    const port = 3100 + Math.floor(Math.random() * 500);
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DB_PATH, PORT: String(port), WX_APPID: 'test_appid', WX_SECRET: 'test_secret', ADMIN_TOKEN, PAY_MOCK: '0' },
      stdio: ['ignore', logFd, logFd]
    });
    BASE = `http://127.0.0.1:${port}`;
    // ③ 健康检查轮询（最多 20 秒）
    let up = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(BASE + '/api/health');
        if (res.ok) { up = true; break; }
      } catch (e) {}
      await new Promise(res => setTimeout(res, 500));
    }
    if (!up) {
      console.error(`✖ [干净库模式] 后端启动失败（端口 ${port}）`);
      try {
        console.error('--- 后端日志尾部 ---\n' + fs.readFileSync(logPath, 'utf8').split('\n').slice(-20).join('\n'));
      } catch (e) {}
      child.kill();
      process.exit(2);
    }
    console.log(`[干净库模式] 后端就绪: ${BASE}`);
  }

  let suiteFailed = 0;
  try {
    suiteFailed = await runSuite();
  } catch (e) {
    suiteFailed = 1; // 异常也视为失败：触发后端日志尾部打印后原样抛出
    throw e;
  } finally {
    // ④ 清理：杀后端 + 删临时库（进程内 require 的 db 也指向临时库，一并释放）
    // 测试失败时打印后端日志尾部（排障利器：500 时 [server error] 可见，判断业务错 vs 连接池挂起）
    if (suiteFailed > 0 && child && logPath) {
      try {
        console.error('\n--- 后端日志尾部（最近 40 行）---\n' + fs.readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n') + '\n--- 日志完毕 ---');
      } catch (e) {}
    }
    if (child) child.kill();
    if (DB_PATH) {
      await new Promise(res => setTimeout(res, 300)); // 等子进程释放 SQLite 文件锁
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.rmSync(DB_PATH + suffix, { force: true }); } catch (e) {}
      }
      console.log('[干净库模式] 后端已停止，临时库已删除');
    }
  }

  // 正常失败路径也强制退出：MySQL 模式 mysql2 连接池句柄阻塞自然退出（仅设 exitCode 会挂到 CI 超时，
  // BUG-LEDGER #60：2026-08-18 test-mysql 失败后 10 分钟超时的直接根因；异常路径由 main().catch process.exit(2) 兜底，
  // 放 try/catch 之后保证异常堆栈先打印再退出）
  process.exit(suiteFailed > 0 ? 1 : 0);
}

async function runSuite() {
  console.log(`\n========== 综合训练馆订课系统 自动化测试 ==========`);
  console.log(`目标: ${BASE} ｜ 开始: ${new Date().toLocaleString()}\n`);

  // 预清理上次残留的测试数据（保证用例可重复执行）
  // 直查统一走 driver（DESIGN #D5 起双驱动跑全量：SQLite 模式同一连接行为不变，MySQL 模式连真库）
  try {
    const db = require('../server/db.js');
    await db.driver.run("DELETE FROM orders WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM user_passes WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM course_sessions WHERE source='test_suite'");
    await db.driver.run("DELETE FROM coin_logs WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM coin_exchanges WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM member_recharges WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM invitations WHERE inviter LIKE 'uid_test_%' OR invitee LIKE 'uid_test_%'");
    for (const o of ['uid_test_tianli','uid_test_student2','uid_test_coach','uid_test_holder']) {
      const u = await db.findUserByOpenid(o);
      if (u) await db.deleteUserById(u.id);
    }
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

  // ===== 0.5 时间模块（防时区回归，BUG-LEDGER #28）=====
  // 断言与系统时区无关：UTC 纪元 → 北京应为 08:00；任意系统时区下结果一致。
  // 若 time.js 被回退成隐式系统时区（如裸 new Date().getHours()），UTC 环境（CI/云托管）会红。
  console.log('\n── 1.5 时间模块（北京时间）──');
  const timeMod = require('../server/time.js');
  const epoch = timeMod.parts(new Date(0)); // 1970-01-01T00:00:00Z
  check('TIME-01', '纪元UTC0点=北京8点', epoch.h === 8 && epoch.mi === 0 && epoch.y === 1970, `h=${epoch.h} mi=${epoch.mi}`);
  const beijingParts = timeMod.parts();
  const tsNow = Date.now();
  const bjMin = beijingParts.h * 60 + beijingParts.mi;
  const utcMin = new Date(tsNow).getUTCHours() * 60 + new Date(tsNow).getUTCMinutes();
  const diff = (((bjMin - (utcMin + 480)) % 1440) + 1440) % 1440; // 北京 - (UTC+8)，归一化
  check('TIME-02', '北京=UTC+8（误差<2分钟）', diff <= 2 || diff >= 1438, `bj=${bjMin} utc=${utcMin} diff=${diff}`);
  const roundTrip = timeMod.parseBeijing(timeMod.nowDateTimeStr()).getTime();
  check('TIME-03', 'nowDateTimeStr↔parseBeijing 往返<5分钟', Math.abs(roundTrip - tsNow) < 5 * 60 * 1000, `delta=${Math.abs(roundTrip - tsNow) / 1000}s`);
  check('TIME-04', '签到窗口判定用北京分钟', timeMod.nowMin() === bjMin, `nowMin=${timeMod.nowMin()} bj=${bjMin}`);

  // ===== 1.6 MySQL 驱动静态检查（防 #29 回退，BUG-LEDGER #29）=====
  // 本地/CI 无 MySQL，MySQL 路径无法真连测试；做源码级断言兜底：
  // connection 事件转发的是 callback 版连接，对其 query 结果 .catch() 会命中
  // Query.prototype.catch = then（mysql2 防误用），打印警告 + throw → 建表永久挂起、容器 CrashLoop。
  // 修复后必须保持 callback 风格：conn.query(sql, () => {})
  const driverSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'db-driver.js'), 'utf8');
  console.log('\n── 1.6 MySQL 驱动静态检查（BUG-LEDGER #29 防回归）──');
  check('MYSQL-01', 'mysql2 走 promise 入口', /require\('mysql2\/promise'\)/.test(driverSrc), 'db-driver.js 需 require("mysql2/promise")');
  check('MYSQL-02', 'connection 事件 query 为 callback 风格', driverSrc.includes(`conn.query("SET time_zone = '+08:00'", () => {});`), 'connection 回调须 callback 风格');
  check('MYSQL-03', '无 promise 风格 .catch 残留', !driverSrc.includes(`SET time_zone = '+08:00'").catch(`), '禁止 conn.query(...).catch(...) 写法');
  // MYSQL-04/05：MySQL 建表 DDL 方言防回归（BUG-LEDGER #31：VARCHAR(19) DEFAULT (CURRENT_TIMESTAMP)
  // 是 SQLite 写法，MySQL 只允许 TIMESTAMP/DATETIME 列用时间默认值 → 生产首次建表 CrashLoop）
  const schemaSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'mysql-schema.js'), 'utf8');
  check('MYSQL-04', 'mysql-schema 无 VARCHAR+CURRENT_TIMESTAMP 默认残留', !/VARCHAR\(\d+\)[^\n]*CURRENT_TIMESTAMP/.test(schemaSrc), '时间默认值列须 DATETIME 类型');
  check('MYSQL-05', '驱动 dateStrings: true（DATETIME 字符串返回契约）', /dateStrings:\s*true/.test(driverSrc), 'DATETIME 列须以字符串返回，应用层按 YYYY-MM-DD HH:MM:SS 解析');
  // MYSQL-06：DDL 无裸保留字列名（BUG-LEDGER #32：coin_logs.change / course_sessions.date / users.role 是
  // MySQL 保留字，SQLite 不保留 → 本地全绿、生产建表 ER_PARSE_ERROR。反引号是 SQLite/MySQL 双兼容标识符）
  const schemaBody = /const MYSQL_SCHEMA = `([\s\S]*?)`;/.exec(schemaSrc)?.[1] || '';
  check('MYSQL-06', 'mysql-schema DDL 无裸保留字 date/change/role', !/(^|[^.\w`])(date|change|role)(?![\w`(])/m.test(schemaBody), '保留字列名须反引号包裹或点限定');
  // MYSQL-07：业务 SQL 不得用 SQLite 函数 last_insert_rowid()（MySQL 无此函数；INSERT 后用 run() 返回值传参，
  // 池模式下 LAST_INSERT_ID() 跨连接不可靠，传参是双方言唯一正确解）
  const lastIdFiles = ['bookings', 'coin', 'orders', 'passes'];
  check('MYSQL-07', '业务 SQL 无 last_insert_rowid()（须用 run() 返回值传参）', lastIdFiles.every(f => !fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'db', f + '.js'), 'utf8').includes('last_insert_rowid')), 'INSERT 后取 id 用 run() 的 lastInsertRowid 字段');
  // MYSQL-08：seed.js CLI 分支成功路径显式退出（BUG-LEDGER #34：MySQL 连接池是活跃句柄，
  // 独立跑 seed 不退出则进程挂起；CLI 分支必须 process.exit，容器内改为 index.js 进程内调用 run()）
  const seedSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'seed.js'), 'utf8');
  check('MYSQL-08', 'seed.js CLI 分支成功路径 process.exit(0)', /process\.exit\(0\)/.test(seedSrc), '独立跑 seed 完成须显式退出（MySQL 连接池句柄阻塞进程退出）');
  // MYSQL-09：seed 内联进 index.js 启动链路（#34 加固：禁止回退到阻塞式 `seed.js && index.js` CMD——
  // seed 挂起会让 index 永不启动、探针 refused、部署回滚；listen 先行 + 进程内幂等种子才稳）
  const indexSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'index.js'), 'utf8');
  check('MYSQL-09', 'index.js 启动段进程内调用 seed.run()（listen 先行，种子不阻塞启动）', /require\('\.\/seed'\)\.run\(\)/.test(indexSrc), 'seed 必须由 index.js 在 driver.ready 后进程内幂等执行');
  // MYSQL-10：MySQL 老库幂等补列清单覆盖关键新列（BUG-LEDGER #48：昨晚重构新增列只进了 mysql-schema
  // 新库 DDL + SQLite ALTER，MySQL 侧补列仅 checkin_code——生产老表缺列，新代码上线订课/候补/
  // 场次详情全 500。清单须与 mysql-schema.js 同源，防"SQLite 加了列 MySQL 忘记补"再演）
  check('MYSQL-10', 'MySQL 补列清单覆盖 courses.images / bookings.pay_source / waitlist.expire_mode / orders.pay_source',
    ["['images', \"VARCHAR(2000) DEFAULT '[]'\"]", "['pay_source', \"VARCHAR(16) DEFAULT 'wxpay'\"]", "['expire_mode', \"VARCHAR(16) DEFAULT 'start'\"]"].every(s => driverSrc.includes(s)),
    'db-driver.js MYSQL_ENSURE_COLUMNS 须与 mysql-schema.js 同步维护（新增列三处同步）');
  // MYSQL-11：无限次卡表双方言建表防回退（DESIGN #D14：unlimited_plans/unlimited_passes 的 MySQL DDL
  // 必须存在且含反引号 type（保留字）+ idx_unl_pass_user 索引；缺一 SQLite 绿、MySQL 上线 500）
  check('MYSQL-11', 'mysql-schema 含 unlimited_plans/unlimited_passes DDL（反引号 type + 用户索引）',
    /CREATE TABLE IF NOT EXISTS `?unlimited_plans`?[\s\S]{0,600}CREATE TABLE IF NOT EXISTS `?unlimited_passes`?/.test(schemaSrc)
      && /\\`type\\`\s+VARCHAR\(16\)/.test(schemaSrc)
      && /idx_unl_pass_user/.test(schemaSrc),
    'mysql-schema.js 须建 unlimited 两表：type 列反引号（保留字，模板字符串内为 \\`type\\`）+ idx_unl_pass_user 索引（DESIGN #D14）');
  // FRONT-01/02：订课后页面状态刷新防回退（BUG-LEDGER #35：详情页/首页缺 onShow 刷新，
  // 订完课从支付页返回仍显示「立即预订/预约」——服务端数据已正确，纯前端展示问题）
  const detailSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-course-detail', 'index.js'), 'utf8');
  check('FRONT-01', '课程详情页 onShow 刷新预约状态（#35 防回退）', /onShow\(\)[\s\S]{0,120}loadSession\(this\._sessionId\)/.test(detailSrc), '详情页必须 onShow 重新拉取场次（订完课返回按钮状态才更新）');
  const activitySrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-activity', 'index.js'), 'utf8');
  check('FRONT-02', '首页 onShow 刷新今日课程（#35 防回退）', /onShow\(\)[\s\S]*?this\.loadTodayCourses\(\)/.test(activitySrc), '首页必须 onShow 重新拉取今日课程（订完课返回卡片状态才更新）');
  // FRONT-03/04 已随 DESIGN #D13 移除：学员凭证页（student-checkin）整页删除，改场馆固定码自助签到
  // （#38/#39 画码 bug 的载体页面不存在了；防回退由 FRONT-33 的「凭证页不在 app.json」断言接管）
  // 教练端切学员端按钮（DESIGN #D2：会话内切换，不动 role，下次登录仍按身份分流）
  const chHomeSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-home', 'index.js'), 'utf8');
  const chHomeWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-home', 'index.wxml'), 'utf8');
  check('FRONT-05', '教练端有「切学员端」且 reLaunch 学员首页、不写 role（#D2 防回退）',
    /goStudentView/.test(chHomeWxml) && /goStudentView\(\) \{\s*wx\.reLaunch\(\{ url: '\/pages\/student-courses\/index' \}\)/.test(chHomeSrc) && !/setStorageSync\('userInfo'/.test(chHomeSrc.slice(chHomeSrc.indexOf('goStudentView'))),
    '按钮必须存在；切换只 reLaunch 不改身份，否则下次登录分流错乱');
  // 退出按钮下显示当前 openid（管理页绑定教练核对用）
  const pfWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-profile', 'index.wxml'), 'utf8');
  const pfSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-profile', 'index.js'), 'utf8');
  check('FRONT-06', '退出登录按钮下有 openid 小字（学员端+教练端）',
    /openid：\{\{openid\}\}/.test(pfWxml) && /openid: user\.openid \|\| wx\.getStorageSync\('openid'\) \|\| ''/.test(pfSrc) && /openid-hint/.test(chHomeWxml),
    '两处退出按钮下必须展示当前账号 openid，方便管理页核对绑定');
  // 2026-08-17 用户指令：代码中不再出现 demo_user 兜底身份（登录链路曾静默回退 demo_user）
  const loginSrc2 = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'login', 'index.js'), 'utf8');
  const fakeSeedSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'seed-fake-users.js'), 'utf8');
  const indexSrc2 = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'index.js'), 'utf8');
  check('FRONT-07', '登录链路无 demo_user 兜底（登录页/造数脚本/后端登录处理）',
    !/demo_user/.test(loginSrc2) && !/demo_user/.test(fakeSeedSrc)
      && /微信登录校验失败/.test(indexSrc2) && !/demo_user/.test(indexSrc2),
    '正式登录换号失败必须 400 报错重试；任何活跃代码不得再出现 demo_user 作为登录兜底身份');
  check('FRONT-08', '微信 API 白名单 TLS 适配（#46 防回退：仅白名单关校验）',
    /WECHAT_API_HOSTS = new Set\(\[['"]api\.weixin\.qq\.com['"], ['"]api\.mch\.weixin\.qq\.com['"]\]\)/.test(indexSrc2)
      && /rejectUnauthorized: !WECHAT_API_HOSTS\.has\(new URL\(url\)\.hostname\)/.test(indexSrc2),
    '云托管网关自签证书：白名单关校验必须显式限定微信官方域名；白名单外保持默认严格校验');
  // B2（2026-08-18）：支付链路无「模拟支付」残留——微信支付必须走统一下单 + requestPayment + 轮询回调落库
  const paySrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-pay', 'index.js'), 'utf8');
  const rechargeSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'member-recharge', 'index.js'), 'utf8');
  const apiSrc2 = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'utils', 'api.js'), 'utf8');
  check('FRONT-09', '微信支付真实链路防回退（模拟支付已除根）',
    !/模拟支付|演示支付|demo.?pay/i.test(paySrc) && !/模拟支付|演示支付|demo.?pay/i.test(rechargeSrc)
      && /wxpayCreate/.test(apiSrc2) && /wxpayStatus/.test(apiSrc2)
      && /wx\.requestPayment/.test(paySrc) && /wx\.requestPayment/.test(rechargeSrc)
      && /pollPaid/.test(paySrc) && /pollPaid/.test(rechargeSrc),
    'B2 支付预研：微信支付必须走统一下单→requestPayment→轮询回调落库；禁止回退模拟支付');
  check('FRONT-10', '支付页/充值页未开通商户号禁用微信支付（B2 防回退）',
    /wxpayEnabled/.test(paySrc) && /商户号配置后开放/.test(paySrc)
      && /wxpayEnabled/.test(rechargeSrc) && /商户号配置后开放/.test(rechargeSrc),
    '商户号未配置 → 微信支付选项/充值按钮禁用并明示「商户号配置后开放」');
  // B3（2026-08-18）：课程搜索（本地过滤）+ 退订截止提示（课前 2 小时）
  const coursesSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-courses', 'index.js'), 'utf8');
  const myCoursesSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-my-courses', 'index.js'), 'utf8');
  check('FRONT-11', '课程搜索防回退（本地过滤 name/coach/description）',
    /searchKeyword/.test(coursesSrc) && /onSearchInput/.test(coursesSrc) && /refreshSearch/.test(coursesSrc),
    '课程列表页搜索框：输入即按 name/coach/description 本地过滤，清除恢复全量');
  check('FRONT-12', '退订截止提示防回退（开课前 2 小时内不可退订/退出候补）',
    /开课前 2 小时内不可退订/.test(myCoursesSrc) && /开课前 2 小时内不可退出/.test(myCoursesSrc),
    '退订/退出候补确认弹窗需明示截止规则（2026-08-18 用户拍板）');
  // DESIGN #D3 排位人数可视化防回退：详情页按钮下 waitlist-hint、我的课程页 wait-pos 位置、
  // 首页满员按钮排队人数（waitlistCount 透传）——任一被删则断言红
  const d3DetailWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-course-detail', 'index.wxml'), 'utf8');
  const d3MyCoursesWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-my-courses', 'index.wxml'), 'utf8');
  check('FRONT-17', '排位人数展示防回退（详情页/我的课程页/首页卡片，DESIGN #D3）',
    /waitlist-hint/.test(d3DetailWxml) && /您前面还有/.test(d3DetailWxml) && /当前.*人排队中/.test(d3DetailWxml)
      && /wait-pos/.test(d3MyCoursesWxml) && /前面还有/.test(d3MyCoursesWxml)
      && /waitlistCount/.test(coursesSrc),
    'DESIGN #D3：详情页排位提示（前面还有 N 人/当前 N 人排队中）、我的课程页位置、首页满员按钮人数');
  // DESIGN #D4 运营数据 web tab 防回退：tab 改名、loadDashboard 存在、canvas 趋势图、
  // 7 KPI 卡 + 4 组折叠卡结构（任一被删则断言红）
  const webHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'web', 'courses.html'), 'utf8');
  check('FRONT-18', 'web 运营数据 tab 防回退（DESIGN #D4）',
    /运营数据/.test(webHtml) && /function loadDashboard/.test(webHtml) && /id="dashTrend"/.test(webHtml)
      && /class="dash-kpi"/.test(webHtml) && /fold-revenue/.test(webHtml) && /fold-courses/.test(webHtml)
      && /dk-dormant/.test(webHtml),
    'DESIGN #D4：tab 改「运营数据」、loadDashboard、canvas 趋势图、7 KPI 卡、4 组折叠卡');
  check('FRONT-19', 'web 用户分析防回退（DESIGN #D4-3：RMF 清单/时间线/触达）',
    /function uaLoad/.test(webHtml) && /uaTimeline/.test(webHtml)
      && /ua-msgbox/.test(webHtml) && /uaSendMsg/.test(webHtml) && /uaExport/.test(webHtml),
    '用户分析：筛选清单 uaLoad、时间线钻取 uaTimeline、群组触达 uaSendMsg、CSV uaExport');
  // DESIGN #D5-5 浏览分析折叠卡 + 画像列防回退：⑥ 折叠卡（漏斗/意图/搜索词/热度）+ 用户表画像列 + CSV 画像列
  const uaSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'db', 'users-analysis.js'), 'utf8');
  check('FRONT-22', 'web 浏览分析+画像列防回退（DESIGN #D5-5）',
    /fold-events/.test(webHtml) && /function evLoad/.test(webHtml)
      && /ev-intent/.test(webHtml) && /ev-search/.test(webHtml) && /ev-hot/.test(webHtml) && /ev-f-expose/.test(webHtml)
      && /u\.gender/.test(webHtml) && /u\.birthday/.test(webHtml)
      && /u\.gender, u\.birthday/.test(uaSrc)
      && /'性别', '生日'/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'index.js'), 'utf8')),
    '⑥ 浏览分析折叠卡（漏斗 mini-metrics + 意图人群 + 搜索词 + 热度）；用户分析表/CSV 含性别生日画像列');
  // DESIGN #D6 运营日报防回退：折叠卡（日期选择+重新生成）+ loadReport 渲染（总结/网格/趋势/建议）+ 后端路由
  const repSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'db', 'report.js'), 'utf8');
  check('FRONT-23', 'web 运营日报防回退（DESIGN #D6：折叠卡/重新生成/规则引擎）',
    /fold-report/.test(webHtml) && /function loadReport/.test(webHtml)
      && /rep-summary/.test(webHtml) && /rep-metrics/.test(webHtml) && /rep-trends/.test(webHtml) && /rep-actions/.test(webHtml)
      && /admin\/reports/.test(webHtml) && /regenerate/.test(webHtml)
      && /getDailyReport/.test(repSrc) && /regenerateReport/.test(repSrc) && /listReports/.test(repSrc)
      && /daily_reports/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'db-core.js'), 'utf8')),
    '📋 运营日报折叠卡（日期选择+查询+重新生成）、loadReport 渲染（一句话总结/关键数据网格/趋势/行动建议）、后端规则引擎接口');
  // BUGS-INBOX #58 防回退：四 tab 顺序 运营数据/课程设定/排课系统/教练分配 + 默认打开「运营数据」
  // （tab-board 在 HTML 中先于 tab-set 声明 = 顺序正确；init 末尾调 switchTab('board') = 默认打开）
  check('FRONT-24', '后台四 tab 顺序+默认运营数据防回退（BUGS-INBOX #58）',
    /<button class="tab active" id="tab-board"[^>]*>运营数据</.test(webHtml)
      && /id="tab-set"[^>]*>课程设定</.test(webHtml)
      && /id="tab-sch"[^>]*>排课系统</.test(webHtml)
      && /id="tab-coach"[^>]*>教练分配</.test(webHtml)
      && webHtml.indexOf("switchTab('board')") < webHtml.indexOf("switchTab('set')")
      && /switchTab\('board'\);/.test(webHtml),
    'nav 顺序：运营数据(active)/课程设定/排课系统/教练分配；「排表管理」更名「排课系统」；init 默认 switchTab(board)');
  // DESIGN #D12 缺席标记防回退：已完成未签到 → 灰色「缺席」标签（done-absent）；已签到「已签到 ✓」不变
  check('FRONT-31', '缺席标记防回退（DESIGN #D12：已完成未签到显示「缺席」）',
    /缺席/.test(d3MyCoursesWxml) && /done-absent/.test(d3MyCoursesWxml)
      && /已签到 ✓/.test(d3MyCoursesWxml) && /done-checked/.test(d3MyCoursesWxml),
    'DESIGN #D12：已完成卡未签到 → 灰色圆角「缺席」标签；已签到「已签到 ✓」不变');
  // DESIGN #D10 排课发布节奏防回退：预约页未来空课日占位文案 + 前端拉取/未来日判定 + 后端路由
  const coursesWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-courses', 'index.wxml'), 'utf8');
  check('FRONT-32', '排课发布占位防回退（DESIGN #D10：未来空课日显示发布占位）',
    /课表将于本周五/.test(coursesWxml) && /nextPublishText/.test(coursesWxml)
      && /新一周课表发布后即可预约/.test(coursesWxml) && /isFutureDay/.test(coursesWxml)
      && /loadNextPublish/.test(coursesSrc) && /api\.getNextPublish/.test(coursesSrc)
      && /schedule\/next-publish/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'index.js'), 'utf8')),
    'DESIGN #D10：未来空课日 → 「课表将于本周五（x月x日 22:00）更新」+ 副文案；isFutureDay/loadNextPublish 存在；后端路由注册');
  // DESIGN #D13 固定二维码自助签到防回退：签到页三态 + app.json 注册且旧核销页移除 + 教练端核销入口移除 + web 签到码区块 + 后端三接口
  const checkinWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'checkin', 'index.wxml'), 'utf8');
  const checkinJs = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'checkin', 'index.js'), 'utf8');
  const appJsonSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'app.json'), 'utf8');
  const coachHomeJs = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-home', 'index.js'), 'utf8');
  const coachStudentsWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-students', 'index.wxml'), 'utf8');
  const coachScheduleWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-schedule', 'index.wxml'), 'utf8');
  const webCoursesSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'web', 'courses.html'), 'utf8');
  check('FRONT-33', '自助签到防回退（DESIGN #D13：签到页三态 + 核销入口移除 + web 签到码）',
    /pages\/checkin\/index/.test(appJsonSrc) && !/coach-scan|student-checkin/.test(appJsonSrc)
      && /签到成功/.test(checkinWxml) && /检测到多节可签到课程/.test(checkinWxml) && /确认签到/.test(checkinWxml)
      && /decodeURIComponent/.test(checkinJs) && /scene !== 'checkin'/.test(checkinJs)
      && /api\.checkinScan/.test(checkinJs) && /api\.checkinSelect/.test(checkinJs)
      && !/checkin-code/.test(coachHomeJs) && !/扫码签到/.test(coachStudentsWxml) && !/goScan/.test(coachScheduleWxml)
      && /fold-checkin-qr/.test(webCoursesSrc) && /loadCheckinQr/.test(webCoursesSrc)
      && /api\/checkin\/scan/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'index.js'), 'utf8'))
      && /api\/checkin\/select/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'index.js'), 'utf8'))
      && /api\/admin\/checkin-qr/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'index.js'), 'utf8')),
    'DESIGN #D13：签到页三态（invalid/none/multi/done）+ 旧核销页移除 + 教练端核销入口全移除 + web 后台签到码区块 + 后端三接口');
  // DESIGN #D5 浏览埋点防回退：首页 page_view 曝光/搜索词、详情 course_view 停留时长（onHide/onUnload 上报）
  const d5DetailJs = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-course-detail', 'index.js'), 'utf8');
  check('FRONT-20', '浏览埋点防回退（DESIGN #D5：首页曝光/搜索词/详情停留时长）',
    /require\('\.\.\/\.\.\/utils\/track\.js'\)/.test(coursesSrc)
      && /track\.pageView\('home'\)/.test(coursesSrc) && /track\.search\(/.test(coursesSrc)
      && /searchKeyword \? 'search' : 'home'/.test(coursesSrc)
      && /require\('\.\.\/\.\.\/utils\/track\.js'\)/.test(d5DetailJs)
      && /track\.courseView\(/.test(d5DetailJs) && /reportCourseView/.test(d5DetailJs),
    '首页 page_view 曝光+search 关键词、详情 course_view 停留时长（onHide/onUnload 上报）');
  // DESIGN #D5-3 画像卡防回退：我的页有画像卡（性别三选+生日 picker+保存），保存走 PUT /api/me/profile
  check('FRONT-21', '我的页画像卡防回退（DESIGN #D5-3：性别/生日/20 能量币）',
    /profile-card/.test(pfWxml) && /onGenderTap/.test(pfWxml) && /onBirthdayChange/.test(pfWxml)
      && /saveProfile/.test(pfWxml)
      && /getMyProfile\(/.test(pfSrc) && /updateMyProfile\(/.test(pfSrc)
      && /完善画像奖励/.test(pfSrc),
    '画像卡须含性别三选/生日 picker/保存按钮；JS 加载 GET 画像并 PUT 保存（首次奖励提示）');
  // 2026-08-18 一次性画像卡（#59 转需求，用户拍板）：保存后整卡隐藏（wx:if 含 !profileSaved || profileEditing），
  // 仅留「资料设置」入口行（openProfileEditor）展开编辑——PIPL 更正权
  check('FRONT-21b', '一次性画像卡防回退（保存后隐藏+轻量入口）',
    /!profileSaved \|\| profileEditing/.test(pfWxml) && /profile-entry/.test(pfWxml)
      && /profileSaved && !profileEditing/.test(pfWxml)
      && /openProfileEditor/.test(pfSrc) && /profileEditing: false/.test(pfSrc),
    '画像卡 wx:if 须含 !profileSaved||profileEditing（保存后隐藏）；入口行 profile-entry + openProfileEditor 展开');
  // 2026-08-18 UI 统一批（BUG-LEDGER #51/#53/#54/#55）：后退按钮统一 back-wrap 箭头；
  // 分享必须用 button open-type="share"（view 不触发转发）；低版本基础库降级相册；等级页文案
  const detailWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-course-detail', 'index.wxml'), 'utf8');
  const coachPfWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-profile', 'index.wxml'), 'utf8');
  const coachPfWxss = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-profile', 'index.wxss'), 'utf8');
  const levelWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'member-level', 'index.wxml'), 'utf8');
  check('FRONT-13', '课程详情页仅中部 share-btn 为 button open-type=share，顶部 share-round 已移除（#53 防回退）',
    /<button class="share-btn" open-type="share">/.test(detailWxml)
      && !/share-round/.test(detailWxml),
    '分享必须放在 button 组件上（open-type 仅 button 生效）；顶部圆钮分享已于 2026-08-19 按用户要求移除');
  check('FRONT-14', '低版本基础库换头像自动降级相册（#54 防回退）',
    /if \(!wx\.chooseAvatar\)[\s\S]{0,220}this\.chooseLocalImage\(\)/.test(pfSrc),
    '无 chooseAvatar（基础库<2.21.2）不得报错阻断，须降级相册选图保证仍可换头像');
  check('FRONT-15', '教练详情页返回按钮统一 icon-back 箭头（#51 防回退）',
    !/‹/.test(coachPfWxml) && /icon-back/.test(coachPfWxml) && /icon-back/.test(coachPfWxss),
    'cp-back 不得用字符箭头（‹），须用全局统一 icon-back SVG 箭头');
  check('FRONT-16', '会员等级页文案「任意储值」（#55/#56）',
    /任意储值/.test(levelWxml) && !/0 节课起/.test(levelWxml)
      && /任意储值成为会员，多上课程升级会员/.test(levelWxml),
    '青铜档条件文案改「任意储值」；等级权益区有储值/上课升级引导语');
  const coachPfSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-profile', 'index.js'), 'utf8');
  check('FRONT-17', '教练详情页生活照走 toFullUrl（云托管模式拼公网域名显示，防裂图）',
    /life_photo: api\.toFullUrl\(c\.life_photo\)/.test(coachPfSrc),
    'life_photo 后端存相对路径（本地）或完整 COS URL（生产），必须 toFullUrl 转换才能显示');
  const loginWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'login', 'index.wxml'), 'utf8');
  const loginSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'login', 'index.js'), 'utf8');
  check('FRONT-25', '登录页已登录用户启动直跳防闪屏（booted 守卫 + autoEnterImmediate 本地即跳）',
    /wx:if="\{\{booted\}\}"/.test(loginWxml)
      && /booted: false/.test(loginSrc)
      && /autoEnterImmediate/.test(loginSrc)
      && /api\.checkLogin/.test(loginSrc),
    '完整注册用户重启不得闪现登录页；本地立即跳转 + 后端校验兜底（清库回登录页）缺一不可');
  // 2026-08-19 活动中心子页顶部统一批：custom 导航 + 返回钮与教练详情页一致（72rpx 圆形白半透明毛玻璃）+ 标题居中 44rpx/800（同预约页「早上好」）
  const NAV_PAGES = ['member-level', 'member-recharge', 'invite', 'passes-buy', 'coin-shop', 'about-us', 'honors'];
  const navAllOk = NAV_PAGES.every((p) => {
    const j = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', p, 'index.json'), 'utf8'));
    const w = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', p, 'index.wxml'), 'utf8');
    const s = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', p, 'index.wxss'), 'utf8');
    const js = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', p, 'index.js'), 'utf8');
    return j.navigationStyle === 'custom'
      && /class="nav-bar"[^>]*style="padding-top: \{\{statusBarH\}\}px;"/.test(w)
      && w.indexOf('nav-bar') < w.indexOf('page-pad')          // nav-bar 须在 page-pad 之前（独立顶部导航区）
      && /class="nav-back"[^>]*bindtap="goBack"/.test(w)
      && /class="nav-title"/.test(w)
      && /\.nav-back\s*\{[^}]*border-radius:\s*50%/.test(s)
      && /\.nav-title\s*\{[^}]*text-align:\s*center/.test(s)
      && /font-size:\s*44rpx;\s*font-weight:\s*800/.test(s)
      && /\.nav-bar\s*\{[^}]*align-items:\s*flex-start/.test(s)
      && /\.nav-title\s*\{[^}]*line-height:\s*1/.test(s)
      && /\.nav-title\s*\{[^}]*margin-top:\s*8px/.test(s)
      && /\.pt-safe\s*\{[^}]*padding-top:\s*0/.test(s)
      && /statusBarH/.test(js)
      && /wx\.getWindowInfo/.test(js);
  });
  check('FRONT-26', '活动中心 7 子页顶部导航统一（custom + 返回钮同教练详情页 + 标题 44rpx/800 + 回退钮/胶囊顶部对齐 + 标题微降 8px + 内容不交叉）',
    navAllOk,
    'member-level/member-recharge/invite/passes-buy/coin-shop/about-us/honors 须全部：custom 导航 + nav-bar 内联 padding-top statusBarH 且先于 page-pad + nav-bar align-items:flex-start（回退钮与胶囊顶部对齐）+ nav-title line-height:1 + margin-top:8px（用户拍板：15px 降太多回调 8px）+ pt-safe padding-top:0（内容不交叉）+ js 计算 statusBarH(wx.getWindowInfo)');
  // FRONT-27: 次卡包页紫色 chip 只显示天数+单价（2026-08-19 用户拍板：去掉「N 次」重复展示）
  const pbWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'passes-buy', 'index.wxml'), 'utf8');
  check('FRONT-27', '次卡包 chip 仅「N 天 · ¥单价/次」（不重复 N 次）',
    /class="pkg-chip">\{\{item\.valid_days\}\} 天 · ¥\{\{item\.unitPrice\}\}\/次/.test(pbWxml)
      && !/pkg-chip[^>]*>\{\{item\.total_count\}\}/.test(pbWxml),
    'passes-buy pkg-chip 须为 {{item.valid_days}} 天 · ¥{{item.unitPrice}}/次，不得再含 {{item.total_count}} 次');
  // FRONT-28: 吐槽入口（DESIGN #D9）——个人中心「💬 吐槽」入口 + 吐槽页（承诺标语/提交）+ web 收件箱折叠卡/回复
  const fbWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'feedback', 'index.wxml'), 'utf8');
  const fbJs = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'feedback', 'index.js'), 'utf8');
  const profJs = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-profile', 'index.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'utils', 'api.js'), 'utf8');
  const fbWebHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'web', 'courses.html'), 'utf8');
  check('FRONT-28', '吐槽功能防回退（DESIGN #D9：入口/页面/收件箱/回复闭环）',
    /name: '💬 吐槽', url: '\/pages\/feedback\/index'/.test(profJs)
      && /api\/feedback/.test(apiSrc) && /api\/my-feedbacks/.test(apiSrc)
      && /承诺每条必回复|承诺标语|我们听着/.test(fbWxml)
      && /提交吐槽/.test(fbWxml) && /场馆回复/.test(fbWxml)
      && /fold-feedback/.test(fbWebHtml) && /吐槽收件箱/.test(fbWebHtml)
      && /function loadFeedbacks/.test(fbWebHtml) && /function replyFeedback/.test(fbWebHtml)
      && /api\/admin\/feedbacks/.test(apiSrc) === false && !/admin\/feedbacks/.test(apiSrc),
    '须：个人中心「💬 吐槽」入口指向 pages/feedback/index + api.js createFeedback/getMyFeedbacks（学员端不得直连 admin 接口）+ 吐槽页承诺标语/提交按钮/场馆回复展示 + web 收件箱折叠卡 loadFeedbacks/replyFeedback');
  check('FRONT-28b', '吐槽页在 app.json 注册', /pages\/feedback\/index/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'app.json'), 'utf8')), 'app.json 须含 pages/feedback/index');
  // FRONT-29: 新学员标记（DESIGN #D11）——教练名单页「新」徽标 + 顶部统计「学员名单（N 人 · 新学员 M 人）」
  const csWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-students', 'index.wxml'), 'utf8');
  const csJs = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-students', 'index.js'), 'utf8');
  const csWxss = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-students', 'index.wxss'), 'utf8');
  check('FRONT-29', '新学员徽标防回退（DESIGN #D11：tag-new 徽标 + 顶部统计 + newCount）',
    /tag-new/.test(csWxml) && /新/.test(csWxml)
      && /学员名单（\{\{total\}\} 人 · 新学员 \{\{newCount\}\} 人）/.test(csWxml)
      && /isNewCategory/.test(csJs) && /newCount/.test(csJs) && /isNew: /.test(csJs)
      && /\.tag-new\s*\{[^}]*color:/.test(csWxss),
    'coach-students 须：wxml「新」徽标(tag-new) + 顶部统计「学员名单（N 人 · 新学员 M 人）」+ js 映射 isNewCategory→isNew/newCount + wxss tag-new 样式');
  // FRONT-30: 无限次卡（DESIGN #D14）——次卡包页季卡/年卡分区 + 订课 0 元流程（有卡不出现支付方式选择）
  const pbWxml30 = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'passes-buy', 'index.wxml'), 'utf8');
  const pbJs30 = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'passes-buy', 'index.js'), 'utf8');
  const spWxml30 = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-pay', 'index.wxml'), 'utf8');
  const spJs30 = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-pay', 'index.js'), 'utf8');
  check('FRONT-30', '无限次卡分区防回退（DESIGN #D14：passes-buy 季卡/年卡 + 订课 0 元）',
    /无限次卡/.test(pbWxml30) && /unlPlans/.test(pbWxml30) && /selectUnl/.test(pbWxml30)
      && /orderType: isUnl \? 'unlimited' : 'pass'/.test(pbJs30)
      && /getUnlimitedPlans/.test(apiSrc) && /getUnlimitedPass/.test(apiSrc) && /api\/unlimited\/plans/.test(apiSrc) && /api\/unlimited\/my/.test(apiSrc)
      && /hasUnl/.test(spJs30) && /loadUnl/.test(spJs30) && /getUnlimitedPass\(openid\)/.test(spJs30)
      && /unl-hint/.test(spWxml30) && /0 元订课/.test(spWxml30) && /wx:if="\{\{!hasUnl\}\}"/.test(spWxml30),
    '须：passes-buy wxml 无限次卡分区(unlPlans/selectUnl) + js orderType=unlimited 分支 + api.js getUnlimitedPlans/getUnlimitedPass + student-pay js loadUnl/hasUnl + wxml 紫色横幅(unl-hint)「0 元订课」+ 支付方式区 hasUnl 隐藏');

  // ===== 1.65 上课页排序（BUG-LEDGER #36：纯函数模块真实断言）=====
  console.log('\n── 1.65 上课页排序（BUG-LEDGER #36）──');
  const { sortUpcoming, sortCompleted } = require(path.join(PROJECT_ROOT, 'miniprogram', 'utils', 'session-sort.js'));
  const sample = [
    { date: '2026-08-20', time: '10:00', end: '11:00', name: 'a' },
    { date: '2026-08-18', time: '15:00', end: '16:00', name: 'b' },
    { date: '2026-08-18', time: '09:00', end: '10:00', name: 'c' },
    { date: '2026-08-19', time: '22:00', end: '23:00', name: 'd' }
  ];
  const up = sortUpcoming(sample);
  check('SORT-01', '待上课按日期+开始时间升序（最近先来）', JSON.stringify(up.map(x => x.name)) === JSON.stringify(['c', 'b', 'd', 'a']), '待上课应: c(8/18 09:00) b(8/18 15:00) d(8/19 22:00) a(8/20 10:00)');
  check('SORT-02', '待上课排序不修改原数组', sample[0].date === '2026-08-20', 'sortUpcoming 须 slice() 副本排序');
  const done = sortCompleted(sample);
  check('SORT-03', '已完成按日期+结束时间降序（刚结束在前）', JSON.stringify(done.map(x => x.name)) === JSON.stringify(['a', 'd', 'b', 'c']), '已完成应: a(8/20 11:00) d(8/19 23:00) b(8/18 16:00) c(8/18 10:00)');
  check('SORT-04', '页面引用排序模块（#36 防回退）', /session-sort\.js/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-my-courses', 'index.js'), 'utf8')), 'student-my-courses 须引用 utils/session-sort.js');
  // SORT-05~08：教练工作台三态排序（BUGS-INBOX #42：进行中 → 未开始越近越前 → 已结束刚结束在前）
  const { sortCoachSessions } = require(path.join(PROJECT_ROOT, 'miniprogram', 'utils', 'session-sort.js'));
  const coachMix = [
    { date: '2026-08-17', start_time: '10:00', status: 'ended', name: 'e1' },
    { date: '2026-08-17', start_time: '21:00', status: 'upcoming', name: 'u2' },
    { date: '2026-08-17', start_time: '18:00', status: 'ongoing', name: 'g1' },
    { date: '2026-08-17', start_time: '16:00', status: 'ended', name: 'e2' },
    { date: '2026-08-17', start_time: '19:00', status: 'upcoming', name: 'u1' }
  ];
  const cs = sortCoachSessions(coachMix);
  check('SORT-05', '教练三态排序：进行中最前', cs[0].name === 'g1', '进行中必须最前，got=' + (cs[0] && cs[0].name));
  check('SORT-06', '未开始按开始时间升序（越近越前）', JSON.stringify(cs.slice(1, 3).map(x => x.name)) === JSON.stringify(['u1', 'u2']), '未开始应: u1(19:00) u2(21:00)');
  check('SORT-07', '已结束按开始时间降序（刚结束在前）', JSON.stringify(cs.slice(3).map(x => x.name)) === JSON.stringify(['e2', 'e1']), '已结束应: e2(16:00) e1(10:00)——开始时间越晚越前');
  check('SORT-08', '教练工作台引用三态排序（#42 防回退）', /sortCoachSessions/.test(fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-home', 'index.js'), 'utf8')), 'coach-home 须调用 sortCoachSessions');

  // PASSES-01: passes.js 档位种子自守门闩（防 #30 回退：模块加载期查表早于 MySQL 建表）
  const passesSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'db', 'passes.js'), 'utf8');
  check('PASSES-01', 'seedPackages 自守 driver.ready 门闩', /await driver\.ready;/.test(passesSrc), 'passes.js 顶层种子须 await driver.ready（MySQL 异步建表门闩）');
  // PASSES-02: 档位名「12次/24次」+ 老库改名迁移（2026-08-19 用户拍板：去掉「包」字；防回退：INSERT 种子不得用旧名，迁移必须幂等）
  check('PASSES-02', '档位名为「12次/24次」且含老库改名迁移',
    /\['12次', 12/.test(passesSrc)
      && /\['24次', 24/.test(passesSrc)
      && /SET name = '12次' WHERE name = '12次包'/.test(passesSrc)
      && /SET name = '24次' WHERE name = '24次包'/.test(passesSrc)
      && !/INSERT INTO class_packages[\s\S]*\[ '12次包'|INSERT INTO class_packages[\s\S]*\[ '24次包'/.test(passesSrc),
    'passes.js 种子 INSERT 须用「12次」「24次」新名，且带 UPDATE 老库名迁移（12次包→12次，幂等）');

  // OPS-01: 运维脚本 confirm 必须参数化（防 BUG-LEDGER #44 回退：引用 main 局部变量 delUsers → WebShell 必挂）
  const opsSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts', 'clean-prod-users.js'), 'utf8');
  check('OPS-01', 'clean-prod-users.js 的 confirm 接收 delUsers 参数',
    /function confirm\(delUsers\)/.test(opsSrc) && /await confirm\(delUsers\)/.test(opsSrc),
    'confirm 在 main 外部定义，必须由 main 传参（模板字符串引用未定义变量会 ReferenceError 中止删除）');

  // ===== 1.7 管理访问码校验（BUGS-INBOX #8：web 管理网页 ADMIN_TOKEN 保护）=====
  console.log('\n── 1.7 管理访问码校验（BUGS-INBOX #8）──');
  r = await req('POST', '/api/courses', { name: 'x' }, { noToken: true });
  check('ADMIN-01', '无 token 写课程 → 401', r.status === 401 && r.data && r.data.code === 401, `status=${r.status}`);
  r = await req('POST', '/api/courses', { name: 'x' }, { headers: { 'Admin-Token': 'wrong-token' } });
  check('ADMIN-02', '错误 token → 401', r.status === 401, `status=${r.status}`);
  r = await req('POST', '/api/courses', { name: 'x' });
  check('ADMIN-03', '正确 token 通过校验（进参数校验）', r.status === 400 && (r.data.message || '').includes('课程名称'), `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/meta', null, { noToken: true });
  check('ADMIN-04', '学员端接口不受访问码影响', r.status === 200, `status=${r.status}`);
  r = await req('GET', '/api/users', null, { noToken: true });
  check('ADMIN-05', '共享接口 /api/users 不保护（小程序 admin 共用）', r.status === 200, `status=${r.status}`);
  r = await req('POST', '/api/admin/coach-assign', { openid: 'x', coach_id: 1 }, { noToken: true });
  check('ADMIN-06', '无 token 设教练 → 401（BUGS-INBOX #14：防止绕过访问码提权）', r.status === 401, `status=${r.status}`);
  r = await req('POST', '/api/admin/coach-assign', { openid: 'x' });
  check('ADMIN-07', '正确 token 设教练（进参数校验：缺 coach_id）', r.status === 400 && (r.data.message || '').includes('coach_id'), `status=${r.status} msg=${r.data && r.data.message}`);
  // 教练分配管理页（BUGS-INBOX #40：web 管理「教练分配」tab，绑定/解绑自助操作）
  r = await req('GET', '/api/admin/coaches', null, { noToken: true });
  check('ADMIN-08', '无 token 拉教练分配列表 → 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/coaches');
  check('ADMIN-09', '分配列表：coaches 带绑定字段 + users 数组',
    r.status === 200 && Array.isArray(r.data.coaches) && Array.isArray(r.data.users)
      && r.data.coaches.length >= 1 && 'user_openid' in r.data.coaches[0] && 'user_nickname' in r.data.coaches[0],
    `status=${r.status} users=${Array.isArray(r.data.users) && r.data.users.length}`);
  await req('POST', '/api/auth/login', T.user1);   // 注册绑定对象（幂等，AUTH-01 会再注册）
  r = await req('POST', '/api/admin/coach-assign', { openid: T.user1.openid, coach_id: 1 });
  check('ADMIN-10', '绑定教练成功', r.status === 200 && r.data.ok === true, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/admin/coaches');
  const boundCoach = (r.data.coaches || []).find(c => c.id === 1);
  check('ADMIN-10b', '列表反映绑定（user_openid+昵称，管理页刷新可见）',
    boundCoach && boundCoach.user_openid === T.user1.openid && boundCoach.user_nickname === T.user1.nickname,
    `bound=${boundCoach && boundCoach.user_openid}`);
  r = await req('POST', '/api/admin/coach-unassign', { coach_id: 1 });
  check('ADMIN-11', '解绑教练成功', r.status === 200 && r.data.ok === true, `status=${r.status}`);
  r = await req('POST', '/api/auth/login', T.user1);
  check('ADMIN-12', '解绑后账号 role 回落 student（防残留提权）', r.status === 200 && r.data.user.role === 'student', `role=${r.data.user && r.data.user.role}`);
  r = await req('POST', '/api/admin/coach-unassign', { coach_id: 1 }, { noToken: true });
  check('ADMIN-13', '无 token 解绑 → 401', r.status === 401, `status=${r.status}`);
  // 用户级设/取消教练（DESIGN #D2：勾选用户即设教练，登录按 role 分流）
  r = await req('POST', '/api/admin/user-role', { openid: T.user2.openid, role: 'coach' }, { noToken: true });
  check('ADMIN-14', '无 token user-role → 401', r.status === 401, `status=${r.status}`);
  await req('POST', '/api/auth/login', T.user2);   // 注册 T.user2（幂等）
  r = await req('POST', '/api/admin/user-role', { openid: T.user2.openid, role: 'coach' });
  check('ADMIN-15', '设教练：自动建档 + role=coach（返回档案 id）',
    r.status === 200 && r.data.ok === true && r.data.coach_id >= 1, `status=${r.status} coach_id=${r.data.coach_id} msg=${r.data.message}`);
  r = await req('GET', '/api/admin/coaches');
  check('ADMIN-15e', 'users 含基本信息（注册时间/最后登录/登录次数，DESIGN #D2 展示用）',
    Array.isArray(r.data.users) && r.data.users.length >= 1
      && 'created_at' in r.data.users[0] && 'last_login_at' in r.data.users[0] && 'login_count' in r.data.users[0],
    `users=${Array.isArray(r.data.users) && r.data.users.length}`);
  r = await req('POST', '/api/auth/login', T.user2);
  check('ADMIN-15b', '登录返回 role=coach（该号默认走教练端）', r.status === 200 && r.data.user.role === 'coach', `role=${r.data.user && r.data.user.role}`);
  r = await req('GET', '/api/admin/coaches');
  const autoCoach = (r.data.coaches || []).find(c => c.user_openid === T.user2.openid);
  check('ADMIN-15c', '自动建档档案存在且昵称取自用户', !!(autoCoach && autoCoach.name === T.user2.nickname), `name=${autoCoach && autoCoach.name}`);
  const coachId2 = autoCoach ? autoCoach.id : 0;
  r = await req('POST', '/api/admin/user-role', { openid: T.user2.openid, role: 'coach' });
  check('ADMIN-15d', '重复设教练幂等（不重复建档，同档案）', r.status === 200 && r.data.coach_id === coachId2, `coach_id=${r.data.coach_id} expect=${coachId2}`);
  r = await req('POST', '/api/admin/user-role', { openid: T.user2.openid, role: 'student' });
  check('ADMIN-16', '取消教练：解绑档案 + role 回落', r.status === 200 && r.data.ok === true, `status=${r.status}`);
  r = await req('POST', '/api/auth/login', T.user2);
  check('ADMIN-16b', '登录返回 role=student（该号回学员端）', r.status === 200 && r.data.user.role === 'student', `role=${r.data.user && r.data.user.role}`);
  r = await req('GET', '/api/admin/coaches');
  check('ADMIN-16c', '档案已解绑（user_openid 清空）', !(r.data.coaches || []).find(c => c.user_openid === T.user2.openid), '残留绑定');
  r = await req('POST', '/api/admin/user-role', { openid: 'uid_not_exists', role: 'coach' });
  check('ADMIN-17', '不存在的账号拒绝', r.status === 400 && (r.data.message || '').includes('账号不存在'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/admin/user-role', { openid: T.user2.openid });
  check('ADMIN-18', '缺 role → 400', r.status === 400 && (r.data.message || '').includes('role'), `msg=${r.data && r.data.message}`);
  // 教练档案编辑（DESIGN #D2：名字/头像/技能/简介，前端教练详情/课程详情展示）
  r = await req('PUT', '/api/admin/coaches/1', { name: '喻馥雅', avatar: '/images/2_1468.png', skills: 'Hybrid综合体能,产后康复', bio: '管理页编辑测试简介', life_photo: '/uploads/ce_test.jpg' }, { noToken: true });
  check('ADMIN-19', '无 token 编辑档案 → 401', r.status === 401, `status=${r.status}`);
  r = await req('PUT', '/api/admin/coaches/1', { name: '喻馥雅', avatar: '/images/2_1468.png', skills: 'Hybrid综合体能,产后康复', bio: '管理页编辑测试简介', life_photo: '/uploads/ce_test.jpg' });
  check('ADMIN-20', '编辑档案成功', r.status === 200 && r.data.ok === true, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/admin/coaches');
  const edited = (r.data.coaches || []).find(c => c.id === 1);
  check('ADMIN-20b', '列表反映编辑（bio/skills/avatar/life_photo 字段）',
    !!(edited && edited.bio === '管理页编辑测试简介' && edited.skills === 'Hybrid综合体能,产后康复' && edited.avatar === '/images/2_1468.png' && edited.life_photo === '/uploads/ce_test.jpg'),
    `bio=${edited && edited.bio} life_photo=${edited && edited.life_photo}`);
  // COS 方言（2026-08-18 迁移）：未配置 COS_* 环境变量 → 上传仍写磁盘返回相对路径（本地/CI 行为不变）
  r = await req('POST', '/api/upload', { name: 'cos_test.jpg', data: 'data:image/jpeg;base64,' + Buffer.from('fakejpegdata').toString('base64') });
  check('COS-01', '未配置 COS 上传走磁盘（相对路径）',
    ok(r, 200) && /^\/images\//.test(r.data.path), `path=${r.data && r.data.path}`);
  r = await req('PUT', '/api/admin/coaches/999', { bio: 'x' });
  check('ADMIN-21', '不存在的档案 → 400', r.status === 400 && (r.data.message || '').includes('不存在'), `msg=${r.data && r.data.message}`);
  r = await req('PUT', '/api/admin/coaches/1', { name: '  ' });
  check('ADMIN-22', '姓名为空拒绝', r.status === 400 && (r.data.message || '').includes('姓名'), `msg=${r.data && r.data.message}`);
  // 课程「教练介绍」→ 档案 bio（修复：原字段后端未保存）
  r = await req('GET', '/api/courses');
  const seedCrs = (r.data.courses || [])[0];
  r = await req('PUT', '/api/courses/' + seedCrs.id, { name: seedCrs.name, coach_bio: '课程保存写入的教练简介' });
  check('ADMIN-23', '课程保存教练介绍成功', r.status === 200, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/admin/coaches');
  check('ADMIN-23b', '教练档案 bio 已由课程介绍写入',
    (r.data.coaches.find(c => c.id === 1) || {}).bio === '课程保存写入的教练简介',
    `bio=${r.data.coaches.find(c => c.id === 1) && r.data.coaches.find(c => c.id === 1).bio}`);
  // 删除教练档案（2026-08-18：清理合并残留空档案；有绑定/课程/模板的拒绝删除）
  r = await req('DELETE', '/api/admin/coaches/1', null, { noToken: true });
  check('ADMIN-24', '无 token 删除档案 → 401', r.status === 401, `status=${r.status}`);
  r = await req('DELETE', '/api/admin/coaches/999');
  check('ADMIN-25', '不存在的档案 → 400', r.status === 400 && (r.data.message || '').includes('不存在'), `msg=${r.data && r.data.message}`);
  r = await req('DELETE', '/api/admin/coaches/1');
  check('ADMIN-26', '有场次/模板引用的档案拒绝删除', r.status === 400 && (r.data.message || '').includes('场次或排课模板'), `msg=${r.data && r.data.message}`);
  // 造一个干净档案（user-role 自动建档）→ 解绑 → 删除 → 列表消失
  r = await req('POST', '/api/admin/user-role', { openid: T.user2.openid, role: 'coach' });
  const tmpCoachId = r.data && r.data.coach_id;
  await req('POST', '/api/admin/coach-unassign', { coach_id: tmpCoachId });
  r = await req('DELETE', '/api/admin/coaches/' + tmpCoachId);
  check('ADMIN-27', '删除干净档案成功', r.status === 200 && r.data.ok === true, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/admin/coaches');
  check('ADMIN-27b', '列表已无该档案', !(r.data.coaches || []).some(c => c.id === tmpCoachId), '删除后残留');
  // B3 操作日志（2026-08-18）：管理写操作入库留痕，GET /api/admin/logs 可查（管理网页「操作日志」页）
  r = await req('GET', '/api/admin/logs', null, { noToken: true });
  check('ADMIN-28', '无 token 拉操作日志 → 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/logs');
  check('ADMIN-28b', '操作日志列表', r.status === 200 && Array.isArray(r.data.logs) && r.data.logs.length >= 1, `status=${r.status} n=${r.data && r.data.logs && r.data.logs.length}`);
  // 显式造一次 course_create：创建课程 → 日志应含该课程 id（detail 为 JSON 字符串）
  r = await req('POST', '/api/courses', { name: '日志留痕测试课', category: '测试分类' });
  const logCid = r.data.course && r.data.course.id;
  r = await req('GET', '/api/admin/logs');
  check('ADMIN-28c', '创建课程写日志（含课程 id）',
    r.status === 200 && r.data.logs.some(l => l.action === 'course_create' && String(l.detail).includes(String(logCid))),
    `actions=${(r.data.logs || []).map(l => `${l.action}:${l.detail}`).join(' | ')}`);
  await req('DELETE', `/api/courses/${logCid}`);   // 清理（顺带留 course_delete 痕）

  // ===== 1. 账号登录 =====
  console.log('\n── 2. 账号与登录 ──');
  r = await req('POST', '/api/auth/login', T.user1);
  check('AUTH-01', '注册新用户', (r.status === 201 || r.status === 200) && r.data.user && r.data.user.openid === T.user1.openid, `status=${r.status}`);
  r = await req('POST', '/api/auth/login', T.user1);
  check('AUTH-02', '重复登录幂等', r.status === 200, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/auth/login', {});
  check('AUTH-03', '缺 openid', r.status === 400 && (r.data.message || '').includes('openid'), `msg=${r.data && r.data.message}`);
  // 有 code 只信 code（2026-08-17：换号失败必须 400 报错，绝不回退客户端 openid——否则微信登录静默变演示账号）
  r = await req('POST', '/api/auth/login', { code: 'fake_code', openid: 'uid_test_nofallback', nickname: '不应被创建' });
  check('AUTH-07', 'code 换号失败 → 400 且不注册客户端 openid',
    r.status === 400 && (r.data.message || '').includes('微信登录校验失败'),
    `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/users');
  check('AUTH-07b', '客户端 openid 未被静默注册',
    !(r.data.users || []).some(u => u.openid === 'uid_test_nofallback'),
    `users=${(r.data.users || []).map(u => u.openid).join(',')}`);
  // 手机号登录（B1 合规 2026-08-18：未企业认证/调用失败 → 400 明确报错，绝不写假号）
  r = await req('POST', '/api/auth/phone-login', {});
  check('AUTH-08', '手机号换号缺 code → 400', r.status === 400 && (r.data.message || '').includes('code'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/auth/phone-login', { code: 'fake_phone_code' });
  check('AUTH-09', '手机号换号失败 → 400 明确报错（不回落假号）',
    r.status === 400 && (r.data.message || '').includes('手机号'),
    `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/auth/profile', { openid: T.user1.openid, nickname: '田立新版', avatar: 'x' });
  check('AUTH-04', '更新资料', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/users');
  check('AUTH-05', '用户列表', ok(r, 200) && Array.isArray(r.data.users), `count=${r.data && r.data.users && r.data.users.length}`);
  check('AUTH-05b', '用户列表字段非空（#41：async map 必须 await，禁 Promise 数组假绿）', ok(r, 200) && r.data.users.length >= 1 && !!r.data.users[0].openid && !!r.data.users[0].nickname, `first=${r.data && r.data.users && r.data.users[0] && JSON.stringify({ o: !!r.data.users[0].openid, n: !!r.data.users[0].nickname })}`);
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
  // 详情页重构字段（轮播图/地址/教练简介/预约墙）
  r = await req('GET', `/api/sessions/1?openid=${T.user1.openid}`);
  check('SES-06', '详情含轮播图/预约墙', ok(r, 200) && Array.isArray(r.data.session.images) && Array.isArray(r.data.session.bookedUsers) && typeof r.data.session.coach_bio === 'string', `img=${JSON.stringify(r.data && r.data.session && r.data.session.images)} users=${r.data && r.data.session && r.data.session.bookedUsers && r.data.session.bookedUsers.length}`);

  // ===== 教练详情页（CPR-xx）：只显示未开始的课程；席位展示 已约/总数（BUG-LEDGER #19/#20）=====
  const coachStatus = require(path.join(PROJECT_ROOT, 'miniprogram/utils/course-status.js'));
  r = await req('GET', '/api/coaches/1');
  check('CPR-01', '教练详情', ok(r, 200) && r.data.coach && r.data.coach.name, `coach=${JSON.stringify(r.data && r.data.coach)}`);
  r = await req('GET', `/api/coaches/1/sessions?from=${todayStr}&to=${tomorrowStr}`);
  check('CPR-02', '教练场次含席位/时间字段', ok(r, 200) && Array.isArray(r.data.sessions) && r.data.sessions.every(s => typeof s.booked_count === 'number' && s.capacity && s.start_time && s.end_time), `count=${r.data && r.data.sessions && r.data.sessions.length}`);
  // 前端过滤逻辑（course-status.js 是纯函数，直接 require 断言）
  const F = (d, st, et, now) => coachStatus.getSessionStatus(d, st, et, now);
  check('CPR-03', '已结束场次判定 ended', F('2026-08-15', '10:00', '11:00', new Date('2026-08-15T12:00:00')) === 'ended', '');
  check('CPR-04', '进行中场次判定 ongoing', F('2026-08-15', '10:00', '11:00', new Date('2026-08-15T10:30:00')) === 'ongoing', '');
  check('CPR-05', '未开始场次判定 upcoming', F('2026-08-15', '10:00', '11:00', new Date('2026-08-15T09:00:00')) === 'upcoming', '');
  // 模拟教练详情页 filterDay：进行中/已结束课程被过滤，仅剩未开始
  const fakeSessions = [
    { date: '2026-08-15', start_time: '09:00', end_time: '10:00', booked_count: 3, capacity: 5, status: 'published' }, // 已结束
    { date: '2026-08-15', start_time: '10:00', end_time: '11:00', booked_count: 2, capacity: 5, status: 'published' }, // 进行中
    { date: '2026-08-15', start_time: '13:00', end_time: '14:00', booked_count: 5, capacity: 5, status: 'full' }        // 未开始（满员也显示）
  ];
  const visibleCp = fakeSessions.filter(s => coachStatus.getSessionStatus(s.date, s.start_time, s.end_time, new Date('2026-08-15T10:30:00')) === 'upcoming');
  check('CPR-06', '教练页过滤：进行中/已结束不显示', visibleCp.length === 1 && visibleCp[0].start_time === '13:00', `visible=${JSON.stringify(visibleCp.map(s => s.start_time))}`);

  // 造一个今天的测试场次（有余位）
  const mkSession = async (date, start, end, cap, booked) => {
    const db = require('../server/db.js');
    await db.driver.run(`INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source)
                   VALUES (1, 1, 1, ?, ?, ?, ?, ?, 'published', 'test_suite')`, [date, start, end, cap, booked]);
    const s = await db.driver.get("SELECT id FROM course_sessions WHERE source='test_suite' ORDER BY id DESC LIMIT 1");
    return s.id;
  };
  // 2026-08-18：场次时间动态化——固定 21:00/22:00 场次在 19:00 后跑测试会命中「退订截止=开课前 2 小时」
  // （WTL-06/07、ORD-07、PASS-08 全挂）；改为 now+3h/+4h 未来场次，任何时间跑测试都合法。
  // end_time 允许 >24:00 跨天表示（'24:00'/'24:30' 已有先例，time.parseBeijing 原生支持 h>24）
  const mkFutureSession = async (hoursAhead, cap, booked) => {
    const st = new Date(Date.now() + hoursAhead * 3600 * 1000);
    const et = new Date(st.getTime() + 3600 * 1000);
    const p = timeMod.parts(st), pe = timeMod.parts(et);
    const date = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    const start = beijingHM(st);
    const end = pe.h < p.h ? `${String(pe.h + 24).padStart(2, '0')}:${String(pe.mi).padStart(2, '0')}` : beijingHM(et);
    const id = await mkSession(date, start, end, cap, booked);
    return { id, date };
  };
  const _s1 = await mkFutureSession(3, 10, 0);
  ctx.sessionId = _s1.id;
  // 满员场次 now+4h：避开「已开课」——refundExpiredWaitlist 会在 GET /api/waitlist 时把已开课场次的
  // 候补自动退款，误杀候补队列（WTL-06/07 必挂）；动态未来时段天然免疫（旧「21 点后改用明天日期」逻辑并入）
  const _sf = await mkFutureSession(4, 1, 1);
  ctx.fullSessionId = _sf.id;
  ctx.fullSessionDate = _sf.date;   // WTL-05e 按日期查列表需要与场次实际日期一致
  ctx.tomorrowSessionId = await mkSession(tomorrowStr, '09:00', '10:00', 5, 0);
  console.log(`  [准备] 测试场次: 普通#${ctx.sessionId} 满员#${ctx.fullSessionId}(${ctx.fullSessionDate}) 明日#${ctx.tomorrowSessionId}`);

  // ===== 3. 订课链路（订单化）=====
  console.log('\n── 4. 订课链路 ──');
  // B2（2026-08-18）：微信支付改真实回调闭环后，测试统一走 balance——先给测试用户注入余额
  // （排除保持 0 余额的负向用例用户：wtl0=候补余额不足 / bal=订课余额不足 / nobody=不存在）
  {
    const _dbx = require('../server/db.js');
    await _dbx.driver.run("UPDATE users SET balance_fen = balance_fen + 100000 WHERE openid LIKE 'uid_test_%' AND openid NOT IN ('uid_test_wtl0','uid_test_bal','uid_test_nobody')");
  }
  // WX 系列（B2 钱闭环）：未配置商户号时 status=false / create、notify 400 明确报错
  r = await req('GET', '/api/wxpay/status');
  check('WX-01', 'wxpay 状态(未配置商户号)', ok(r, 200) && r.data.enabled === false, `enabled=${r.data && r.data.enabled}`);
  r = await req('POST', '/api/wxpay/create', { orderId: 1, openid: T.user1.openid });
  check('WX-02', '统一下单未配置 → 400', r.status === 400 && (r.data.message || '').includes('未开通'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/wxpay/notify', { resource: {} });
  check('WX-03', '回调未配置 → 400', r.status === 400, `status=${r.status}`);
  // WX-M 系列（PAY_MOCK 测试支付模式）独立 mock 后端 harness 已移至「── 11. 清理测试数据 ──」之前
  // （主后端测「无后门」、独立后端测 mock 全链路；2026-08-18）
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  check('ORD-01', '下单(订课)', r.status === 201 && r.data.order.status === 'pending', `msg=${r.data && r.data.message}`);
  ctx.orderId = r.data.order.id;
  // WX-04（B2 钱闭环闸门）：wxpay 无微信回调凭证 → 拒绝（模拟支付封死，前端无法绕过回调标 paid）
  r = await req('POST', `/api/orders/${ctx.orderId}/pay`, { openid: T.user1.openid, payMethod: 'wxpay' });
  check('WX-04', 'wxpay 无回调凭证拒绝', r.status === 400 && (r.data.message || '').includes('微信支付须由微信回调确认'), `status=${r.status} msg=${r.data && r.data.message}`);
  // WX-04b：被拒订单未被标记 paid（再次下单仍报「待支付」）
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  check('WX-04b', '被拒后订单仍 pending', r.status === 400 && (r.data.message || '').includes('待支付'), `msg=${r.data && r.data.message}`);
  r = await req('POST', `/api/orders/${ctx.orderId}/pay`, { openid: T.user1.openid, payMethod: 'balance' });
  check('ORD-02', '支付回写(balance)', ok(r, 200) && r.data.order.status === 'paid' && r.data.booking, `status=${r.data && r.data.order && r.data.order.status}`);
  ctx.bookingId = r.data.booking.id;
  ctx.paidOrderId = ctx.orderId;
  r = await req('POST', `/api/orders/${ctx.orderId}/pay`, { openid: T.user1.openid });
  check('ORD-03', '重复支付幂等', ok(r, 200) && r.data.already === true, `already=${r.data && r.data.already}`);
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  check('ORD-04', '重复下单拒绝', r.status === 400 && (r.data.message || '').includes('已预订'), `msg=${r.data && r.data.message}`);
  // ORD-04b：pending 订单查重（回归 BUG-LEDGER #13：狂点下单曾创建多笔 pending 订单、每笔支付都扣款=狂扣费）
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  check('ORD-04b', '连点下单防重(pending查重)', r.status === 201, `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  check('ORD-04c', '连点第二次下单拒绝', r.status === 400 && (r.data.message || '').includes('待支付'), `msg=${r.data && r.data.message}`);
  // 清理 user2 的 pending 订单（避免污染后续用例；user2 未支付无副作用）
  const _dbx = require('../server/db.js');
  const pend2 = await _dbx.driver.get("SELECT id FROM orders WHERE user_openid=? AND session_id=? AND status='pending'", [T.user2.openid, ctx.sessionId]);
  if (pend2) await _dbx.driver.run("DELETE FROM orders WHERE id=?", [pend2.id]);
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
  r = await req('POST', `/api/orders/${ctx.waitOrderId}/pay`, { openid: T.user1.openid, payMethod: 'wxpay' });
  check('WTL-02-0', '候补 wxpay 无凭证拒绝', r.status === 400, `status=${r.status}`);
  r = await req('POST', `/api/orders/${ctx.waitOrderId}/pay`, { openid: T.user1.openid, payMethod: 'balance' });
  check('WTL-02', '排位支付(balance)', ok(r, 200) && r.data.wait && r.data.wait.status === 'waiting', `wait=${r.data && r.data.wait && r.data.wait.status}`);
  ctx.waitId = r.data.wait.id;
  // WTL-02b：候补余额支付需余额充足（回归 BUG-LEDGER #9：原不校验不扣款，退出却退款=刷钱漏洞）
  r = await req('POST', '/api/auth/login', { openid: 'uid_test_wtl0', nickname: '候补零余额' });
  r = await req('POST', '/api/orders', { openid: 'uid_test_wtl0', sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'waitlist' });
  check('WTL-02b-1', '零余额候补下单', r.status === 201, `msg=${r.data && r.data.message}`);
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: 'uid_test_wtl0', payMethod: 'balance' });
  check('WTL-02b', '零余额候补余额支付拒绝', r.status === 400 && (r.data.message || '').includes('余额不足'), `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'waitlist' });
  check('WTL-03', '有余位排位拒绝', r.status === 400 && (r.data.message || '').includes('余位'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'waitlist' });
  check('WTL-04a', '二号排位成功', r.status === 201, `msg=${r.data && r.data.message}`);
  const wait2Order = r.data.order;
  r = await req('POST', `/api/orders/${wait2Order.id}/pay`, { openid: T.user2.openid, payMethod: 'balance' });
  check('WTL-04a-pay', '二号排位支付', ok(r, 200) && r.data.wait && r.data.wait.status === 'waiting', `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/waitlist?openid=${T.user2.openid}`);
  check('WTL-05', '我的候补列表', ok(r, 200) && r.data.waits.length >= 1, `count=${r.data && r.data.waits && r.data.waits.length}`);
  // DESIGN #D3 排位人数可视化：排队总数 + 我的位置（user1 先排 → user2 在其后）
  const wlUser2 = (r.data.waits || []).find(w => w.session_id === ctx.fullSessionId);
  check('WTL-05b', '候补列表带排队总数', !!wlUser2 && wlUser2.waitlist_count === 2, `count=${wlUser2 && wlUser2.waitlist_count}`);
  check('WTL-05c', '候补列表带我的位置(后排=1)', !!wlUser2 && wlUser2.my_wait_position === 1, `pos=${wlUser2 && wlUser2.my_wait_position}`);
  r = await req('GET', `/api/waitlist?openid=${T.user1.openid}`);
  const wlUser1 = (r.data.waits || []).find(w => w.session_id === ctx.fullSessionId);
  check('WTL-05c-2', '先排者位置=0', !!wlUser1 && wlUser1.my_wait_position === 0, `pos=${wlUser1 && wlUser1.my_wait_position}`);
  // 详情接口：waitlist_count 总是返回；已排位时带 my_wait_position
  r = await req('GET', `/api/sessions/${ctx.fullSessionId}?openid=${T.user2.openid}`);
  check('WTL-05d', '详情接口排队人数', ok(r, 200) && r.data.session.waitlist_count === 2 && r.data.session.my_wait_position === 1, `count=${r.data && r.data.session && r.data.session.waitlist_count} pos=${r.data && r.data.session && r.data.session.my_wait_position}`);
  // 列表接口：GROUP BY 一次聚合带出全部场次排队人数
  const fullDate2 = ctx.fullSessionDate;   // 动态化后满员场次可能在今天或明天，按实际日期查
  r = await req('GET', '/api/sessions?date=' + fullDate2 + '&openid=' + T.user2.openid);
  const listItem = (r.data.sessions || []).find(s => s.id === ctx.fullSessionId);
  check('WTL-05e', '列表接口排队人数', !!listItem && listItem.waitlist_count === 2, `count=${listItem && listItem.waitlist_count}`);

  // 退订触发转正：holder 订满员场次(调低余位) → 退订 → 最早排位者(田立)转正
  const db = require('../server/db.js');
  await db.driver.run(`UPDATE course_sessions SET booked_count = 0 WHERE id = ${ctx.fullSessionId}`);
  r = await req('POST', '/api/orders', { openid: T.holder.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'book' });
  const holderOrder = r.data.order;
  await req('POST', `/api/orders/${holderOrder.id}/pay`, { openid: T.holder.openid, payMethod: 'balance' });
  // 查 holder 的 bookingId
  r = await req('GET', `/api/orders?openid=${T.holder.openid}`);
  const holderPaid = r.data.orders.find(o => o.session_id === ctx.fullSessionId && o.status === 'paid');
  r = await req('DELETE', `/api/bookings/${holderPaid.booking_id}?openid=${T.holder.openid}`);
  check('WTL-06', '退订触发转正', ok(r, 200) && r.data.promoted && r.data.promoted.openid === T.user1.openid, `promoted=${r.data && r.data.promoted && r.data.promoted.openid}`);
  // 验证田立已转正为 booked
  r = await req('GET', `/api/waitlist?openid=${T.user1.openid}`);
  const wl1 = (r.data.waits || []).find(w => w.session_id === ctx.fullSessionId);
  check('WTL-06b', '转正状态 promoted', wl1 && wl1.status === 'promoted', `status=${wl1 && wl1.status}`);
  // DESIGN #D3：转正后排队人数 -1（user1 已转正，剩 user2）；转正者不再有位置（null）
  r = await req('GET', `/api/sessions/${ctx.fullSessionId}?openid=${T.user1.openid}`);
  check('WTL-06c', '转正后排队人数-1', ok(r, 200) && r.data.session.waitlist_count === 1, `count=${r.data && r.data.session && r.data.session.waitlist_count}`);
  check('WTL-06d', '转正者无排位位置', ok(r, 200) && r.data.session.my_wait_position === null, `pos=${r.data && r.data.session && r.data.session.my_wait_position}`);

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
    // DESIGN #D3：退出后排队人数归零
    r = await req('GET', `/api/sessions/${ctx.fullSessionId}?openid=${T.user2.openid}`);
    check('WTL-07c', '退出后排队人数归零', ok(r, 200) && r.data.session.waitlist_count === 0, `count=${r.data && r.data.session && r.data.session.waitlist_count}`);
  } else {
    check('WTL-07', '退出候补退款', false, '未找到 waiting 记录');
  }

  // 过期退款：明天场次（先设满员）排队 → 改日期为昨天 → 触发
  await db.driver.run(`UPDATE course_sessions SET booked_count = capacity WHERE id = ${ctx.tomorrowSessionId}`);
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: ctx.tomorrowSessionId, amountFen: 6800, orderType: 'waitlist' });
  const wlT = r.data.order;
  if (wlT) {
    await req('POST', `/api/orders/${wlT.id}/pay`, { openid: T.user2.openid, payMethod: 'balance' });
    await db.driver.run(`UPDATE course_sessions SET \`date\` = '2026-08-09' WHERE id = ${ctx.tomorrowSessionId}`);
    r = await req('GET', `/api/waitlist?openid=${T.user2.openid}`);
    const wlT2 = (r.data.waits || []).find(w => w.session_id === ctx.tomorrowSessionId);
    check('WTL-08', '过期自动退款', wlT2 && wlT2.status === 'refunded', `status=${wlT2 && wlT2.status}`);
  } else {
    check('WTL-08', '过期自动退款', false, '排位下单失败: ' + r.data.message);
  }

  // B3 退出候补截止（2026-08-18，用户拍板与退订同规则：开课前 2 小时内不可退出）——造「课前 1 小时」满员场次排队 → 退出被拒
  {
    const _cutW = timeMod.addMinutesStr(timeMod.nowDateTimeStr(), 60);   // 北京时间 now+1h（addMinutesStr 跨天安全）
    const [cutWd, cutWt] = _cutW.split(' ');
    const cutWEnd = timeMod.addMinutesStr(_cutW, 60).split(' ')[1].slice(0, 5);
    const cutWSid = await mkSession(cutWd, cutWt.slice(0, 5), cutWEnd, 1, 1);   // 满员 → 只能排位
    r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: cutWSid, amountFen: 6800, orderType: 'waitlist' });
    check('WTL-09-1', '课前1小时满员场次排位', r.status === 201, `msg=${r.data && r.data.message}`);
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: T.user2.openid, payMethod: 'balance' });
    check('WTL-09-2', '排位支付', ok(r, 200) && r.data.wait, `msg=${r.data && r.data.message}`);
    const cutWaitId = r.data.wait && r.data.wait.id;
    if (cutWaitId) {
      r = await req('DELETE', `/api/waitlist/${cutWaitId}?openid=${T.user2.openid}`);
      check('WTL-09', '课前2小时内退出候补拒绝', r.status === 400 && (r.data.message || '').includes('2 小时'), `status=${r.status} msg=${r.data && r.data.message}`);
    } else {
      check('WTL-09', '课前2小时内退出候补拒绝', false, '排位支付未成功');
    }
  }

  // ===== 5. 签到考勤 =====
  console.log('\n── 6. 签到考勤 ──');
  // 独立的"明天场次"（避免 WTL-08 改日期污染）
  const tmr2 = await mkSession(tomorrowStr, '13:00', '14:00', 5, 0);
  // 签到时间窗口（BUG-LEDGER #10 修复；2026-08-16 统一课后 30 分钟 DESIGN #D1）：开课前30分钟~结束后30分钟。
  // 动态造「已开课 20 分钟」的场次（start=now-20m、end=now+40m），now 恒在窗口内 [start-30m, end+30m]，
  // 不依赖固定执行时间（原「+10/+70」在 23:00 后跑测试 end 跨天→日期仍是当天，后端判"已结束"——BUG-LEDGER #15 同源坑）
  const chkNow = new Date();
  const chkEnd = new Date(chkNow.getTime() + 40 * 60000);
  const chkStart = new Date(chkNow.getTime() - 20 * 60000);
  if (timeMod.parts(chkStart).d !== timeMod.parts(chkNow).d || timeMod.parts(chkEnd).d !== timeMod.parts(chkNow).d) {
    // 深夜/凌晨 now-20m 或 +40m 跨天时无法安全造「当天窗口」场次 → 跳过（与 CHK-07 同策略）。
    // 2026-08-18 补 start 端检查：原判断只查 end，凌晨 00:00-00:19 跑测试 now-20m 落前一天，
    // 时分贴到今天日期 → 场次被造到「未来」，签到窗口判定全挂（CHK-02/04/09/10 连锁）
    console.log('  [跳过] 深夜/凌晨 CHK-01~04、08~13 窗口签到用例（now±跨天造数不安全）');
  } else {
    const chkSid = await mkSession(todayStr, beijingHM(chkStart), beijingHM(chkEnd), 5, 0);
    r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: chkSid, amountFen: 6800, orderType: 'book' });
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: T.user1.openid, payMethod: 'balance' });
    const chkBookingId = r.data.booking.id;
    r = await req('GET', `/api/checkin/${chkBookingId}`);
    check('CHK-01', '凭证信息', ok(r, 200) && r.data.info && r.data.info.course_name, `course=${r.data && r.data.info && r.data.info.course_name}`);
    r = await req('POST', `/api/bookings/${chkBookingId}/checkin`, { openid: T.coach.openid });
    check('CHK-02', '教练核销成功', ok(r, 200) && r.data.booking.checkin_at, `checkin=${r.data && r.data.booking && r.data.booking.checkin_at}`);
    r = await req('POST', `/api/bookings/${chkBookingId}/checkin`, { openid: T.user1.openid });
    check('CHK-03', '非教练核销拒绝', r.status === 400 && (r.data.message || '').includes('教练'), `msg=${r.data && r.data.message}`);
    r = await req('POST', `/api/bookings/${chkBookingId}/checkin`, { openid: T.coach.openid });
    check('CHK-04', '重复签到拒绝', r.status === 400 && (r.data.message || '').includes('已签到'), `msg=${r.data && r.data.message}`);
    // 按码核销（BUGS-INBOX #11：随机 5 位纯数字签到码，POST /api/checkin/by-code 反查）
    r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: chkSid, amountFen: 6800, orderType: 'book' });
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: T.user2.openid, payMethod: 'balance' });
    const chkByBookingId = r.data.booking.id;
    r = await req('GET', `/api/checkin/${chkByBookingId}`);
    const chkCode = r.data.info && r.data.info.checkin_code;
    check('CHK-08', '凭证含5位签到码', ok(r, 200) && /^\d{5}$/.test(chkCode || ''), `code=${chkCode}`);
    r = await req('POST', '/api/checkin/by-code', { code: chkCode, openid: T.coach.openid });
    check('CHK-09', '按码核销成功', ok(r, 200) && r.data.booking && r.data.booking.id === chkByBookingId, `msg=${r.data && r.data.message}`);
    r = await req('POST', '/api/checkin/by-code', { code: chkCode, openid: T.coach.openid });
    check('CHK-10', '按码重复签到拒绝', r.status === 400 && (r.data.message || '').includes('已签到'), `msg=${r.data && r.data.message}`);
    r = await req('POST', '/api/checkin/by-code', { code: '12', openid: T.coach.openid });
    check('CHK-11', '非5位码拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
    r = await req('POST', '/api/checkin/by-code', { code: '99999', openid: T.coach.openid });
    check('CHK-12', '不存在码拒绝', r.status === 400 && (r.data.message || '').includes('不存在'), `msg=${r.data && r.data.message}`);
    r = await req('POST', '/api/checkin/by-code', { code: chkCode, openid: T.user1.openid });
    check('CHK-13', '按码非教练拒绝', r.status === 400 && (r.data.message || '').includes('教练'), `msg=${r.data && r.data.message}`);
  }
  // 非当天场次（独立明天场次）签到
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: tmr2, amountFen: 6800, orderType: 'book' });
  const tmrOrder = r.data.order;
  await req('POST', `/api/orders/${tmrOrder.id}/pay`, { openid: T.user2.openid, payMethod: 'balance' });
  r = await req('GET', `/api/orders?openid=${T.user2.openid}`);
  const tmrPaid = r.data.orders.find(o => o.session_id === tmr2 && o.status === 'paid');
  r = await req('POST', `/api/bookings/${tmrPaid.booking_id}/checkin`, { openid: T.coach.openid });
  check('CHK-05', '非当天签到拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  // 场次名单
  r = await req('GET', `/api/sessions/${ctx.sessionId}/students`);
  check('CHK-06', '场次名单', ok(r, 200) && r.data.students.length >= 1 && r.data.students[0].student_name, `count=${r.data && r.data.students && r.data.students.length}`);
  // CHK-07：提前签到拒绝（未来场次未到开课前30分钟窗口，回归 BUG-LEDGER #10；跨天时跳过）
  const plus120 = new Date(chkNow.getTime() + 120 * 60000);
  if (timeMod.parts(plus120).d === timeMod.parts(chkNow).d) {
    const chkSid2 = await mkSession(todayStr, beijingHM(plus120), beijingHM(new Date(plus120.getTime() + 3600000)), 5, 0);
    r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: chkSid2, amountFen: 6800, orderType: 'book' });
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: T.user2.openid, payMethod: 'balance' });
    r = await req('POST', `/api/bookings/${r.data.booking.id}/checkin`, { openid: T.coach.openid });
    check('CHK-07', '提前签到拒绝(未到窗口)', r.status === 400 && (r.data.message || '').includes('未到签到时间'), `msg=${r.data && r.data.message}`);
  }

  // ===== 6.1 固定二维码自助签到（DESIGN #D13）：scan 三态 / select 选课签到 =====
  // 完全自包含：独立用户 + 独立场次（不污染 CHK 块 T.user1/2 已签到状态；教训同 NEW 块 2026-08-20）
  console.log('\n── 6.1 自助签到（DESIGN #D13）──');
  {
    const _dbx = require('../server/db.js');
    const CK = { openid: 'uid_test_ckin', nickname: '自助签学员' };
    const CK2 = { openid: 'uid_test_ckin2', nickname: '自助签学员2' };
    await req('POST', '/api/auth/login', CK);
    await req('POST', '/api/auth/login', CK2);
    await _dbx.driver.run('UPDATE users SET balance_fen = balance_fen + 100000 WHERE openid IN (?, ?)', [CK.openid, CK2.openid]);
    // 连堂两课造法（multi 场景真相，2026-08-20 排障）：D14「同一时间只能订一堂课」禁止同时段双订，
    // multi 实际来自「连堂」——A 已结束但仍在课后 30 分钟窗口、B 进行中（两课时间不重叠，D14 放行）：
    //   A: now-50m ~ now-25m（窗口 [now-80m, now+5m] 含 now）  B: now-20m ~ now+40m（窗口 [now-50m, now+70m] 含 now）
    const ckinNow = new Date();
    const ckinAStart = new Date(ckinNow.getTime() - 50 * 60000);
    const ckinAEnd = new Date(ckinNow.getTime() - 25 * 60000);
    const ckinBStart = new Date(ckinNow.getTime() - 20 * 60000);
    const ckinBEnd = new Date(ckinNow.getTime() + 40 * 60000);
    // 跨天守卫：两端点同天则中间各点必同天（A 在凌晨跨昨天 / B 在深夜跨明天都不可造）
    if (timeMod.parts(ckinAStart).d !== timeMod.parts(ckinNow).d || timeMod.parts(ckinBEnd).d !== timeMod.parts(ckinNow).d) {
      console.log('  [跳过] 深夜/凌晨 CKIN-01~07 窗口签到用例（now±跨天造数不安全）');
    } else {
      const ckinSidA = await mkSession(todayStr, beijingHM(ckinAStart), beijingHM(ckinAEnd), 10, 0);
      const ckinSidB = await mkSession(todayStr, beijingHM(ckinBStart), beijingHM(ckinBEnd), 10, 0);
      // CK 只订一门 → 唯一候选自动签（scan 直接落库）
      r = await req('POST', '/api/orders', { openid: CK.openid, sessionId: ckinSidA, amountFen: 6800, orderType: 'book' });
      r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: CK.openid, payMethod: 'balance' });
      const ckinBK = r.data.booking.id;
      r = await req('POST', '/api/checkin/scan', { openid: CK.openid });
      check('CKIN-01', '唯一订课扫码自动签到', ok(r, 200) && r.data.state === 'done' && r.data.booking && r.data.booking.id === ckinBK && !!r.data.booking.checkin_at, `state=${r.data && r.data.state} checkin=${r.data && r.data.booking && r.data.booking.checkin_at}`);
      r = await req('POST', '/api/checkin/scan', { openid: CK.openid });
      check('CKIN-02', '无待签课程→none', ok(r, 200) && r.data.state === 'none', `state=${r.data && r.data.state} msg=${r.data && r.data.message}`);
      // CK2 两门同时在窗口 → multi 返回候选、不落库（DB 直查佐证）
      r = await req('POST', '/api/orders', { openid: CK2.openid, sessionId: ckinSidA, amountFen: 6800, orderType: 'book' });
      r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: CK2.openid, payMethod: 'balance' });
      const ckinBK2a = r.data.booking.id;
      r = await req('POST', '/api/orders', { openid: CK2.openid, sessionId: ckinSidB, amountFen: 6800, orderType: 'book' });
      r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: CK2.openid, payMethod: 'balance' });
      const ckinBK2b = r.data.booking.id;
      r = await req('POST', '/api/checkin/scan', { openid: CK2.openid });
      const ck2aDb = await _dbx.driver.get('SELECT checkin_at FROM bookings WHERE id = ?', [ckinBK2a]);
      check('CKIN-03', '多订课→multi候选不落库', ok(r, 200) && r.data.state === 'multi' && r.data.candidates && r.data.candidates.length === 2 && !ck2aDb.checkin_at, `state=${r.data && r.data.state} cand=${r.data && r.data.candidates && r.data.candidates.length}`);
      // select 选定签到
      r = await req('POST', '/api/checkin/select', { openid: CK2.openid, bookingId: ckinBK2a });
      check('CKIN-04', 'select 选定签到成功', ok(r, 200) && r.data.booking && r.data.booking.id === ckinBK2a && !!r.data.booking.checkin_at, `msg=${r.data && r.data.message}`);
      // 非本人订课拒绝（选别人的订课签到）
      r = await req('POST', '/api/checkin/select', { openid: CK2.openid, bookingId: ckinBK });
      check('CKIN-05', '非本人订课拒绝', r.status === 400 && (r.data.message || '').includes('只能签到自己的订课'), `msg=${r.data && r.data.message}`);
      // 已签到幂等
      r = await req('POST', '/api/checkin/select', { openid: CK2.openid, bookingId: ckinBK2a });
      check('CKIN-06', '重复签到拒绝(幂等)', r.status === 400 && (r.data.message || '').includes('已签到'), `msg=${r.data && r.data.message}`);
      // 窗口外（未来课未到开课前30分钟）拒绝；now+120m 跨天则跳过（同 CHK-07 策略）
      const ckinPlus120 = new Date(ckinNow.getTime() + 120 * 60000);
      if (timeMod.parts(ckinPlus120).d === timeMod.parts(ckinNow).d) {
        const ckinSidFuture = await mkSession(todayStr, beijingHM(ckinPlus120), beijingHM(new Date(ckinPlus120.getTime() + 3600000)), 10, 0);
        r = await req('POST', '/api/orders', { openid: CK2.openid, sessionId: ckinSidFuture, amountFen: 6800, orderType: 'book' });
        r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: CK2.openid, payMethod: 'balance' });
        r = await req('POST', '/api/checkin/select', { openid: CK2.openid, bookingId: r.data.booking.id });
        check('CKIN-07', '窗口外签到拒绝(未到时间)', r.status === 400 && (r.data.message || '').includes('未到签到时间'), `msg=${r.data && r.data.message}`);
      } else {
        console.log('  [跳过] CKIN-07 窗口外签到（now+120m 跨天不安全）');
      }
    }
    // 缺参数 400（不依赖窗口，恒可跑）
    r = await req('POST', '/api/checkin/scan', {});
    check('CKIN-08', 'scan 缺 openid 拒绝', r.status === 400 && (r.data.message || '').includes('openid'), `msg=${r.data && r.data.message}`);
    r = await req('POST', '/api/checkin/select', { openid: CK2.openid });
    check('CKIN-09', 'select 缺 bookingId 拒绝', r.status === 400 && (r.data.message || '').includes('bookingId'), `msg=${r.data && r.data.message}`);
  }

  // ===== 5.5 新学员标记（DESIGN #D11）：同 category 签到过才算上过，首次上该类型标「新」=====
  console.log('\n── 5.5 新学员标记（DESIGN #D11）──');
  {
    const _dbx = require('../server/db.js');
    const NEWK = { openid: 'uid_test_newkid', nickname: '新学员小新' };
    await req('POST', '/api/auth/login', NEWK);
    // 完全自包含：全部直插独立课程 + 专属用户，不依赖 seed 课程与前置块状态
    // （教训 2026-08-20：CHK 块先跑会让 T.user1 在课程 1 签到，污染类型 A 的历史判定 → NEW-03/04 时好时坏）
    const mkCatSession = async (courseId, date, start, end) => {
      await _dbx.driver.run(`INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source)
                      VALUES (?, 1, 1, ?, ?, ?, 10, 0, 'published', 'test_suite')`, [courseId, date, start, end]);
      return (await _dbx.driver.get("SELECT id FROM course_sessions WHERE source='test_suite' ORDER BY id DESC LIMIT 1")).id;
    };
    const catA = 'NEW-A-' + Math.random().toString(36).slice(2, 7);
    const catB = 'NEW-B-' + Math.random().toString(36).slice(2, 7);
    await _dbx.driver.run("INSERT INTO courses (name, category, status) VALUES ('NEW测试课程A', ?, 'published')", [catA]);
    await _dbx.driver.run("INSERT INTO courses (name, category, status) VALUES ('NEW测试课程B', ?, 'published')", [catB]);
    const cA = (await _dbx.driver.get("SELECT id FROM courses WHERE name = 'NEW测试课程A'")).id;
    const cB = (await _dbx.driver.get("SELECT id FROM courses WHERE name = 'NEW测试课程B'")).id;
    const newSid = await mkCatSession(cA, todayStr, '16:00', '17:00');   // 类型 A 当前场次
    // 专属用户：newB 曾在类型 A 签过到（→老）；newA 仅在类型 B 签过到（→新）；小新无历史（→新）
    const newA = { openid: 'uid_test_newA', nickname: '新学员A' };
    const newB = { openid: 'uid_test_newB', nickname: '老学员B' };
    await req('POST', '/api/auth/login', newA);
    await req('POST', '/api/auth/login', newB);
    // 名单：newA/newB/小新 全部订课未签到
    await _dbx.driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
                     VALUES (?, ?, ?, 6800, 'booked', 'paid')`, ['NEWA1' + newSid, newA.openid, newSid]);
    await _dbx.driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
                     VALUES (?, ?, ?, 6800, 'booked', 'paid')`, ['NEWA2' + newSid, newB.openid, newSid]);
    await _dbx.driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
                     VALUES (?, ?, ?, 6800, 'booked', 'paid')`, ['NEWA3' + newSid, NEWK.openid, newSid]);
    // 签到历史（B1：签到=到课证明）：newB 曾在类型 A 的另一场次签到过（同类型→老）
    const histA = await mkCatSession(cA, todayStr, '17:30', '18:30');
    await _dbx.driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status, checkin_at)
                     VALUES (?, ?, ?, 6800, 'booked', 'paid', ?)`, ['NEWH1' + histA, newB.openid, histA, timeMod.nowDateTimeStr()]);
    // newA 曾在类型 B 签到过（不同类型→仍新）
    const histB = await mkCatSession(cB, todayStr, '19:00', '20:00');
    await _dbx.driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status, checkin_at)
                     VALUES (?, ?, ?, 6800, 'booked', 'paid', ?)`, ['NEWH2' + histB, newA.openid, histB, timeMod.nowDateTimeStr()]);
    r = await req('GET', `/api/sessions/${newSid}/students`);
    const stu = (r.data.students || []);
    const byO = (o) => stu.find(s => s.user_openid === o);
    check('NEW-01', '无签到历史学员 → 新学员', byO(NEWK.openid) && byO(NEWK.openid).isNewCategory === true, `newkid=${byO(NEWK.openid) && byO(NEWK.openid).isNewCategory}`);
    check('NEW-02', '同类型签到过 → 老学员', byO(newB.openid) && byO(newB.openid).isNewCategory === false, `newB=${byO(newB.openid) && byO(newB.openid).isNewCategory}`);
    check('NEW-03', '仅不同类型签到过 → 仍是新学员', byO(newA.openid) && byO(newA.openid).isNewCategory === true, `newA=${byO(newA.openid) && byO(newA.openid).isNewCategory}`);
    // 当前场次签到不计入新老判定（排除本场）：给 newA 当前场次补签到，仍应标新
    await _dbx.driver.run('UPDATE bookings SET checkin_at = ? WHERE booking_no = ?', [timeMod.nowDateTimeStr(), 'NEWA1' + newSid]);
    r = await req('GET', `/api/sessions/${newSid}/students`);
    check('NEW-04', '当前场次签到不计入历史（新老判定排除本场）', (r.data.students || []).find(s => s.user_openid === newA.openid).isNewCategory === true, 'newA 本场签到不应使其变老');
    check('NEW-05', 'newCount 口径=名单新学员数', r.data.newCount === stu.filter(s => s.isNewCategory).length && r.data.newCount >= 1, `newCount=${r.data.newCount}`);
    check('NEW-06', '候补不在名单（不标新）', !stu.some(s => /wait/.test(s.status || '')), '名单只含正式订课学员');
    // 清理直插数据（先删 bookings → sessions → 新课程 → 新用户）
    await _dbx.driver.run("DELETE FROM bookings WHERE booking_no LIKE 'NEW%'");
    await _dbx.driver.run(`DELETE FROM course_sessions WHERE id IN (?, ?, ?)`, [newSid, histA, histB]);
    await _dbx.driver.run("DELETE FROM courses WHERE name IN ('NEW测试课程A', 'NEW测试课程B')");
    await _dbx.driver.run("DELETE FROM users WHERE openid IN ('uid_test_newkid', 'uid_test_newA', 'uid_test_newB')");
  }

  // ===== B3 到课率 + 数据导出（2026-08-18，管理网页新页）=====
  console.log('\n── 6.8 到课率与导出 ──');
  // 直插已签到 booking 造固定到课率数据（绕过签到窗口；booked_count 与之一致：造 3 订 1 签）
  const attSid = await mkSession(todayStr, '08:00', '09:00', 5, 3);
  await _dbx.driver.run(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status, checkin_at)
                   VALUES (?, ?, ?, 6800, 'booked', 'paid', ?)`,
    ['B3ATT' + attSid, T.user2.openid, attSid, timeMod.nowDateTimeStr()]);
  r = await req('GET', '/api/admin/attendance?start=2026-01-01&end=2030-01-01', null, { noToken: true });
  check('ATT-01', '无 token 拉到课率 → 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/attendance?start=2026-01-01&end=2030-01-01');
  check('ATT-02', '到课率汇总（含直插签到）',
    r.status === 200 && r.data.summary && r.data.summary.total > 0 && r.data.summary.attended >= 1 && typeof r.data.summary.rate === 'number',
    `total=${r.data.summary && r.data.summary.total} attended=${r.data.summary && r.data.summary.attended} rate=${r.data.summary && r.data.summary.rate}`);
  r = await req('GET', '/api/admin/attendance?start=2026-01-01&end=2030-01-01&course_id=1');
  check('ATT-03', '按课程筛选到课率', r.status === 200 && Array.isArray(r.data.rows), `status=${r.status}`);
  r = await req('GET', '/api/admin/attendance');
  check('ATT-04', '缺日期到课率 → 400', r.status === 400, `status=${r.status}`);
  // 数据导出（GET /api/admin/export/:type，CSV：UTF-8 BOM + 引号转义，Excel 兼容）
  r = await req('GET', '/api/admin/export/users', null, { noToken: true });
  check('EXP-01', '无 token 导出 → 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/export/users');
  check('EXP-02', '学员导出 CSV(BOM+表头+数据)', r.status === 200 && r.raw.charCodeAt(0) === 0xFEFF && r.raw.includes('openid') && r.raw.includes('昵称') && r.raw.includes(T.user1.openid), `head=${r.raw.slice(0, 50)}`);
  r = await req('GET', '/api/admin/export/orders');
  check('EXP-03', '订单导出 CSV', r.status === 200 && r.raw.charCodeAt(0) === 0xFEFF && r.raw.includes('订单号') && r.raw.includes('uid_test_tianli'), `head=${r.raw.slice(0, 50)}`);
  r = await req('GET', '/api/admin/export/revenue');
  check('EXP-04', '营收导出 CSV', r.status === 200 && r.raw.charCodeAt(0) === 0xFEFF && r.raw.includes('收入(分)'), `head=${r.raw.slice(0, 50)}`);
  r = await req('GET', '/api/admin/export/xxx');
  check('EXP-05', '非法导出类型 → 400', r.status === 400, `status=${r.status}`);

  // ===== 6.9 运营 Dashboard 聚合接口（DESIGN #D4，web 管理页「运营数据」tab 数据源）=====
  console.log('\n── 6.9 运营 Dashboard ──');
  r = await req('GET', '/api/admin/dashboard', null, { noToken: true });
  check('DASH-01', '无 token 拉 Dashboard → 401（并入 ADMIN_PATHS）', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/dashboard?date=2026-8-1');
  check('DASH-02', '非法 date 格式 → 400', r.status === 400, `status=${r.status}`);
  r = await req('GET', '/api/admin/dashboard');
  const D = r.data || {};
  check('DASH-03', '默认今天：core 7 指标齐全',
    r.status === 200 && D.date === todayStr
    && typeof D.core.new_users === 'number' && typeof D.core.booking_rate === 'number'
    && typeof D.core.checkin_rate === 'number' && !!D.core.retention
    && (D.core.retention.d7 === null || typeof D.core.retention.d7 === 'number')
    && D.core.recharge && typeof D.core.recharge.fen === 'number' && typeof D.core.recharge.balance_fen === 'number'
    && typeof D.core.confirmed_revenue_fen === 'number' && typeof D.core.unconfirmed_revenue_fen === 'number'
    && typeof D.core.refund_fen === 'number',
    `date=${D.date} nu=${D.core && D.core.new_users} br=${D.core && D.core.booking_rate} cr=${D.core && D.core.checkin_rate} r7=${D.core && D.core.retention && D.core.retention.d7}`);
  // 订课率口径：当日 published/full 场次 预约÷总席位（与库直查精确一致）
  const dashCap = await _dbx.driver.get("SELECT COALESCE(SUM(capacity),0) cap, COALESCE(SUM(booked_count),0) booked FROM course_sessions WHERE `date` = ? AND status IN ('published','full')", [todayStr]);
  const dashRate = dashCap.cap > 0 ? Math.round(dashCap.booked / dashCap.cap * 1000) / 10 : 0;
  check('DASH-04', '订课率=预约÷总席位（与库直查一致）',
    D.core.booking_rate === dashRate, `api=${D.core.booking_rate} db=${dashRate}`);
  // 签到率口径：当日课 bookings 中 checkin_at 非空占比（签到是唯一到课证明 B1）
  const dashCk = await _dbx.driver.get(`SELECT COUNT(*) total, SUM(CASE WHEN checkin_at IS NOT NULL THEN 1 ELSE 0 END) done
    FROM bookings b JOIN course_sessions s ON s.id = b.session_id WHERE s.date = ? AND b.status = 'booked'`, [todayStr]);
  const dashCkRate = dashCk.total > 0 ? Math.round(dashCk.done / dashCk.total * 1000) / 10 : 0;
  check('DASH-05', '签到率=已签到÷预约（与库直查一致）',
    D.core.checkin_rate === dashCkRate, `api=${D.core.checkin_rate} db=${dashCkRate}`);
  check('DASH-06', '趋势 d7=7 天 / d30=30 天（数组等长）',
    D.trend && D.trend.d7 && D.trend.d7.days.length === 7 && D.trend.d30 && D.trend.d30.days.length === 30
    && D.trend.d7.newUsers.length === 7 && D.trend.d30.revenueFen.length === 30,
    `d7=${D.trend && D.trend.d7 && D.trend.d7.days.length} d30=${D.trend && D.trend.d30 && D.trend.d30.days.length}`);
  check('DASH-07', '4 组折叠卡数据齐全',
    D.groups && D.groups.revenue && typeof D.groups.revenue.cancel_rate === 'number'
    && typeof D.groups.revenue.waitlist_promote_rate === 'number'
    && D.groups.growth && D.groups.growth.funnel && typeof D.groups.growth.funnel.registered === 'number'
    && D.groups.growth.dormant && typeof D.groups.growth.dormant.d14 === 'number'
    && D.groups.courses && Array.isArray(D.groups.courses.top) && Array.isArray(D.groups.courses.hours) && Array.isArray(D.groups.courses.coaches)
    && D.groups.system && typeof D.groups.system.coins.issued === 'number' && typeof D.groups.system.msg_read_rate === 'number'
    && Array.isArray(D.groups.system.members) && typeof D.groups.system.passes.bought === 'number',
    `groups=${JSON.stringify(Object.keys(D.groups || {}))}`);
  check('DASH-08', '收入两轨非负（确认=签到或过退订截止，未确认=可退+候补）',
    D.core.confirmed_revenue_fen >= 0 && D.core.unconfirmed_revenue_fen >= 0 && D.core.refund_fen >= 0,
    `cf=${D.core.confirmed_revenue_fen} uf=${D.core.unconfirmed_revenue_fen} rf=${D.core.refund_fen}`);
  r = await req('GET', '/api/admin/dashboard?date=2026-01-01');
  const D2 = r.data || {};
  check('DASH-09', '指定历史日期生效（返回该日口径）',
    r.status === 200 && D2.date === '2026-01-01' && typeof D2.core.new_users === 'number',
    `date=${D2.date} br=${D2.core && D2.core.booking_rate}`);

  // ===== 6.9b 运营日报（DESIGN #D6）：规则引擎 / 惰性幂等 / 重新生成 / 占位 =====
  console.log('\n── 6.9b 运营日报 ──');
  // 清空历史报告，保证幂等断言从干净态开始（预清理未含 daily_reports）
  {
    const _dbx = require('../server/db.js');
    await _dbx.driver.run('DELETE FROM daily_reports');
  }
  r = await req('GET', '/api/admin/reports', null, { noToken: true });
  check('REP-01', '无 token 拉运营日报 → 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/reports?date=2026-8-1');
  check('REP-02', '非法 date 格式 → 400', r.status === 400, `status=${r.status}`);
  // 无数据历史日 → 占位（不落库）：2026-01-01 早于 seed 场次窗口（8/10~8/30）且无测试数据
  r = await req('GET', '/api/admin/reports?date=2026-01-01');
  check('REP-03', '无数据日返回占位（当日无运营数据）',
    r.status === 200 && r.data.empty === true && r.data.summary === '当日无运营数据',
    `empty=${r.data && r.data.empty} summary=${r.data && r.data.summary}`);
  {
    const _dbx = require('../server/db.js');
    const row = await _dbx.driver.get("SELECT * FROM daily_reports WHERE date = '2026-01-01'");
    check('REP-03b', '占位日不落库', !row, `row=${JSON.stringify(row)}`);
  }
  // 今日报告（seed 8/18 有场次 → 正常生成）
  r = await req('GET', `/api/admin/reports?date=${todayStr}`);
  const R1 = r.data || {};
  check('REP-04', '今日报告生成（summary/metrics/trends/actions 齐全）',
    r.status === 200 && R1.empty === false && typeof R1.summary === 'string' && R1.summary.length > 0
    && Array.isArray(R1.metrics) && R1.metrics.length >= 4
    && Array.isArray(R1.trends) && R1.trends.length >= 4
    && Array.isArray(R1.actions) && R1.actions.length >= 1,
    `summary=${R1.summary} m=${R1.metrics && R1.metrics.length} t=${R1.trends && R1.trends.length} a=${R1.actions && R1.actions.length}`);
  check('REP-04b', 'metrics 关键字段（label/value/flag/consecutive）',
    r.status === 200 && R1.metrics.every(m => m.label && m.value !== undefined && m.flag && m.consecutive),
    `first=${JSON.stringify(R1.metrics[0])}`);
  // 幂等：同日再访 generated_at 不变（惰性缓存命中）
  r = await req('GET', `/api/admin/reports?date=${todayStr}`);
  check('REP-05', '同日幂等（不重复生成）', r.status === 200 && r.data.generated_at === R1.generated_at,
    `g1=${R1.generated_at} g2=${r.data.generated_at}`);
  // 规则 2 断言：seed 8/18 场次 0 预约 → 订课率 0% < 60% → 排课建议
  const act2 = R1.actions.find(a => a.title.includes('订课率'));
  check('REP-07', '规则 2 触发：订课率<60% 出排课建议',
    !!act2 && act2.scope === '排课' && act2.severity === 'medium' && act2.suggestion.length > 0,
    `act=${JSON.stringify(act2)}`);
  // 趋势检测纯函数（连续 ≥3 天同向；持平中断）
  {
    const repMod = require('../server/db/report.js');
    const s1 = repMod.streakOf([10, 20, 30]);
    const s2 = repMod.streakOf([30, 20, 10, 5]);
    const s3 = repMod.streakOf([10, 10, 10]);
    const s4 = repMod.streakOf([5, 10, 8, 7]);
    check('REP-08', '趋势连续升降检测（streakOf）',
      s1.direction === 'up' && s1.streak === 3 && s2.direction === 'down' && s2.streak === 4
      && s3.direction === 'flat' && s4.direction === 'down' && s4.streak === 3,
      `s1=${JSON.stringify(s1)} s2=${JSON.stringify(s2)} s3=${JSON.stringify(s3)} s4=${JSON.stringify(s4)}`);
  }
  // 构造满员场次 → 重新生成 → 规则 3（热门课加场）触发
  await mkSession(todayStr, '23:30', '23:59', 1, 1);
  r = await req('GET', `/api/admin/reports?date=${todayStr}&regenerate=1`);
  const R2 = r.data || {};
  const act3 = R2.actions.find(a => a.title.includes('接近满员'));
  check('REP-09', '规则 3 触发：满员课建议加场（重新生成覆盖）',
    r.status === 200 && !!act3 && act3.scope === '排课' && act3.suggestion.includes('加场'),
    `act=${JSON.stringify(act3)}`);
  // 严重度排序：高→中→低
  const sevIdx = { high: 0, medium: 1, low: 2 };
  const sortedOk = R2.actions.every((a, i, arr) => i === 0 || sevIdx[arr[i - 1].severity] <= sevIdx[a.severity]);
  check('REP-10', '建议按严重度排序（高→中→低）', sortedOk, `sevs=${R2.actions.map(a => a.severity).join(',')}`);
  // 列表：无 date 返回最近 7 天（今天在列）
  r = await req('GET', '/api/admin/reports');
  check('REP-11', '无 date 返回报告列表（今天在列）',
    r.status === 200 && Array.isArray(r.data.reports) && r.data.reports.some(x => x.date === todayStr),
    `n=${r.data.reports && r.data.reports.length}`);

  // ===== 6.9.5 排课发布节奏（DESIGN #D10）：下一次发布日 = 最近未来周五 22:00（time.js 北京时间） =====
  console.log('\n── 排课发布节奏（DESIGN #D10）──');
  {
    const sch = require('../server/db/schedule.js');
    // 边界用例（Date 用 UTC 时刻构造，内部 time.parts 转北京时间——无系统时区依赖）
    const pWed = sch.nextPublishInfo(new Date('2026-08-19T12:00:00Z'));   // 北京周三 20:00
    const pFri21 = sch.nextPublishInfo(new Date('2026-08-21T13:00:00Z')); // 北京周五 21:00
    const pFri23 = sch.nextPublishInfo(new Date('2026-08-21T15:00:00Z')); // 北京周五 23:00
    const pSat = sch.nextPublishInfo(new Date('2026-08-22T00:30:00Z'));   // 北京周六 08:30
    const pNewYear = sch.nextPublishInfo(new Date('2026-12-31T10:00:00Z')); // 北京周四 18:00 → 跨年
    check('PUB-01', '周三 → 下一次发布 = 本周五（2026-08-21，text 不带年）',
      pWed.nextPublish === '2026-08-21' && pWed.text === '8月21日' && pWed.display === '2026-08-21 22:00',
      `nextPublish=${pWed.nextPublish} text=${pWed.text}`);
    check('PUB-02', '周五 21:00 → 本周五（未到 22:00）',
      pFri21.nextPublish === '2026-08-21', `nextPublish=${pFri21.nextPublish}`);
    check('PUB-03', '周五 23:00 → 下周五（已过 22:00）',
      pFri23.nextPublish === '2026-08-28', `nextPublish=${pFri23.nextPublish}`);
    check('PUB-04', '周六 → 下周五（2026-08-28）',
      pSat.nextPublish === '2026-08-28', `nextPublish=${pSat.nextPublish}`);
    check('PUB-06', '跨年（12-31 → 明年 1 月）文案带年',
      pNewYear.nextPublish === '2027-01-01' && pNewYear.text === '2027年1月1日',
      `nextPublish=${pNewYear.nextPublish} text=${pNewYear.text}`);
  }
  r = await req('GET', '/api/schedule/next-publish');
  check('PUB-05', '接口 GET /api/schedule/next-publish 返回结构（nextPublish/text/display）',
    r.status === 200 && r.data.code === 200 && typeof r.data.nextPublish === 'string'
      && typeof r.data.text === 'string' && r.data.text.length > 0 && / 22:00$/.test(r.data.display),
    `body=${r.raw && r.raw.slice(0, 160)}`);

  // ===== 6.10 用户分析（DESIGN #D4-3）：RMF 分层 / 时间线 / 群组触达 / CSV =====
  console.log('\n── 6.10 用户分析 ──');
  r = await req('GET', '/api/admin/users-analysis', null, { noToken: true });
  check('ANAL-01', '无 token 拉用户分析 → 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/users-analysis?page=1&page_size=20');
  const A = r.data || {};
  const a0 = A.users && A.users[0];
  check('ANAL-02', 'RMF 分层清单：分页+打分+沉睡字段齐全',
    r.status === 200 && typeof A.total === 'number' && A.pages >= 1 && A.users.length >= 1
    && a0 && typeof a0.r_level === 'number' && a0.r_level >= 1 && a0.r_level <= 5
    && typeof a0.f_level === 'number' && a0.m_level >= 1
    && ['0', '14', '30'].includes(a0.dormant) && (a0.r === null || typeof a0.r === 'number') && typeof a0.f === 'number' && typeof a0.m === 'number'
    && A.stats && typeof A.stats.total_users === 'number' && typeof A.stats.avg_m_fen === 'number',
    `total=${A.total} n=${A.users && A.users.length} u0=${JSON.stringify(a0 && { r: a0.r, f: a0.f, m: a0.m, rl: a0.r_level, d: a0.dormant })}`);
  // EVT-01（DESIGN #D5-5）：用户分析行含社交画像字段（gender 0=未知 1=男 2=女 / birthday YYYY-MM-DD，web 画像列/CSV 数据源）
  check('EVT-01', '用户分析含画像字段（gender/birthday，DESIGN #D5-5）',
    typeof a0.gender === 'number' && typeof a0.birthday === 'string',
    `gender=${a0 && a0.gender} birthday=${a0 && a0.birthday}`);
  // 排序：默认 monetary 降序
  r = await req('GET', '/api/admin/users-analysis?order=monetary&page_size=50');
  const A2 = r.data || {};
  const monOk = (A2.users || []).every((u, i, arr) => i === 0 || arr[i - 1].m >= u.m);
  check('ANAL-03', '默认按金额降序', r.status === 200 && monOk, `monOk=${monOk} top=${A2.users && A2.users[0] && A2.users[0].m}`);
  // 搜索昵称（user1 昵称在 AUTH-04 更新为「田立新版」）
  r = await req('GET', '/api/admin/users-analysis?q=' + encodeURIComponent('田立新版'));
  check('ANAL-04', '昵称搜索过滤', r.status === 200 && (r.data.users || []).length === 1 && r.data.users[0].openid === T.user1.openid,
    `n=${r.data.users && r.data.users.length} oid=${r.data.users && r.data.users[0] && r.data.users[0].openid}`);
  // 数值门槛（user1 已消费 → m>=1000 至少命中，且全部满足门槛）
  r = await req('GET', '/api/admin/users-analysis?m_min=1000');
  check('ANAL-05', '金额门槛筛选（全部满足 m>=1000）',
    r.status === 200 && r.data.users.length >= 1 && r.data.users.every(u => u.m >= 1000),
    `n=${r.data.users && r.data.users.length}`);
  // 沉睡档位参数合法（此时测试用户都有近行为 → dormant=14 无命中也正常）
  r = await req('GET', '/api/admin/users-analysis?dormant=30');
  check('ANAL-05b', '沉睡档位筛选参数生效', r.status === 200 && r.data.users.every(u => u.dormant === '30'),
    `n=${r.data.users && r.data.users.length}`);
  // 分页：page_size=1 第 2 页与第 1 页不同用户
  r = await req('GET', '/api/admin/users-analysis?page=1&page_size=1');
  const p1oid = r.data.users && r.data.users[0] && r.data.users[0].openid;
  r = await req('GET', '/api/admin/users-analysis?page=2&page_size=1');
  const p2oid = r.data.users && r.data.users[0] && r.data.users[0].openid;
  check('ANAL-05c', '分页生效（第 2 页不同用户）', r.status === 200 && !!p1oid && !!p2oid && p1oid !== p2oid,
    `p1=${p1oid} p2=${p2oid}`);
  // 个体时间线（user1 订课/支付过 → rows 含 book/order）
  r = await req('GET', `/api/admin/users-analysis/${T.user1.openid}/timeline`, null, { noToken: true });
  check('ANAL-06', '无 token 拉时间线 → 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', `/api/admin/users-analysis/${T.user1.openid}/timeline`);
  const tl = r.data && r.data.rows || [];
  check('ANAL-07', '行为时间线（订课/支付/余额类型齐全）',
    r.status === 200 && tl.length >= 1 && tl.some(x => x.type === 'book') && tl.some(x => x.type === 'order'),
    `n=${tl.length} types=${tl.map(x => x.type).join(',')}`);
  r = await req('GET', '/api/admin/users-analysis/nobody_timeline_x/timeline');
  check('ANAL-07b', '不存在用户时间线 → 空数组', r.status === 200 && Array.isArray(r.data.rows) && r.data.rows.length === 0, `n=${r.data.rows && r.data.rows.length}`);
  // 群组触达（站内信 promo + dedup 防重）
  r = await req('POST', '/api/admin/users-analysis/message', { openids: [T.user1.openid, T.user2.openid], title: '沉睡召回测试', content: '好久不见，送你一张体验课' });
  check('ANAL-08', '群组触达成功', r.status === 200 && r.data.sent === 2 && r.data.skipped === 0,
    `sent=${r.data.sent} skip=${r.data.skipped}`);
  r = await req('POST', '/api/admin/users-analysis/message', { openids: [T.user1.openid], title: '沉睡召回测试', content: '再发一次' });
  check('ANAL-08b', '同标题重复触达去重（dedup_key）', r.status === 200 && r.data.sent === 0 && r.data.skipped === 1,
    `sent=${r.data.sent} skip=${r.data.skipped}`);
  r = await req('POST', '/api/admin/users-analysis/message', { openids: Array.from({ length: 201 }, (_, i) => 'fake' + i), title: '超量测试' });
  check('ANAL-08c', '超过 200 人拒绝', r.status === 400, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/admin/users-analysis/message', { openids: [T.user1.openid] });
  check('ANAL-08d', '缺标题拒绝', r.status === 400, `status=${r.status} msg=${r.data && r.data.message}`);
  // CSV 导出（同筛选参数，复用 B3 导出模式）
  r = await req('GET', '/api/admin/export/user-analysis', null, { noToken: true });
  check('ANAL-09', '无 token 导出用户分析 → 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/export/user-analysis?q=' + encodeURIComponent('田立新版'));
  check('ANAL-09b', '用户分析 CSV（BOM+表头+RMF 字段+偏好标签）',
    r.status === 200 && r.raw.charCodeAt(0) === 0xFEFF && r.raw.includes('近度R(天)') && r.raw.includes('沉睡档位') && r.raw.includes('偏好标签') && r.raw.includes(T.user1.openid),
    `head=${r.raw.slice(0, 60)}`);
  // 偏好标签（DESIGN #D4-4）：列表带标签、标签筛选、行为特质
  r = await req('GET', '/api/admin/users-analysis?q=' + encodeURIComponent('田立新版'));
  const ua1 = r.data && r.data.users && r.data.users[0];
  check('ANAL-10', '列表返回偏好标签（课程/教练/支付习惯/特质）',
    r.status === 200 && ua1 && Array.isArray(ua1.labels) && ua1.labels.length >= 1
    && ua1.labels.some(l => l.includes('储值') || l.includes('次卡') || l.includes('最爱课')),
    `labels=${JSON.stringify(ua1 && ua1.labels)}`);
  r = await req('GET', '/api/admin/users-analysis?labels=' + encodeURIComponent('储值用户'));
  check('ANAL-11', '偏好标签筛选（储值用户）',
    r.status === 200 && r.data.users.length >= 1 && r.data.users.every(u => u.labels.some(l => l.includes('储值用户'))),
    `n=${r.data.users && r.data.users.length} first=${JSON.stringify(r.data.users && r.data.users[0] && r.data.users[0].labels)}`);

  // ===== 6.11 浏览埋点（DESIGN #D5）：采集校验 / 浏览分析 =====
  console.log('\n── 6.11 浏览埋点 ──');
  r = await req('POST', '/api/track/batch', { events: [{ event_type: 'page_view' }] });
  check('TRK-01', '无 openid → 400', r.status === 400, `status=${r.status}`);
  r = await req('POST', '/api/track/batch', { openid: T.user1.openid, events: 'not-array' });
  check('TRK-02', 'events 非数组 → 400', r.status === 400, `status=${r.status}`);
  r = await req('POST', '/api/track/batch', { openid: T.user1.openid, events: Array.from({ length: 51 }, () => ({ event_type: 'page_view' })) });
  check('TRK-03', '批量上限 50 → 400', r.status === 400, `status=${r.status}`);
  // 合法批量：page_view×1 + course_view×1 + search×1（其中混 1 条白名单外事件）
  r = await req('POST', '/api/track/batch', {
    openid: T.user1.openid,
    events: [
      { event_type: 'page_view', page: 'index', session_id: 'sess-trk-1' },
      { event_type: 'course_view', target_id: 99999, source: 'search', page: 'detail', session_id: 'sess-trk-1', duration_ms: 1234 },
      { event_type: 'search', keyword: '搏击', session_id: 'sess-trk-1' },
      { event_type: 'evil_event', page: 'x' }   // 白名单外 → 丢弃
    ]
  });
  check('TRK-04', '批量上报：合法 3 条入账、非法丢弃', r.status === 200 && r.data.accepted === 3, `accepted=${r.data && r.data.accepted}`);
  // 直查库确认落库（含 keyword/source/duration）
  {
    const _dbx = require('../server/db.js');
    const ev = await _dbx.driver.all("SELECT * FROM course_events WHERE session_id = 'sess-trk-1' ORDER BY id");
    check('TRK-05', 'course_events 落库字段完整（keyword/source/duration_ms）',
      ev.length === 3
      && ev.some(e => e.event_type === 'search' && e.keyword === '搏击')
      && ev.some(e => e.event_type === 'course_view' && e.target_id === 99999 && e.duration_ms === 1234 && e.source === 'search')
      && ev.some(e => e.event_type === 'page_view' && e.page === 'index'),
      `n=${ev.length} types=${ev.map(e => e.event_type).join(',')}`);
  }
  // 浏览分析：无 token → 401（并入 ADMIN_PATHS）
  r = await req('GET', '/api/admin/events-analysis', null, { noToken: true });
  check('TRK-06', '无 token 拉浏览分析 → 401', r.status === 401, `status=${r.status}`);
  // 构造意图人群：同一用户同一课程浏览 2 次（未订过该课）
  r = await req('POST', '/api/track/batch', {
    openid: T.user2.openid,
    events: [
      { event_type: 'course_view', target_id: 99998, page: 'detail', session_id: 'sess-intent-1' },
      { event_type: 'course_view', target_id: 99998, page: 'detail', session_id: 'sess-intent-2' }
    ]
  });
  r = await req('GET', '/api/admin/events-analysis');
  const evA = r.data || {};
  check('TRK-07', '浏览分析结构（漏斗/意图/搜索词/热度）',
    r.status === 200
    && evA.funnel && typeof evA.funnel.expose === 'number' && typeof evA.funnel.detail === 'number' && typeof evA.funnel.booked === 'number' && typeof evA.funnel.checkin === 'number'
    && Array.isArray(evA.intent) && Array.isArray(evA.search.top) && Array.isArray(evA.hot_by_view),
    `funnel=${JSON.stringify(evA.funnel)}`);
  check('TRK-08', '意图人群：7 天内浏览≥2 次未订课程命中',
    Array.isArray(evA.intent) && evA.intent.some(i => i.target_id === 99998 && i.view_count >= 2 && i.openid === T.user2.openid),
    `intent=${JSON.stringify(evA.intent)}`);
  check('TRK-09', '搜索词 TOP 含「搏击」', Array.isArray(evA.search.top) && evA.search.top.some(s => s.keyword === '搏击'),
    `top=${JSON.stringify(evA.search.top)}`);
  r = await req('GET', '/api/admin/events-analysis?date=2026-99-99');
  check('TRK-10', 'date 非法格式 → 400', r.status === 400, `status=${r.status}`);

  // ===== 6.12 社交画像（DESIGN #D5-3）：性别/生日 + 填单 20 能量币 =====
  console.log('\n── 6.12 社交画像 ──');
  r = await req('GET', '/api/me/profile');
  check('PROF-01', '缺 openid → 400', r.status === 400, `status=${r.status}`);
  r = await req('GET', '/api/me/profile?openid=uid_nobody');
  check('PROF-02', '不存在用户 → 404', r.status === 404, `status=${r.status}`);
  const profOpenid = 'uid_test_prof';
  await req('POST', '/api/auth/login', { openid: profOpenid, nickname: '画像测试' });
  r = await req('GET', `/api/me/profile?openid=${profOpenid}`);
  check('PROF-03', '未填画像默认值（0 未知/空生日/未领奖）',
    ok(r, 200) && r.data.profile.gender === 0 && r.data.profile.birthday === '' && r.data.profile.profile_bonus_claimed === false,
    `profile=${JSON.stringify(r.data && r.data.profile)}`);
  r = await req('PUT', '/api/me/profile', { openid: profOpenid, gender: 5 });
  check('PROF-04', '非法性别 → 400', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('PUT', '/api/me/profile', { openid: profOpenid, birthday: '2026-13-01' });
  check('PROF-05', '非法生日（13 月）→ 400', r.status === 400, `msg=${r.data && r.data.message}`);
  const profBirth = `${timeMod.parts().y}-${String(timeMod.parts().mo).padStart(2, '0')}-15`; // 本月 15 号（顺带测生日月标记）
  r = await req('PUT', '/api/me/profile', { openid: profOpenid, gender: 1, birthday: profBirth });
  check('PROF-06', '首次填写成功 + 20 能量币', ok(r, 200) && r.data.bonusCoins === 20 && r.data.profile.gender === 1 && r.data.profile.birthday === profBirth, `bonus=${r.data && r.data.bonusCoins} profile=${JSON.stringify(r.data && r.data.profile)}`);
  {
    const _dbx = require('../server/db.js');
    const row = await _dbx.driver.get('SELECT gender, birthday, profile_bonus_claimed FROM users WHERE openid = ?', [profOpenid]);
    check('PROF-07', '画像落库（gender/birthday/bonus_claimed）', row && row.gender === 1 && row.birthday === profBirth && row.profile_bonus_claimed === 1, `row=${JSON.stringify(row)}`);
    const coins = await _dbx.driver.all("SELECT `change`, reason FROM coin_logs WHERE user_openid = ? AND reason = '完善画像奖励'", [profOpenid]);
    check('PROF-08', '能量币流水留痕（+20 完善画像奖励）', coins.length === 1 && coins[0].change === 20, `coins=${JSON.stringify(coins)}`);
  }
  r = await req('GET', `/api/me/profile?openid=${profOpenid}`);
  check('PROF-09', '生日月标记 in_birthday_month=true', r.data.profile.in_birthday_month === true, `profile=${JSON.stringify(r.data && r.data.profile)}`);
  r = await req('PUT', '/api/me/profile', { openid: profOpenid, gender: 2 });
  check('PROF-10', '重复填写不再发币且性别可改', ok(r, 200) && r.data.bonusCoins === 0 && r.data.profile.gender === 2, `bonus=${r.data && r.data.bonusCoins} gender=${r.data && r.data.profile && r.data.profile.gender}`);
  // EVT-02~04（DESIGN #D5-5）：用户分析画像筛选（gender / birthday_month / age_range）——profOpenid 现为 gender=2 + 生日=本月-15
  r = await req('GET', '/api/admin/users-analysis?gender=2&page_size=100');
  check('EVT-02', '性别筛选：gender=2 全命中且含画像测试用户',
    r.status === 200 && (r.data.users || []).some(u => u.openid === profOpenid) && r.data.users.every(u => u.gender === 2),
    `n=${r.data.users && r.data.users.length} hit=${(r.data.users || []).some(u => u.openid === profOpenid)}`);
  const bm = String(timeMod.parts().mo).padStart(2, '0');
  r = await req('GET', `/api/admin/users-analysis?birthday_month=${bm}&page_size=100`);
  check('EVT-03', '生日月筛选：当月命中画像测试用户且全部匹配',
    r.status === 200 && (r.data.users || []).some(u => u.openid === profOpenid)
    && r.data.users.every(u => (u.birthday || '').slice(5, 7) === bm),
    `n=${r.data.users && r.data.users.length}`);
  {
    const _dbx = require('../server/db.js');
    const ageOpenid = 'uid_test_age';
    await req('POST', '/api/auth/login', { openid: ageOpenid, nickname: '年龄筛选' });
    await _dbx.driver.run('UPDATE users SET birthday = ? WHERE openid = ?', [`${timeMod.parts().y}-01-01`, ageOpenid]); // 今年出生 → 0 岁
    r = await req('GET', '/api/admin/users-analysis?age_range=u18&page_size=100');
    check('EVT-04', '年龄段筛选：u18 命中未成年画像用户',
      r.status === 200 && (r.data.users || []).some(u => u.openid === ageOpenid),
      `n=${r.data.users && r.data.users.length} hit=${(r.data.users || []).some(u => u.openid === ageOpenid)}`);
    r = await req('GET', '/api/admin/users-analysis?gender=0&age_range=46%2B');
    check('EVT-05', '组合筛选（未填性别×46+）不报错且空集合法', r.status === 200 && Array.isArray(r.data.users), `status=${r.status}`);
  }

  // ===== 6.13 生日月首订 8 折（DESIGN #D5-4）：储值支付书订单生日月首单自动 8 折（与会员价取更优，向下取整到元）=====
  console.log('\n── 6.13 生日月首订 8 折 ──');
  {
    const _dbx = require('../server/db.js');
    const bdayOpenid = 'uid_test_bday';
    await req('POST', '/api/auth/login', { openid: bdayOpenid, nickname: '生日测试' });
    const bmonth = `${timeMod.parts().y}-${String(timeMod.parts().mo).padStart(2, '0')}`;
    // 直连造当月生日 + 余额 100 元（绕开充值链路）
    await _dbx.driver.run('UPDATE users SET birthday = ?, balance_fen = 10000 WHERE openid = ?', [`${bmonth}-10`, bdayOpenid]);
    const bdaySid = await mkSession(todayStr, '22:00', '23:00', 5, 0);
    r = await req('POST', '/api/orders', { openid: bdayOpenid, sessionId: bdaySid, amountFen: 6800 });
    check('BDAY-01', '生日月订课下单', ok(r, 201), `msg=${r.data && r.data.message}`);
    const bdayOrdId = r.data.order.id;
    r = await req('POST', `/api/orders/${bdayOrdId}/pay`, { openid: bdayOpenid, payMethod: 'balance' });
    check('BDAY-02', '生日月首订支付成功', ok(r, 200) && r.data.booking, `msg=${r.data && r.data.message}`);
    const bdayOrd = await _dbx.driver.get('SELECT amount_fen FROM orders WHERE id = ?', [bdayOrdId]);
    const bdayBk = await _dbx.driver.get('SELECT amount_fen FROM bookings WHERE user_openid = ? AND session_id = ?', [bdayOpenid, bdaySid]);
    // 6800×0.8=5440 → 向下取整到元 = 5400（54 元）；会员价（青铜 98 折）6600 → 取更优 5400
    check('BDAY-03', '首订实付 8 折（5400，与会员价取更优）', bdayOrd.amount_fen === 5400 && bdayBk.amount_fen === 5400, `order=${bdayOrd.amount_fen} booking=${bdayBk.amount_fen}`);
    const bdayBal = await _dbx.driver.get('SELECT balance_fen FROM users WHERE openid = ?', [bdayOpenid]);
    check('BDAY-04', '余额按 8 折价扣除（100−54=46 元）', bdayBal.balance_fen === 4600, `balance=${bdayBal.balance_fen}`);
    const bdayMsg = await _dbx.driver.get('SELECT content FROM messages WHERE user_openid = ? ORDER BY id DESC LIMIT 1', [bdayOpenid]);
    check('BDAY-05', '站内信标注生日月首订 8 折', !!bdayMsg && (bdayMsg.content || '').includes('生日月首订 8 折'), `msg=${bdayMsg && bdayMsg.content}`);
    // 第二单：当月已有 paid 书订单 → 8 折不再适用，回会员价 6600（先重置余额，第一单扣了 54 元）
    await _dbx.driver.run('UPDATE users SET balance_fen = 10000 WHERE openid = ?', [bdayOpenid]);
    // 第二单时段须与第一单（22:00-23:00）不重叠——DESIGN #D14 同一时间只能订一堂课查重（邻接 21:00-22:00 合法）
    const bdaySid2 = await mkSession(todayStr, '21:00', '22:00', 5, 0);
    r = await req('POST', '/api/orders', { openid: bdayOpenid, sessionId: bdaySid2, amountFen: 6800 });
    const bdayOrdId2 = r.data.order.id;
    r = await req('POST', `/api/orders/${bdayOrdId2}/pay`, { openid: bdayOpenid, payMethod: 'balance' });
    const bdayOrd2 = await _dbx.driver.get('SELECT amount_fen FROM orders WHERE id = ?', [bdayOrdId2]);
    check('BDAY-06', '当月第二单回会员价（6600，8 折仅首单）', ok(r, 200) && bdayOrd2.amount_fen === 6600, `amount=${bdayOrd2.amount_fen} msg=${r.data && r.data.message}`);
    // 非生日月对照：仅会员价
    const plainOpenid = 'uid_test_plain';
    await req('POST', '/api/auth/login', { openid: plainOpenid, nickname: '对照用户' });
    await _dbx.driver.run('UPDATE users SET birthday = ?, balance_fen = 10000 WHERE openid = ?', ['2000-01-10', plainOpenid]);
    const plainSid = await mkSession(todayStr, '21:30', '22:30', 5, 0);
    r = await req('POST', '/api/orders', { openid: plainOpenid, sessionId: plainSid, amountFen: 6800 });
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: plainOpenid, payMethod: 'balance' });
    const plainOrd = await _dbx.driver.get('SELECT amount_fen FROM orders WHERE user_openid = ? ORDER BY id DESC LIMIT 1', [plainOpenid]);
    check('BDAY-07', '非生日月仅会员价（6600）', r.data.booking && plainOrd.amount_fen === 6600, `amount=${plainOrd.amount_fen} msg=${r.data && r.data.message}`);
    // 清理测试数据
    await _dbx.driver.run('DELETE FROM bookings WHERE user_openid IN (?, ?)', [bdayOpenid, plainOpenid]);
    await _dbx.driver.run('DELETE FROM orders WHERE user_openid IN (?, ?)', [bdayOpenid, plainOpenid]);
    await _dbx.driver.run('DELETE FROM messages WHERE user_openid IN (?, ?)', [bdayOpenid, plainOpenid]);
  }

  // ===== 6.5 教练工作台（DESIGN #D1）：我的学员 / 笔记 / 结算 / 设教练 =====
  console.log('\n── 6.5 教练工作台 ──');
  const now2 = new Date();
  const curMonth = `${timeMod.parts().y}-${String(timeMod.parts().mo).padStart(2, '0')}`;

  // 未绑定档案 → 404
  r = await req('GET', '/api/coach/students?coach_openid=' + T.coach.openid);
  check('COACH-01', '未绑定档案404', r.status === 404, `status=${r.status}`);
  // 设教练：绑定测试教练 → coaches#1；再绑 user2 → coaches#2（隔离测试用）
  r = await req('POST', '/api/admin/coach-assign', { openid: T.coach.openid, coach_id: 1 });
  check('COACH-07', '设教练成功', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/admin/coach-assign', { openid: T.coach.openid, coach_id: 1 });
  check('COACH-07b', '重复绑定幂等', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/admin/coach-assign', { openid: 'uid_test_nobody', coach_id: 1 });
  check('COACH-08', '账号不存在拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/admin/coach-assign', { openid: T.coach.openid, coach_id: 9999 });
  check('COACH-08b', '档案不存在拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/admin/coach-assign', { openid: T.user2.openid, coach_id: 2 });
  check('COACH-08c', 'user2绑定档案2', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/admin/coach-assign', { openid: T.user1.openid, coach_id: 2 });
  check('COACH-08d', '档案已占用拒绝', r.status === 400, `msg=${r.data && r.data.message}`);

  // 造当天窗口场次 + 订课 + 支付 + 签到（自足链路，不依赖 CHK 分支是否跳过）
  const coEnd = new Date(now2.getTime() + 40 * 60000);
  const coStart = new Date(now2.getTime() - 20 * 60000);
  if (timeMod.parts(coStart).d === timeMod.parts(now2).d && timeMod.parts(coEnd).d === timeMod.parts(now2).d) {
    const coSid = await mkSession(todayStr, beijingHM(coStart), beijingHM(coEnd), 5, 0);
    // 新查重（DESIGN #D14「同一时间只能订一堂课」）：CHK 块同窗场次 user1 已订+签到（status 仍 booked）
    // → 先直连删除该订课（签到已完成，删除不影响后续断言），否则 coSid 下单被查重拦截（2026-08-20 修）
    await _dbx.driver.run(`DELETE FROM bookings WHERE user_openid = ? AND session_id IN
      (SELECT id FROM course_sessions WHERE date = ? AND start_time = ? AND end_time = ?)`,
      [T.user1.openid, todayStr, beijingHM(coStart), beijingHM(coEnd)]);
    r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: coSid, amountFen: 6800, orderType: 'book' });
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: T.user1.openid, payMethod: 'balance' });
    r = await req('POST', `/api/bookings/${r.data.booking.id}/checkin`, { openid: T.coach.openid });
    check('COACH-09', '窗口内签到成功', ok(r, 200) && r.data.booking.checkin_at, `checkin=${r.data && r.data.booking && r.data.booking.checkin_at}`);
    // 我的学员：user1 已收录（含最近课程/日期/总课次）
    r = await req('GET', '/api/coach/students?coach_openid=' + T.coach.openid);
    const stu = (r.data.students || []).find(s => s.openid === T.user1.openid);
    check('COACH-02', '我的学员聚合', ok(r, 200) && stu && stu.last_course && stu.last_date && typeof stu.has_note === 'number' && typeof stu.total_classes === 'number', `stu=${JSON.stringify(stu)}`);
    // 笔记 upsert（写→覆盖→读）
    r = await req('PUT', '/api/coach/notes', { coach_openid: T.coach.openid, student_openid: T.user1.openid, content: '膝盖旧伤，注意热身' });
    check('COACH-03', '笔记写入', ok(r, 200) && r.data.note.content === '膝盖旧伤，注意热身', `note=${JSON.stringify(r.data && r.data.note)}`);
    r = await req('PUT', '/api/coach/notes', { coach_openid: T.coach.openid, student_openid: T.user1.openid, content: '状态良好' });
    check('COACH-03b', '笔记upsert覆盖', ok(r, 200) && r.data.note.content === '状态良好', `note=${JSON.stringify(r.data && r.data.note)}`);
    r = await req('GET', '/api/coach/notes?coach_openid=' + T.coach.openid + '&student_openid=' + T.user1.openid);
    check('COACH-03c', '笔记读取', ok(r, 200) && r.data.note.content === '状态良好', `note=${JSON.stringify(r.data && r.data.note)}`);
    // 学员列表 has_note 联动
    r = await req('GET', '/api/coach/students?coach_openid=' + T.coach.openid);
    const stu2 = (r.data.students || []).find(s => s.openid === T.user1.openid);
    check('COACH-03d', 'has_note标记', ok(r, 200) && stu2 && stu2.has_note === 1, `has_note=${stu2 && stu2.has_note}`);
    // 笔记隔离：另一教练（user2）读不到 user1 的笔记
    r = await req('GET', '/api/coach/notes?coach_openid=' + T.user2.openid + '&student_openid=' + T.user1.openid);
    check('COACH-04', '笔记隔离', ok(r, 200) && r.data.note.content === '', `note=${JSON.stringify(r.data && r.data.note)}`);
    // 结算：本月聚合 + 金额公式（课次×课时费 + 签到×奖励，配置单源）
    r = await req('GET', `/api/coach/settlement?coach_id=1&month=${curMonth}`);
    const st = r.data && r.data.settlement;
    check('COACH-05', '结算聚合', ok(r, 200) && st && st.checkins >= 1 && st.total_fen === st.sessions * 10000 + st.checkins * 500, `s=${JSON.stringify(st)}`);
    check('COACH-05b', '结算配置单源', ok(r, 200) && st && st.course_fee_fen === 10000 && st.reward_fen === 500, `fee=${st && st.course_fee_fen} reward=${st && st.reward_fen}`);
  } else {
    console.log('  [跳过] 深夜/凌晨 COACH 签到链路用例（now±跨天造数不安全）');
  }
  // 结算参数校验
  r = await req('GET', '/api/coach/settlement?coach_id=1&month=2026-13');
  check('COACH-06', '非法月份拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/coach/settlement?coach_id=1&month=abc');
  check('COACH-06b', '非数字月份拒绝', r.status === 400, `msg=${r.data && r.data.message}`);

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

  // B3 退订截止（2026-08-18 用户拍板：开课前 2 小时内不可退订）——造「开课前 1 小时」场次 → 订课支付 → 退订被拒
  {
    // 新查重（DESIGN #D14 候补也占查重名额）：WTL-09「课前1小时」候补因 2 小时截止无法退出 → 残留 waiting 占位
    // → ORD-10 订同窗场次前直连清理（连带其订单；无 FK 引用 waitlist 的列，balance_logs 留痕不受影响）
    await _dbx.driver.run("DELETE FROM orders WHERE user_openid = ? AND wait_id IN (SELECT id FROM waitlist WHERE user_openid = ? AND status = 'waiting')", [T.user2.openid, T.user2.openid]);
    await _dbx.driver.run("DELETE FROM waitlist WHERE user_openid = ? AND status = 'waiting'", [T.user2.openid]);
    const _cut = timeMod.addMinutesStr(timeMod.nowDateTimeStr(), 60);   // 北京时间 now+1h（addMinutesStr 跨天安全）
    const [cutD, cutT] = _cut.split(' ');
    const cutEnd = timeMod.addMinutesStr(_cut, 60).split(' ')[1].slice(0, 5);
    const cutSid = await mkSession(cutD, cutT.slice(0, 5), cutEnd, 5, 0);
    await _dbx.driver.run("UPDATE users SET balance_fen = balance_fen + 100000 WHERE openid = ?", [T.user2.openid]);
    r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: cutSid, amountFen: 6800, orderType: 'book' });
    check('ORD-10-1', '课前1小时场次下单', r.status === 201, `msg=${r.data && r.data.message}`);
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: T.user2.openid, payMethod: 'balance' });
    check('ORD-10-2', '课前1小时场次支付', ok(r, 200) && r.data.booking, `msg=${r.data && r.data.message}`);
    const cutBookingId = r.data.booking && r.data.booking.id;
    if (cutBookingId) {
      r = await req('DELETE', `/api/bookings/${cutBookingId}?openid=${T.user2.openid}`);
      check('ORD-10', '课前2小时内退订拒绝', r.status === 400 && (r.data.message || '').includes('2 小时'), `status=${r.status} msg=${r.data && r.data.message}`);
      // 拒绝后订课仍在（未被误删/误退款）
      r = await req('GET', `/api/bookings?openid=${T.user2.openid}`);
      check('ORD-10b', '拒绝退订后订课保留', (r.data.bookings || []).some(b => b.id === cutBookingId && b.status === 'booked'), '订课记录丢失');
    } else {
      check('ORD-10', '课前2小时内退订拒绝', false, '支付未成功');
    }
  }

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
  r = await req('POST', `/api/orders/${ordSid3}/pay`, { openid: T.user1.openid, payMethod: 'balance' });
  check('SEC-04b-2', '订满链路支付', ok(r, 200) && r.data.booking, `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/sessions/${fullSid3}`);
  check('SEC-04b', '支付满员后场次状态=full', ok(r, 200) && r.data.session.status === 'full', `status=${r.data && r.data.session && r.data.session.status}`);
  // SEC-04c：真实订满（status=full）后仍可排候补（回归 BUG-LEDGER #5：syncSessionStatus 置 full 曾卡死候补入口，旧测试用初始published场次掩盖）
  r = await req('POST', '/api/waitlist', { openid: T.user2.openid, sessionId: fullSid3, amountFen: 6800 });
  check('SEC-04c', '满员(full)场次可排候补', r.status === 201, `status=${r.status} msg=${r.data && r.data.message}`);
  // SEC-04d：满员场次在列表可见（回归 BUG-LEDGER #7：status=full 曾被列表过滤，用户看不到满员课、无候补入口）
  r = await req('GET', `/api/sessions?date=${todayStr}`);
  const fullVisible = (r.data.sessions || []).some(s => s.id === fullSid3 && s.status === 'full');
  check('SEC-04d', '满员场次列表可见', ok(r, 200) && fullVisible, `ids=${r.data.sessions && r.data.sessions.map(s => s.id).join(',')}`);
  // SEC-05：支付容量闸门（回归 BUG-LEDGER #57 超卖——下单时有余位、支付时已满，支付必须原子闸门拒绝并全量回滚）
  // 并发超卖根因：createOrder 的 remaining 检查是宽松快照（下单不占位），支付才占位——并发下单-支付下
  // 多人都能支付成功 = 超卖（压测 500 并发暴露：容量 10 的课 256 人支付成功）。
  // 直连 SQL 造 pending 订单绕过下单检查，模拟「下单窗口有余位 → 支付前位置被抢光」。
  const gateSid = await mkSession(todayStr, '23:45', '24:45', 1, 1);   // 容量1、初始已满
  const gateBal0 = (await _dbx.driver.get('SELECT balance_fen FROM users WHERE openid = ?', [T.holder.openid])).balance_fen;
  const gateR = await _dbx.driver.run(`INSERT INTO orders (order_no, user_openid, session_id, order_type, amount_fen, status, expire_mode)
              VALUES (?, ?, ?, 'book', 6800, 'pending', 'start')`, ['GT' + Date.now(), T.holder.openid, gateSid]);
  r = await req('POST', `/api/orders/${gateR.lastInsertRowid}/pay`, { openid: T.holder.openid, payMethod: 'balance' });
  check('SEC-05-1', '满员时支付拒绝', r.status === 400 && (r.data.message || '').includes('满员'), `status=${r.status} msg=${r.data && r.data.message}`);
  const gateRow = await _dbx.driver.get('SELECT booked_count FROM course_sessions WHERE id = ?', [gateSid]);
  check('SEC-05-2', '拒绝后余位未变(无超卖占位)', gateRow.booked_count === 1, `booked_count=${gateRow.booked_count}`);
  const gateBal1 = (await _dbx.driver.get('SELECT balance_fen FROM users WHERE openid = ?', [T.holder.openid])).balance_fen;
  check('SEC-05-3', '拒绝后余额未扣(事务回滚)', gateBal1 === gateBal0, `余额 ${gateBal0}→${gateBal1}`);
  const gateOrd = await _dbx.driver.get('SELECT status FROM orders WHERE id = ?', [gateR.lastInsertRowid]);
  check('SEC-05-4', '订单已作废(满员拒绝不留 pending 死锁)', gateOrd && gateOrd.status === 'cancelled', `status=${gateOrd && gateOrd.status}`);
  // 创建课程缺参已在 CRS-02 覆盖
  r = await req('POST', '/api/courses/9999/publish', {});
  check('CRS-04a', '发布缺日期参数', r.status === 400 && (r.data.message || '').includes('日期'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/courses/9999/publish', { start_date: '2026-08-11', end_date: '2026-08-17' });
  check('CRS-04b', '发布不存在课程', r.status === 404 && (r.data.message || '').includes('不存在'), `status=${r.status} msg=${r.data && r.data.message}`);
  // CRS-05 排课冲突检测（用户要求：同一场地不允许时间重合的课程）
  r = await req('POST', '/api/courses', { name: '冲突测试课', category: '测试分类' });
  const crsCid = r.data.course && r.data.course.id;
  if (crsCid) {
    // 05c 规则自冲突（同星期同场地时间重叠 → 拒绝）
    r = await req('PUT', `/api/courses/${crsCid}/rules`, { rules: [
      { weekday: 1, start_time: '10:00', end_time: '11:00', venue_id: 1, coach_id: 1, capacity: 5 },
      { weekday: 1, start_time: '10:30', end_time: '11:30', venue_id: 1, coach_id: 1, capacity: 5 }
    ] });
    check('CRS-05c', '规则自冲突拒绝', r.status === 400 && (r.data.message || '').includes('冲突'), `status=${r.status} msg=${r.data && r.data.message}`);
    // 05a 直插与今天 21:00-22:00 场次重叠的规则（21:30-22:30）——B3 后保存阶段会拦截「模板 vs 模板」跨课程冲突，
    // 本用例保留原意图：测发布阶段「模板 vs 已有场次」冲突跳过，故绕过保存校验直插
    await db.driver.run(`INSERT INTO schedule_templates (course_id, weekday, start_time, end_time, venue_id, coach_id, capacity)
                   VALUES (?, ?, '21:30', '22:30', 1, 1, 5)`,
      [crsCid, new Date(todayStr + 'T00:00:00').getDay() || 7]);
    check('CRS-05a', '直插冲突规则(测发布跳过)', true, '');
    // 05 发布 → 与已有场次同场地时间重叠 → 跳过（created=0, conflicts>=1）
    r = await req('POST', `/api/courses/${crsCid}/publish`, { start_date: todayStr, end_date: todayStr });
    check('CRS-05', '冲突场次发布被跳过', ok(r, 200) && r.data.created === 0 && (r.data.conflicts || []).length >= 1, `created=${r.data.created} conflicts=${r.data.conflicts && r.data.conflicts.length}`);
    // 05b 清理测试课程
    r = await req('DELETE', `/api/courses/${crsCid}`);
    check('CRS-05b', '清理冲突测试课程', ok(r, 200), `msg=${r.data && r.data.message}`);
  } else {
    check('CRS-05', '创建冲突测试课程', false, '创建课程失败');
  }
  // CRS-06 跨课程排课冲突（B3 2026-08-18）：新课程规则与其他课程同场地/同教练时间重叠 → 拒绝保存
  // 自造参照课程 C（凌晨时段避开 seed 模板，不依赖 seed 具体数据），课程 B 与之比较
  r = await req('POST', '/api/courses', { name: '跨课参照课C', category: '测试分类' });
  const crsCId = r.data.course && r.data.course.id;
  r = await req('POST', '/api/courses', { name: '跨课冲突测试课', category: '测试分类' });
  const crsBId = r.data.course && r.data.course.id;
  if (crsCId && crsBId) {
    // C 的规则：周3 03:00-04:00（凌晨，无 seed 模板可冲突）
    r = await req('PUT', `/api/courses/${crsCId}/rules`, { rules: [{ weekday: 3, start_time: '03:00', end_time: '04:00', venue_id: 1, coach_id: 1, capacity: 5 }] });
    check('CRS-06c', '参照课C保存规则', ok(r, 200), `msg=${r.data && r.data.message}`);
    if (ok(r, 200)) {
      // B 与 C 同场地同时段重叠（03:30 < 04:00 且 04:30 > 03:00）→ 场地冲突拒绝
      r = await req('PUT', `/api/courses/${crsBId}/rules`, { rules: [{ weekday: 3, start_time: '03:30', end_time: '04:30', venue_id: 1, coach_id: 1, capacity: 5 }] });
      check('CRS-06', '跨课程同场地重叠拒绝', r.status === 400 && (r.data.message || '').includes('场地时间重叠'), `status=${r.status} msg=${r.data && r.data.message}`);
      // 换场地同教练 → 教练重叠拒绝
      r = await req('PUT', `/api/courses/${crsBId}/rules`, { rules: [{ weekday: 3, start_time: '03:30', end_time: '04:30', venue_id: 999, coach_id: 1, capacity: 5 }] });
      check('CRS-06b', '跨课程同教练重叠拒绝', r.status === 400 && (r.data.message || '').includes('教练时间重叠'), `status=${r.status} msg=${r.data && r.data.message}`);
      // 不同星期 → 不重叠 → 保存成功
      r = await req('PUT', `/api/courses/${crsBId}/rules`, { rules: [{ weekday: 4, start_time: '03:00', end_time: '04:00', venue_id: 1, coach_id: 1, capacity: 5 }] });
      check('CRS-06e', '跨课程不重叠保存成功', ok(r, 200), `msg=${r.data && r.data.message}`);
    }
    r = await req('DELETE', `/api/courses/${crsCId}`);
    r = await req('DELETE', `/api/courses/${crsBId}`);
    check('CRS-06d', '清理跨课程测试课', ok(r, 200), `msg=${r.data && r.data.message}`);
  } else {
    check('CRS-06', '跨课程同场地重叠拒绝', false, '创建课程失败');
    check('CRS-06b', '跨课程同教练重叠拒绝', false, '创建课程失败');
    check('CRS-06e', '跨课程不重叠保存成功', false, '创建课程失败');
  }

  // ===== 9. 会员体系 =====
  console.log('\n── 9. 会员体系 ──');
  r = await req('GET', `/api/member/level?openid=${T.user1.openid}`);
  check('MEM-01', '会员等级查询', ok(r, 200) && r.data.level && r.data.level.levelName, `level=${r.data && r.data.level && r.data.level.levelName}`);
  r = await req('GET', '/api/member/plans');
  check('MEM-02', '充值套餐列表', ok(r, 200) && r.data.plans.length === 3, `count=${r.data && r.data.plans && r.data.plans.length}`);
  // 储值充值：下单 → 支付 → 余额增加（500 档首充送 30% = 150 → 共 650）
  // 2026-08-18：B2 后订课/候补测试走 balance 消费，余额非固定值——改用「充值到账差值」断言
  const balBeforeMem = (await require('../server/db.js').getMemberLevel(T.user1.openid)).balanceFen;
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: 0, amountFen: 50000, orderType: 'recharge' });
  check('MEM-03', '充值下单', r.status === 201 && r.data.order.order_type === 'recharge', `msg=${r.data && r.data.message}`);
  const rcOrder = r.data.order;
  // MEM-03b：充值订单 session_id 必须为 NULL（回归 BUG-LEDGER #1：orders.session_id NOT NULL 与充值写 NULL 冲突，本地旧表掩盖、仅 CI 干净库可抓）
  check('MEM-03b', '充值订单session_id为NULL', rcOrder.session_id == null, `session_id=${rcOrder && rcOrder.session_id}`);
  r = await req('POST', `/api/orders/${rcOrder.id}/pay`, { openid: T.user1.openid });
  check('MEM-04', '充值支付到账(首充30%)', ok(r, 200) && r.data.recharge && r.data.recharge.total === 65000 && r.data.recharge.isFirst, `total=${r.data && r.data.recharge && r.data.recharge.total} first=${r.data && r.data.recharge && r.data.recharge.isFirst}`);
  // MSG-02：充值到账 → 站内信「充值到账」（回归 BUG-LEDGER #12：充值支付无消息埋点）
  r = await req('GET', `/api/messages?openid=${T.user1.openid}`);
  const rcMsg = (r.data.messages || []).find(m => m.type === 'order' && m.title === '充值到账');
  check('MSG-02', '充值到账站内信', ok(r, 200) && !!rcMsg, `count=${r.data && r.data.messages && r.data.messages.length}`);
  r = await req('GET', `/api/member/level?openid=${T.user1.openid}`);
  check('MEM-05', '余额增加(首充65000到账)', r.data.level.balanceFen === balBeforeMem + 65000, `balance=${r.data && r.data.level && r.data.level.balanceFen} 应=${balBeforeMem + 65000}`);
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
  // MEM-13：候补余额支付扣会员价（回归 BUG-LEDGER #9：候补扣款+享会员价，6800×0.98→66元=6600分）
  const balBeforeWtl = (await require('../server/db.js').getMemberLevel(T.user1.openid)).balanceFen;  // 2026-08-18：差值断言（B2 后余额非固定值）
  const wtlSid = (await mkFutureSession(3, 1, 1)).id;  // 满员场次（booked=1）；now+3h——MEM-13b 退出候补受「课前 2 小时截止」约束，固定 22:30 在 20:30 后跑必挂
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: wtlSid, amountFen: 6800, orderType: 'waitlist' });
  const wtlOrderId = r.data.order.id;
  r = await req('POST', `/api/orders/${wtlOrderId}/pay`, { openid: T.user1.openid, payMethod: 'balance' });
  check('MEM-13', '候补余额支付扣会员价', ok(r, 200) && r.data.wait && r.data.wait.amount_fen === 6600, `wait=${r.data.wait && r.data.wait.amount_fen}`);
  const wtlWaitId = r.data.wait.id;
  // MEM-13d：订单实付 = waitlist 金额 = 扣款额（钱闭环三角一致，规矩 #8）
  r = await req('GET', `/api/orders?openid=${T.user1.openid}`);
  const wtlOrder = (r.data.orders || []).find(o => o.id === wtlOrderId);
  check('MEM-13d', '候补订单金额=实付会员价', wtlOrder && wtlOrder.amount_fen === 6600, `order=${wtlOrder && wtlOrder.amount_fen}`);
  r = await req('DELETE', `/api/waitlist/${wtlWaitId}?openid=${T.user1.openid}`);
  check('MEM-13b', '候补退出退款', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/member/level?openid=${T.user1.openid}`);
  check('MEM-13c', '候补退款后余额恢复', r.data.level.balanceFen === balBeforeWtl, `balance=${r.data.level.balanceFen} 应=${balBeforeWtl}`);
  // MEM-02c：带 openid 时套餐按用户充值状态展示（回归 BUG-LEDGER #8：前端漏拼 openid 致全显示首充30%）
  r = await req('GET', `/api/member/plans?openid=${T.user1.openid}`);  // user1 已充 500 档两次 → 应为复充
  const p500 = r.data.plans && r.data.plans.find(p => p.amount === 50000);
  check('MEM-02c', '套餐复充状态展示', ok(r, 200) && p500 && p500.isFirst === false && p500.bonusYuan === 50, `isFirst=${p500 && p500.isFirst} bonusYuan=${p500 && p500.bonusYuan}`);
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
  const balBefore = (await dbx.getMemberLevel(T.user1.openid)).balanceFen;
  r = await req('POST', '/api/orders', { openid: T.user1.openid, sessionId: memSessionId, amountFen: 8000, orderType: 'book' });
  check('MEM-12a', '取整用例下单', r.status === 201, `status=${r.status}`);
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: T.user1.openid, payMethod: 'balance' });
  check('MEM-12b', '取整用例支付成功', ok(r, 200), `msg=${r.data && r.data.message}`);
  const balAfter = (await dbx.getMemberLevel(T.user1.openid)).balanceFen;
  check('MEM-12', '会员价取整实扣¥78（非78.4）', (balBefore - balAfter) === 7800, `扣款=${(balBefore - balAfter) / 100}元（应 78）`);
  // MSG-01：订课支付成功 → 站内信「订课成功」（回归 BUG-LEDGER #12：payOrder 直接内联建 booking，绕过 createBooking 埋点致订课无消息）
  r = await req('GET', `/api/messages?openid=${T.user1.openid}`);
  const bookMsg = (r.data.messages || []).find(m => m.type === 'booking' && m.title === '订课成功');
  check('MSG-01', '订课成功站内信', ok(r, 200) && !!bookMsg, `count=${r.data && r.data.messages && r.data.messages.length}`);

  // RCG-01/02 充值分页（插 25 笔模拟历史，验证 10/10/5 + hasMore 边界）
  const rcgOpenid = 'uid_test_rcg';
  await req('POST', '/api/auth/login', { openid: rcgOpenid, nickname: '分页测试' });
  for (let i = 0; i < 25; i++) {
    // created_at 业务层算好传参（datetime('now','localtime','-N minutes') 是 SQLite 语法，MySQL 报语法错——BUG-LEDGER #60）
    const createdAt = timeMod.nowDateTimeStr(new Date(Date.now() - (i + 1) * 60000));
    await dbx.driver.run("INSERT INTO member_recharges (recharge_no, user_openid, order_id, amount_fen, bonus_fen, status, created_at) VALUES (?, ?, 0, 50000, 5000, 'paid', ?)",
      ['RCG_' + i, rcgOpenid, createdAt]);
  }
  r = await req('GET', `/api/member/recharges?openid=${rcgOpenid}`);
  check('RCG-01', '分页第1页10笔+hasMore', (r.data.recharges || []).length === 10 && r.data.hasMore === true, `count=${r.data.recharges && r.data.recharges.length} hasMore=${r.data.hasMore}`);
  r = await req('GET', `/api/member/recharges?openid=${rcgOpenid}&offset=20`);
  check('RCG-02', '第3页5笔+无更多', (r.data.recharges || []).length === 5 && r.data.hasMore === false, `count=${r.data.recharges && r.data.recharges.length} hasMore=${r.data.hasMore}`);
  await dbx.driver.run("DELETE FROM member_recharges WHERE user_openid=?", [rcgOpenid]);

  // ===== 10. 能量币 =====
  console.log('\n── 10. 能量币 ──');
  r = await req('GET', `/api/coin/balance?openid=${T.user1.openid}`);
  check('COIN-01', '能量币余额', ok(r, 200) && typeof r.data.balance === 'number', `balance=${r.data && r.data.balance}`);
  r = await req('GET', '/api/coin/shop');
  check('COIN-02', '商店奖品', ok(r, 200) && r.data.items.length >= 1, `count=${r.data && r.data.items && r.data.items.length}`);
  r = await req('GET', '/api/coin/config');
  check('COIN-03', '能量币配置', ok(r, 200) && r.data.config && r.data.config.earnRules, `rules=${r.data && r.data.config && JSON.stringify(r.data.config.earnRules)}`);
  // 充值获得能量币：user2 充 500 → 5% = 250 币（验证比例；差值断言，不受先前签到奖励余额影响——CHK 用例会签到得币）
  r = await req('GET', `/api/coin/balance?openid=${T.user2.openid}`);
  const coinBefore = r.data.balance;
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: 0, amountFen: 50000, orderType: 'recharge' });
  let coinOrder = r.data.order;
  await req('POST', `/api/orders/${coinOrder.id}/pay`, { openid: T.user2.openid });
  r = await req('GET', `/api/coin/balance?openid=${T.user2.openid}`);
  check('COIN-04', '充值得币(5%比例)', r.data.balance - coinBefore === 250, `+${r.data && r.data.balance - coinBefore}（应+250）`);
  // 再充 1500 → 应得 750；2026-08-14 取消每日上限 → 全额到账 250+750=1000（不再截断）
  r = await req('POST', '/api/orders', { openid: T.user2.openid, sessionId: 0, amountFen: 150000, orderType: 'recharge' });
  coinOrder = r.data.order;
  await req('POST', `/api/orders/${coinOrder.id}/pay`, { openid: T.user2.openid });
  r = await req('GET', `/api/coin/balance?openid=${T.user2.openid}`);
  check('COIN-04b', '充值得币(无限额全额到账)', r.data.balance - coinBefore === 1000, `+${r.data && r.data.balance - coinBefore}（应+1000）`);
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

  // ===== 12. 限时次卡包（单卡累加 / 扣次退次 / 候补 / 过期作废）=====
  console.log('\n── 12. 限时次卡包 ──');
  const P = { openid: 'uid_test_pass1', nickname: '次卡测试' };
  const P2 = { openid: 'uid_test_pass2', nickname: '无卡用户' };
  await req('POST', '/api/auth/login', P);
  await req('POST', '/api/auth/login', P2);
  // B2（2026-08-18）：次卡购买走 balance 扣款（#49 修复），P/P2 注册晚于全局注入 → 这里补注入
  await require('../server/db.js').driver.run("UPDATE users SET balance_fen = balance_fen + 400000 WHERE openid IN ('uid_test_pass1','uid_test_pass2')");
  r = await req('GET', '/api/passes/packages');
  check('PASS-01', '档位列表(两档含说明)', ok(r, 200) && r.data.packages.length === 2 && r.data.packages.some(pkg => pkg.price_fen === 90000) && r.data.packages.every(pkg => pkg.desc), `n=${r.data && r.data.packages && r.data.packages.length}`);
  // 购买 12 次档（模拟微信支付）
  r = await req('POST', '/api/orders', { openid: P.openid, orderType: 'pass', amountFen: 90000 });
  check('PASS-02a', '次卡下单', r.status === 201 && r.data.order.status === 'pending', `msg=${r.data && r.data.message}`);
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: P.openid, payMethod: 'balance' });
  check('PASS-02', '支付发卡(12次)', ok(r, 200) && r.data.recharge && r.data.recharge.pass.remaining === 12, `rem=${r.data && r.data.recharge && r.data.recharge.pass && r.data.recharge.pass.remaining}`);
  // 重复购买 24 次档 → 累加 36
  r = await req('POST', '/api/orders', { openid: P.openid, orderType: 'pass', amountFen: 180000 });
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: P.openid, payMethod: 'balance' });
  check('PASS-03', '重复购买累加(36次)', ok(r, 200) && r.data.recharge.pass.remaining === 36, `rem=${r.data && r.data.recharge && r.data.recharge.pass.remaining}`);
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-03b', '我的次卡(36次/天数)', ok(r, 200) && r.data.pass.hasPass && r.data.pass.remaining === 36 && r.data.pass.daysLeft > 50, `rem=${r.data && r.data.pass && r.data.pass.remaining} days=${r.data && r.data.pass && r.data.pass.daysLeft}`);
  // 订课用次卡（2026-08-15: 次卡改为用户显式选择，payMethod 传 pass；金额 0）
  r = await req('POST', '/api/orders', { openid: P.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: P.openid, payMethod: 'pass' });
  check('PASS-05', '订课自动扣次(pass/¥0)', ok(r, 200) && r.data.order.pay_source === 'pass' && r.data.order.amount_fen === 0, `src=${r.data && r.data.order && r.data.order.pay_source} amt=${r.data && r.data.order && r.data.order.amount_fen}`);
  const passBookingId = r.data.booking.id;
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-05b', '扣次后剩余35', r.data.pass.remaining === 35, `rem=${r.data.pass.remaining}`);
  // 退订退次
  r = await req('DELETE', `/api/bookings/${passBookingId}?openid=${P.openid}`);
  check('PASS-08', '退订退次', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-08b', '退次后剩余36', r.data.pass.remaining === 36, `rem=${r.data.pass.remaining}`);
  // 退订后重订同一场次（exists 复用 booking）→ 金额必须为 0（回归：原复用不更新 amount_fen 残留旧价）
  r = await req('POST', '/api/orders', { openid: P.openid, sessionId: ctx.sessionId, amountFen: 6800, orderType: 'book' });
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: P.openid, payMethod: 'pass' });
  check('PASS-08c', '重订(复用booking)扣次金额0', ok(r, 200) && r.data.order.amount_fen === 0 && r.data.booking.amount_fen === 0, `orderAmt=${r.data && r.data.order && r.data.order.amount_fen} bookingAmt=${r.data && r.data.booking && r.data.booking.amount_fen}`);
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-08d', '重订扣次后剩余35', r.data.pass.remaining === 35, `rem=${r.data.pass.remaining}`);
  // 候补用次卡 → 退出退次（2026-08-15: 次卡改为用户显式选择，payMethod 传 pass）
  r = await req('POST', '/api/orders', { openid: P.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'waitlist' });
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: P.openid, payMethod: 'pass' });
  check('PASS-10', '候补用次卡', ok(r, 200) && r.data.wait && r.data.wait.status === 'waiting', `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-10b', '候补扣次后剩余34', r.data.pass.remaining === 34, `rem=${r.data.pass.remaining}`);
  // 已排队 → 再次下单被拦截（createOrder 已有 waiting 记录检查；DESIGN #D14 后同窗候补占位同样触发查重拦截）
  r = await req('POST', '/api/orders', { openid: P.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'waitlist' });
  check('PASS-10c', '已排队重复下单被拦截', r.status === 400 && ((r.data.message || '').includes('候补队列') || (r.data.message || '').includes('同一时间只能订一堂课')), `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/waitlist?openid=${P.openid}`);
  const passWait = (r.data.waits || []).find(w => w.session_id === ctx.fullSessionId && w.status === 'waiting');
  r = await req('DELETE', `/api/waitlist/${passWait.id}?openid=${P.openid}`);
  check('PASS-11', '退出候补退次', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-11b', '退次后剩余35', r.data.pass.remaining === 35, `rem=${r.data.pass.remaining}`);
  // 退出候补后（waitlist 残留 cancelled）再下单支付 → exists 复用不 500、金额 0（回归：原 INSERT 撞 UNIQUE 约束 500）
  r = await req('POST', '/api/orders', { openid: P.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'waitlist' });
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: P.openid, payMethod: 'pass' });
  check('PASS-11c', 'cancelled残留重付不500且金额0', ok(r, 200) && r.data.wait && r.data.wait.amount_fen === 0 && r.data.order.amount_fen === 0, `msg=${r.data && r.data.message} waitAmt=${r.data && r.data.wait && r.data.wait.amount_fen} orderAmt=${r.data && r.data.order && r.data.order.amount_fen}`);
  r = await req('DELETE', `/api/waitlist/${r.data.wait.id}?openid=${P.openid}`);
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-11d', '重付退出后剩余35', r.data.pass.remaining === 35, `rem=${r.data.pass.remaining}`);
  // 无卡用户订课 → 非 pass（走微信）；注：tomorrowSessionId 已被候补节置满，另造新场次
  const passFreeSid = await mkSession(tomorrowStr, '10:30', '11:30', 5, 0);
  r = await req('POST', '/api/orders', { openid: P2.openid, sessionId: passFreeSid, amountFen: 6800, orderType: 'book' });
  r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: P2.openid, payMethod: 'balance' });
  check('PASS-13', '无卡走原支付方式(非pass)', ok(r, 200) && r.data.order.pay_source !== 'pass', `src=${r.data && r.data.order && r.data.order.pay_source}`);
  // 过期作废
  await db.driver.run('UPDATE user_passes SET expires_at = ? WHERE user_openid = ?',
    [timeMod.addMinutesStr(timeMod.nowDateTimeStr(), -1440), P.openid]);  // 方言收口（DESIGN #D2 S2）：datetime() 改 time.js 算好传参
  const expiredN = await db.expireOverduePasses();
  check('PASS-12', '过期任务作废', expiredN >= 1, `n=${expiredN}`);
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-12b', '过期状态展示', r.data.pass.expired === true, `expired=${r.data.pass && r.data.pass.expired}`);
  // 次卡测试用户清理
  await db.driver.run("DELETE FROM user_passes WHERE user_openid LIKE 'uid_test_pass%'");
  await db.driver.run("DELETE FROM orders WHERE user_openid LIKE 'uid_test_pass%'");
  await db.driver.run("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_pass%'");
  await db.driver.run("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_pass%'");
  await db.driver.run("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_pass%'");  // #49 次卡购买走 balance 扣款 → 留痕 balance_logs，先删再删 users（FK）
  await db.driver.run("DELETE FROM users WHERE openid LIKE 'uid_test_pass%'");

  // ===== 13. 吐槽反馈（DESIGN #D9）：提交 / 我的历史 / 后台收件箱 / 回复闭环 =====
  console.log('\n── 13. 吐槽反馈（DESIGN #D9）──');
  const FB = { openid: 'uid_test_fb1', nickname: '吐槽学员' };
  await req('POST', '/api/auth/login', FB);
  // 提交吐槽（实名快照：昵称服务端取，不信任前端）
  r = await req('POST', '/api/feedback', { openid: FB.openid, content: '团课太挤了，希望能控制人数！' });
  check('FBK-01', '提交吐槽落库(open+实名快照)', ok(r, 200) && r.data.feedback && r.data.feedback.status === 'open' && r.data.feedback.nickname === '吐槽学员', `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/feedback', { openid: FB.openid, content: '长'.repeat(501) });
  check('FBK-02', '超长内容拒绝(≤500字)', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/feedback', { openid: FB.openid, content: '   ' });
  check('FBK-02b', '空内容拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/feedback', { openid: FB.openid, content: '团课太挤了，希望能控制人数！' });
  check('FBK-02c', '防连点幂等(60s内同内容拒绝)', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/feedback', { openid: 'uid_test_nobody', content: '没有这个用户' });
  check('FBK-07', '未登录用户拒绝', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/my-feedbacks?openid=${FB.openid}`);
  check('FBK-03', '我的吐槽列表(1条待回复)', ok(r, 200) && r.data.list.length === 1 && r.data.list[0].status === 'open', `n=${r.data && r.data.list && r.data.list.length}`);
  r = await req('GET', '/api/admin/feedbacks', null, { noToken: true });
  check('FBK-07b', '后台收件箱无 Admin-Token 401', r.status === 401, `status=${r.status}`);
  r = await req('GET', '/api/admin/feedbacks');
  check('FBK-04', '后台收件箱(未回复优先+待回复统计)', ok(r, 200) && r.data.counts.open >= 1 && r.data.list[0].status === 'open', `open=${r.data && r.data.counts && r.data.counts.open}`);
  const fbId = r.data.list[0].id;
  r = await req('POST', `/api/admin/feedbacks/${fbId}/reply`, { reply: '收到，本周起每场人数上限已调整，感谢反馈！' });
  check('FBK-05', '回复闭环(status→replied)', ok(r, 200) && r.data.feedback.status === 'replied', `msg=${r.data && r.data.message}`);
  r = await req('POST', `/api/admin/feedbacks/${fbId}/reply`, { reply: '再回一条' });
  check('FBK-06', '重复回复拒绝(幂等)', r.status === 400, `msg=${r.data && r.data.message}`);
  r = await req('GET', `/api/my-feedbacks?openid=${FB.openid}`);
  check('FBK-05b', '学员看到回复内容', ok(r, 200) && r.data.list[0].status === 'replied' && (r.data.list[0].reply || '').includes('感谢反馈'), `st=${r.data && r.data.list && r.data.list[0] && r.data.list[0].status}`);
  r = await req('GET', `/api/messages?openid=${FB.openid}`);
  const fbMsg = (r.data.messages || []).find(m => m.type === 'feedback' && m.biz_id === fbId);
  check('FBK-05c', '回复站内信已发(type=feedback 跳吐槽页)', fbMsg && fbMsg.jump_url === '/pages/feedback/index', `msg=${fbMsg && fbMsg.title}`);
  // 测试用户自清理（依赖先删：feedbacks/messages → users）
  await db.driver.run("DELETE FROM feedbacks WHERE user_openid LIKE 'uid_test_fb%'");
  await db.driver.run("DELETE FROM messages WHERE user_openid LIKE 'uid_test_fb%'");
  await db.driver.run("DELETE FROM users WHERE openid LIKE 'uid_test_fb%'");

  // ===== 季卡/年卡（DESIGN #D14）：无限次订课 0 元 + 同一时间只能订一堂课 =====
  console.log('\n── 8.5 季卡/年卡（DESIGN #D14）──');
  {
    const _dbx = require('../server/db.js');
    const unl = { openid: 'uid_test_unl1', nickname: '无限卡学员' };
    await req('POST', '/api/auth/login', unl);
    await _dbx.driver.run('UPDATE users SET balance_fen = 2000000 WHERE openid = ?', [unl.openid]); // ¥20000 够买季卡+年卡
    const pad2 = n => String(n).padStart(2, '0');
    const unlSessions = [];   // 本块创建的场次 id，结尾精确清理
    // 同日动态场次（跨天时 end 用 +24 小时字符串表示，time.parseBeijing 原生支持）
    const mkSameDay = async (startOffsetMin, durMin = 60, cap = 10, booked = 0) => {
      const st = new Date(Date.now() + startOffsetMin * 60000);
      const et = new Date(st.getTime() + durMin * 60000);
      const p = timeMod.parts(st), pe = timeMod.parts(et);
      const date = `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
      const start = `${pad2(p.h)}:${pad2(p.mi)}`;
      const end = pe.h < p.h ? `${pad2(pe.h + 24)}:${pad2(pe.mi)}` : `${pad2(pe.h)}:${pad2(pe.mi)}`;
      const id = await mkSession(date, start, end, cap, booked);
      unlSessions.push(id);
      return { id, date, start, end };
    };
    // UNL-01：购买季卡（¥2,980）→ 发卡，有效期=购买日+3 个月 23:59:59
    r = await req('POST', '/api/orders', { openid: unl.openid, amountFen: 298000, orderType: 'unlimited' });
    check('UNL-01', '季卡下单', r.status === 201 && r.data.order.order_type === 'unlimited', `st=${r.status} type=${r.data && r.data.order && r.data.order.order_type}`);
    const unlOrderId = r.data.order.id;
    r = await req('POST', `/api/orders/${unlOrderId}/pay`, { openid: unl.openid, payMethod: 'balance' });
    check('UNL-01b', '季卡支付成功(实付=购买价)', ok(r, 200) && r.data.order.amount_fen === 298000, `amt=${r.data && r.data.order && r.data.order.amount_fen}`);
    r = await req('GET', `/api/unlimited/my?openid=${unl.openid}`);
    check('UNL-01c', '我的卡=季卡且未过期', ok(r, 200) && r.data.hasPass === true && r.data.type === 'season' && !r.data.expired && r.data.daysLeft >= 80, `pass=${JSON.stringify(r.data)}`);
    const unlPass = await _dbx.driver.get('SELECT * FROM unlimited_passes WHERE user_openid = ? ORDER BY id DESC LIMIT 1', [unl.openid]);
    const expExpect = (() => { const d = new Date(); d.setMonth(d.getMonth() + 3); const p = timeMod.parts(d); return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} 23:59:59`; })();
    check('UNL-01d', '有效期=购买日+3个月 23:59:59', unlPass && unlPass.expires_at === expExpect, `exp=${unlPass && unlPass.expires_at} want=${expExpect}`);
    // UNL-03：有效期内订课 → 0 元自动用卡（pay_source=unlimited）
    const s4 = await mkSameDay(4 * 60);
    r = await req('POST', '/api/orders', { openid: unl.openid, sessionId: s4.id, amountFen: 6800, orderType: 'book' });
    check('UNL-03', '有卡订课下单成功', r.status === 201, `st=${r.status}`);
    const unlBookOrder = r.data.order.id;
    r = await req('POST', `/api/orders/${unlBookOrder}/pay`, { openid: unl.openid, payMethod: 'balance' });
    check('UNL-03b', '有卡自动 0 元(pay_source=unlimited 实付0)', ok(r, 200) && r.data.booking && r.data.booking.amount_fen === 0 && r.data.order.pay_source === 'unlimited', `amt=${r.data.booking && r.data.booking.amount_fen} src=${r.data.order && r.data.order.pay_source}`);
    // UNL-04：与已订课时间重叠 → 400 拒绝（含普通付费课重叠：另一用户先订，本用户订重叠时段）
    const s45 = await mkSameDay(4 * 60 + 30);
    r = await req('POST', '/api/orders', { openid: unl.openid, sessionId: s45.id, amountFen: 6800, orderType: 'book' });
    check('UNL-04', '时间重叠订课拒绝(同一天可订多堂但时段不重叠)', r.status === 400 && /同一时间只能订一堂课/.test(r.data.message || ''), `msg=${r.data && r.data.message}`);
    // UNL-04b：普通付费课(无卡用户)之间重叠同样拒绝（查重覆盖全部订课来源，不区分支付方式）
    const unl2 = { openid: 'uid_test_unl2', nickname: '付费课学员' };
    await req('POST', '/api/auth/login', unl2);
    await _dbx.driver.run('UPDATE users SET balance_fen = 100000 WHERE openid = ?', [unl2.openid]);
    const s6 = await mkSameDay(6 * 60);
    r = await req('POST', '/api/orders', { openid: unl2.openid, sessionId: s6.id, amountFen: 6800, orderType: 'book' });
    const unl2OrderId = r.data.order.id;
    r = await req('POST', `/api/orders/${unl2OrderId}/pay`, { openid: unl2.openid, payMethod: 'balance' });
    check('UNL-04b0', '无卡用户付费订课成功(对照)', ok(r, 200) && r.data.order.pay_source === 'balance', `src=${r.data.order && r.data.order.pay_source}`);
    const s65 = await mkSameDay(6 * 60 + 30);
    r = await req('POST', '/api/orders', { openid: unl2.openid, sessionId: s65.id, amountFen: 6800, orderType: 'book' });
    check('UNL-04b', '与已订付费课重叠拒绝(查重覆盖全部订课)', r.status === 400 && /同一时间只能订一堂课/.test(r.data.message || ''), `msg=${r.data && r.data.message}`);
    // UNL-05：同日不重叠时段多堂 → 允许（4h-5h 已订，6.5h 不重叠；unl2 的 6h 课不算本用户）
    r = await req('POST', '/api/orders', { openid: unl.openid, sessionId: s65.id, amountFen: 6800, orderType: 'book' });
    check('UNL-05', '同日不重叠时段可再订', r.status === 201, `st=${r.status} msg=${r.data && r.data.message}`);
    // UNL-06：满员候补 0 元 + 候补时间查重
    const sFull = await mkSameDay(8 * 60, 60, 1, 1);
    r = await req('POST', '/api/orders', { openid: unl.openid, sessionId: sFull.id, amountFen: 6800, orderType: 'waitlist' });
    check('UNL-06', '满员候补下单成功', r.status === 201, `st=${r.status}`);
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: unl.openid, payMethod: 'balance' });
    check('UNL-06b', '候补 0 元(pay_source=unlimited)', ok(r, 200) && r.data.wait && r.data.wait.amount_fen === 0, `wait=${JSON.stringify(r.data.wait && r.data.wait.amount_fen)}`);
    const sFull2 = await mkSameDay(8 * 60 + 30, 60, 1, 1);
    r = await req('POST', '/api/orders', { openid: unl.openid, sessionId: sFull2.id, amountFen: 6800, orderType: 'waitlist' });
    check('UNL-06c', '候补重叠时段拒绝', r.status === 400 && /同一时间只能订一堂课/.test(r.data.message || ''), `msg=${r.data && r.data.message}`);
    // UNL-07：退订 → 释放名额、无退款（余额不变=0 元无钱可退）、订单 refunded
    r = await req('GET', `/api/orders?openid=${unl.openid}`);
    const unlBk = (r.data.orders || []).find(o => o.booking_id && o.session_id === s4.id);
    const balBefore = (await _dbx.driver.get('SELECT balance_fen FROM users WHERE openid = ?', [unl.openid])).balance_fen;
    r = await req('DELETE', `/api/bookings/${unlBk.booking_id}?openid=${unl.openid}`);
    check('UNL-07', '卡订课退订成功(无次数可退直接释放)', ok(r, 200), `msg=${r.data && r.data.message}`);
    const balAfter = (await _dbx.driver.get('SELECT balance_fen FROM users WHERE openid = ?', [unl.openid])).balance_fen;
    check('UNL-07b', '退订无退款(实付=扣款=退款=0 三一致)', balBefore === balAfter, `bal ${balBefore}→${balAfter}`);
    r = await req('GET', `/api/orders?openid=${unl.openid}`);
    check('UNL-07c', '退订订单 refunded', (r.data.orders || []).find(o => o.id === unlBk.id && o.status === 'refunded') !== undefined, 'unlBook 订单应 refunded');
    const s4b = await _dbx.driver.get('SELECT booked_count FROM course_sessions WHERE id = ?', [s4.id]);
    check('UNL-07d', '退订释放名额', s4b.booked_count === 0, `booked=${s4b.booked_count}`);
    // UNL-08：旧卡未过期买年卡 → 续期顺延（新到期=旧到期+12 个月）
    r = await req('POST', '/api/orders', { openid: unl.openid, amountFen: 988000, orderType: 'unlimited' });
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: unl.openid, payMethod: 'balance' });
    const unlPass2 = await _dbx.driver.get('SELECT * FROM unlimited_passes WHERE user_openid = ? ORDER BY id DESC LIMIT 1', [unl.openid]);
    const expExpect2 = (() => { const d = new Date(); d.setMonth(d.getMonth() + 15); const p = timeMod.parts(d); return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} 23:59:59`; })();
    check('UNL-08', '续期顺延(新卡=旧卡到期+12个月)', unlPass2.expires_at === expExpect2, `exp=${unlPass2.expires_at} want=${expExpect2}`);
    // UNL-09：卡过期 → 判定 expired，订课走正常支付（不能白嫖）
    await _dbx.driver.run("UPDATE unlimited_passes SET expires_at = '2020-01-01 23:59:59' WHERE id = ?", [unlPass2.id]);
    r = await req('GET', `/api/unlimited/my?openid=${unl.openid}`);
    check('UNL-09', '过期卡判定 expired', ok(r, 200) && r.data.hasPass === true && r.data.expired === true, `pass=${JSON.stringify(r.data)}`);
    const s9 = await mkSameDay(10 * 60);
    r = await req('POST', '/api/orders', { openid: unl.openid, sessionId: s9.id, amountFen: 6800, orderType: 'book' });
    r = await req('POST', `/api/orders/${r.data.order.id}/pay`, { openid: unl.openid, payMethod: 'balance' });
    check('UNL-09b', '过期卡订课走正常支付(余额扣款非0)', ok(r, 200) && r.data.booking && r.data.booking.amount_fen > 0 && r.data.order.pay_source === 'balance', `amt=${r.data.booking && r.data.booking.amount_fen} src=${r.data.order && r.data.order.pay_source}`);
    // 清理（外键顺序：先删引用表再删 users）
    await _dbx.driver.run("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_unl%'");
    await _dbx.driver.run("DELETE FROM orders WHERE user_openid LIKE 'uid_test_unl%'");
    await _dbx.driver.run("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_unl%'");
    await _dbx.driver.run("DELETE FROM messages WHERE user_openid LIKE 'uid_test_unl%'");
    await _dbx.driver.run("DELETE FROM unlimited_passes WHERE user_openid LIKE 'uid_test_unl%'");
    await _dbx.driver.run("DELETE FROM member_recharges WHERE user_openid LIKE 'uid_test_unl%'");
    await _dbx.driver.run("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_unl%'");
    await _dbx.driver.run(`DELETE FROM course_sessions WHERE id IN (${unlSessions.map(() => '?').join(',')})`, unlSessions);
    await _dbx.driver.run("DELETE FROM users WHERE openid LIKE 'uid_test_unl%'");
  }

  // WX-M 系列（2026-08-18 用户要求「测试支付必定成功」）：PAY_MOCK=1 测试支付模式。
  // 主后端 env 是 spawn 子进程（不可动态改）→ ① 主后端（PAY_MOCK 显式关）测「无测试后门」；
  // ② 独立 mock 后端（独立临时库 + PAY_MOCK=1）测 status/create/mock-notify 全链路 + 钱闭环。
  // 放套件最后：独立 harness 启动慢（seed + 健康轮询），不阻塞前面的订课/退订用例
  r = await req('POST', '/api/wxpay/mock-notify', { orderId: 1, openid: T.user1.openid });
  check('WX-M01', '默认环境 mock-notify 400（无测试后门）', r.status === 400, `status=${r.status}`);
  const mockDb = require('node:os').tmpdir() + `/gym-test-mock-${process.pid}.db`;
  for (const ms of ['', '-wal', '-shm']) { try { fs.rmSync(mockDb + ms, { force: true }); } catch (e) {} }
  const mockSeed = spawnSync(process.execPath, ['server/seed.js'], { cwd: PROJECT_ROOT, env: { ...process.env, DB_PATH: mockDb }, encoding: 'utf8', timeout: 60000 });
  if (mockSeed.status !== 0) {
    console.error('✖ mock 后端 seed 失败:\n' + (mockSeed.stderr || mockSeed.stdout || '').slice(0, 500));
    process.exit(2);
  }
  const mockPort = 3700 + Math.floor(Math.random() * 200);
  const mockLogPath = require('node:path').join(require('node:os').tmpdir(), `gym-backend-mock-${process.pid}.log`);
  const mockFd = fs.openSync(mockLogPath, 'w');
  const mockChild = spawn(process.execPath, ['server/index.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DB_PATH: mockDb, PORT: String(mockPort), WX_APPID: 'test_appid', WX_SECRET: 'test_secret', ADMIN_TOKEN, PAY_MOCK: '1' },
    stdio: ['ignore', mockFd, mockFd]
  });
  const mockBase = `http://127.0.0.1:${mockPort}`;
  let mockUp = false;
  for (let i = 0; i < 40; i++) {
    try { const hr = await req('GET', '/api/health', null, { base: mockBase }); if (hr.status === 200) { mockUp = true; break; } } catch (e) {}
    await new Promise(r2 => setTimeout(r2, 500));
  }
  if (!mockUp) {
    console.error(`✖ mock 后端启动失败（端口 ${mockPort}）`);
    try { console.error('--- mock 后端日志尾部 ---\n' + fs.readFileSync(mockLogPath, 'utf8').split('\n').slice(-20).join('\n')); } catch (e) {}
    mockChild.kill();
    process.exit(2);
  }
  // 独立 mock 用户：注册 → 充值下单 → create 返回 mock 标记 → mock-notify 落库
  const wxmOid = 'uid_test_wxmock';
  await req('POST', '/api/auth/login', { openid: wxmOid, nickname: '测试微信支付mock' }, { base: mockBase });
  r = await req('GET', '/api/wxpay/status', null, { base: mockBase });
  check('WX-M02', 'mock 后端：status enabled+mock', ok(r, 200) && r.data.enabled === true && r.data.mock === true, `enabled=${r.data && r.data.enabled} mock=${r.data && r.data.mock}`);
  r = await req('POST', '/api/orders', { openid: wxmOid, sessionId: 0, amountFen: 50000, orderType: 'recharge' }, { base: mockBase });
  const wxmOrder = r.data.order;
  check('WX-M03', 'mock 后端：充值下单成功', r.status === 201 && wxmOrder && wxmOrder.status === 'pending', `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/wxpay/create', { orderId: wxmOrder.id, openid: wxmOid }, { base: mockBase });
  check('WX-M04', 'mock 后端：create 返回 mock 标记（不调微信）', ok(r, 200) && r.data.mock === true && r.data.payParams && r.data.payParams.mock === true, `mock=${r.data && r.data.mock}`);
  r = await req('POST', '/api/wxpay/mock-notify', { orderId: wxmOrder.id, openid: wxmOid }, { base: mockBase });
  check('WX-M05', 'mock 后端：mock-notify 落库成功', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/orders?openid=' + wxmOid, null, { base: mockBase });
  const wxmPaid = (r.data.orders || []).find(o => o.id === wxmOrder.id);
  check('WX-M06', 'mock 后端：订单 paid + pay_source=wxpay（钱闭环闸门通过）', wxmPaid && wxmPaid.status === 'paid' && wxmPaid.pay_source === 'wxpay', `status=${wxmPaid && wxmPaid.status} src=${wxmPaid && wxmPaid.pay_source}`);
  r = await req('POST', '/api/wxpay/mock-notify', { orderId: wxmOrder.id, openid: wxmOid }, { base: mockBase });
  check('WX-M07', 'mock 后端：重复回调幂等', ok(r, 200), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/wxpay/mock-notify', { orderId: wxmOrder.id, openid: T.user1.openid }, { base: mockBase });
  check('WX-M08', 'mock 后端：非本用户订单 404', r.status === 404, `status=${r.status}`);
  mockChild.kill();

  // ===== 清理测试数据 =====
  console.log('\n── 11. 清理测试数据 ──');
  try {
    await db.driver.run("DELETE FROM orders WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM user_passes WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM course_sessions WHERE source='test_suite'");
    await db.driver.run("DELETE FROM invitations WHERE inviter LIKE 'uid_test_%' OR invitee LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM coach_notes WHERE coach_openid LIKE 'uid_test_%' OR student_openid LIKE 'uid_test_%'");
    await db.driver.run("UPDATE coaches SET user_openid = NULL WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM member_recharges WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM coin_logs WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("DELETE FROM coin_exchanges WHERE user_openid LIKE 'uid_test_%'");
    await db.driver.run("UPDATE users SET coin_balance = 0 WHERE openid LIKE 'uid_test_%'");
    // 清理测试用户（注意可能被引用）
    for (const o of ['uid_test_tianli','uid_test_student2','uid_test_coach','uid_test_holder']) {
      const u = await db.findUserByOpenid(o);
      if (u) await db.deleteUserById(u.id);
    }
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
  process.exitCode = failed > 0 ? 1 : 0;
  return failed;
}

main().catch(e => {
  console.error('测试脚本异常:', e);
  // 强制退出：MySQL 模式 require 的 mysql2 连接池句柄会阻塞自然退出，仅设 exitCode 永不结束
  // （2026-08-18 CI test-mysql 失败后 10 分钟超时的直接根因）
  process.exit(2);
});
