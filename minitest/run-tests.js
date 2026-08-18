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
    const url = BASE + path;
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
  if (DB_PATH) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(DB_PATH + suffix, { force: true }); } catch (e) {}
    }
    console.log(`[干净库模式] 临时库: ${DB_PATH}`);
    // ① seed 基础数据（教练/场地/课程等，测试用例依赖）
    const seedRes = spawnSync(process.execPath, ['server/seed.js'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DB_PATH },
      encoding: 'utf8'
    });
    if (seedRes.status !== 0) {
      console.error('✖ [干净库模式] seed 失败:\n' + (seedRes.stderr || seedRes.stdout || '').slice(0, 800));
      process.exit(2);
    }
    // ② 独立端口起后端（不与开发中的 3000 冲突）
    const port = 3100 + Math.floor(Math.random() * 500);
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DB_PATH, PORT: String(port), WX_APPID: 'test_appid', WX_SECRET: 'test_secret', ADMIN_TOKEN },
      stdio: 'ignore'
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
      child.kill();
      process.exit(2);
    }
    console.log(`[干净库模式] 后端就绪: ${BASE}`);
  }

  try {
    await runSuite();
  } finally {
    // ④ 清理：杀后端 + 删临时库（进程内 require 的 db 也指向临时库，一并释放）
    if (child) child.kill();
    if (DB_PATH) {
      await new Promise(res => setTimeout(res, 300)); // 等子进程释放 SQLite 文件锁
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.rmSync(DB_PATH + suffix, { force: true }); } catch (e) {}
      }
      console.log('[干净库模式] 后端已停止，临时库已删除');
    }
  }
}

async function runSuite() {
  console.log(`\n========== 综合训练馆订课系统 自动化测试 ==========`);
  console.log(`目标: ${BASE} ｜ 开始: ${new Date().toLocaleString()}\n`);

  // 预清理上次残留的测试数据（保证用例可重复执行）
  try {
    const db = require('../server/db.js');
    db.db.prepare("DELETE FROM orders WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM user_passes WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM course_sessions WHERE source='test_suite'").run();
    db.db.prepare("DELETE FROM coin_logs WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM coin_exchanges WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM member_recharges WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM invitations WHERE inviter LIKE 'uid_test_%' OR invitee LIKE 'uid_test_%'").run();
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
  // FRONT-01/02：订课后页面状态刷新防回退（BUG-LEDGER #35：详情页/首页缺 onShow 刷新，
  // 订完课从支付页返回仍显示「立即预订/预约」——服务端数据已正确，纯前端展示问题）
  const detailSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-course-detail', 'index.js'), 'utf8');
  check('FRONT-01', '课程详情页 onShow 刷新预约状态（#35 防回退）', /onShow\(\)[\s\S]{0,120}loadSession\(this\._sessionId\)/.test(detailSrc), '详情页必须 onShow 重新拉取场次（订完课返回按钮状态才更新）');
  const activitySrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-activity', 'index.js'), 'utf8');
  check('FRONT-02', '首页 onShow 刷新今日课程（#35 防回退）', /onShow\(\)[\s\S]*?this\.loadTodayCourses\(\)/.test(activitySrc), '首页必须 onShow 重新拉取今日课程（订完课返回卡片状态才更新）');
  // FRONT-03/04：签到码页画码与按钮（BUGS-INBOX #38/#39：画码引用未定义变量致模拟器首帧无码；
  // 刷新按钮仅重画同码无意义已删除）
  const ckSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-checkin', 'index.js'), 'utf8');
  check('FRONT-03', '签到码画码用 this.data.checkinCode（#38 防回退）', /this\.drawQr\(this\.data\.checkinCode\)/.test(ckSrc), '画码必须读页面 data，禁止裸引用作用域外变量');
  check('FRONT-04', '签到码页无 refreshCode 残留且画码有首帧重试（#38/#39 防回退）', !/refreshCode/.test(ckSrc) && /paintQr\(qr, qr\.getModuleCount\(\), 0\)/.test(ckSrc), '刷新按钮已删；首帧 canvas 拿不到尺寸须延迟重试而非直接放弃');
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
  // 2026-08-18 UI 统一批（BUG-LEDGER #51/#53/#54/#55）：后退按钮统一 back-wrap 箭头；
  // 分享必须用 button open-type="share"（view 不触发转发）；低版本基础库降级相册；等级页文案
  const detailWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'student-course-detail', 'index.wxml'), 'utf8');
  const coachPfWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-profile', 'index.wxml'), 'utf8');
  const coachPfWxss = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'coach-profile', 'index.wxss'), 'utf8');
  const levelWxml = fs.readFileSync(path.join(PROJECT_ROOT, 'miniprogram', 'pages', 'member-level', 'index.wxml'), 'utf8');
  check('FRONT-13', '课程详情页分享按钮为 button open-type=share（#53 防回退：view 不触发转发）',
    /<button class="round-btn flex-center share-round" open-type="share"[^>]*>/.test(detailWxml)
      && /<button class="share-btn" open-type="share">/.test(detailWxml),
    '分享必须放在 button 组件上（open-type 仅 button 生效），view 点击无反应');
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
  r = await req('PUT', '/api/admin/coaches/1', { name: '喻馥雅', avatar: '/images/2_1468.png', skills: 'Hybrid综合体能,产后康复', bio: '管理页编辑测试简介' }, { noToken: true });
  check('ADMIN-19', '无 token 编辑档案 → 401', r.status === 401, `status=${r.status}`);
  r = await req('PUT', '/api/admin/coaches/1', { name: '喻馥雅', avatar: '/images/2_1468.png', skills: 'Hybrid综合体能,产后康复', bio: '管理页编辑测试简介' });
  check('ADMIN-20', '编辑档案成功', r.status === 200 && r.data.ok === true, `status=${r.status} msg=${r.data && r.data.message}`);
  r = await req('GET', '/api/admin/coaches');
  const edited = (r.data.coaches || []).find(c => c.id === 1);
  check('ADMIN-20b', '列表反映编辑（bio/skills/avatar 字段）',
    !!(edited && edited.bio === '管理页编辑测试简介' && edited.skills === 'Hybrid综合体能,产后康复' && edited.avatar === '/images/2_1468.png'),
    `bio=${edited && edited.bio}`);
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
  const mkSession = (date, start, end, cap, booked) => new Promise((resolve) => {
    const db = require('../server/db.js');
    db.db.prepare(`INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source)
                   VALUES (1, 1, 1, ?, ?, ?, ?, ?, 'published', 'test_suite')`).run(date, start, end, cap, booked);
    const s = db.db.prepare("SELECT id FROM course_sessions WHERE source='test_suite' ORDER BY id DESC LIMIT 1").get();
    resolve(s.id);
  });
  ctx.sessionId = await mkSession(todayStr, '21:00', '22:00', 10, 0);
  // 满员场次：避开"已开课"时段——refundExpiredWaitlist 会在 GET /api/waitlist 时把已开课场次的候补自动退款，
  // 若测试在开课时间(22:00)之后运行会误杀候补队列（WTL-06/07 必挂）；21 点后跑测试改用明天日期
  const fullDate = (timeMod.parts().h >= 21) ? tomorrowStr : todayStr;
  ctx.fullSessionId = await mkSession(fullDate, '22:00', '23:00', 1, 1);   // 满员（未来时段避免过期退款干扰）
  ctx.tomorrowSessionId = await mkSession(tomorrowStr, '09:00', '10:00', 5, 0);
  console.log(`  [准备] 测试场次: 普通#${ctx.sessionId} 满员#${ctx.fullSessionId} 明日#${ctx.tomorrowSessionId}`);

  // ===== 3. 订课链路（订单化）=====
  console.log('\n── 4. 订课链路 ──');
  // B2（2026-08-18）：微信支付改真实回调闭环后，测试统一走 balance——先给测试用户注入余额
  // （排除保持 0 余额的负向用例用户：wtl0=候补余额不足 / bal=订课余额不足 / nobody=不存在）
  {
    const _dbx = require('../server/db.js');
    _dbx.db.prepare("UPDATE users SET balance_fen = balance_fen + 100000 WHERE openid LIKE 'uid_test_%' AND openid NOT IN ('uid_test_wtl0','uid_test_bal','uid_test_nobody')").run();
  }
  // WX 系列（B2 钱闭环）：未配置商户号时 status=false / create、notify 400 明确报错
  r = await req('GET', '/api/wxpay/status');
  check('WX-01', 'wxpay 状态(未配置商户号)', ok(r, 200) && r.data.enabled === false, `enabled=${r.data && r.data.enabled}`);
  r = await req('POST', '/api/wxpay/create', { orderId: 1, openid: T.user1.openid });
  check('WX-02', '统一下单未配置 → 400', r.status === 400 && (r.data.message || '').includes('未开通'), `msg=${r.data && r.data.message}`);
  r = await req('POST', '/api/wxpay/notify', { resource: {} });
  check('WX-03', '回调未配置 → 400', r.status === 400, `status=${r.status}`);
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
  const pend2 = _dbx.db.prepare("SELECT id FROM orders WHERE user_openid=? AND session_id=? AND status='pending'").get(T.user2.openid, ctx.sessionId);
  if (pend2) _dbx.db.prepare("DELETE FROM orders WHERE id=?").run(pend2.id);
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

  // 退订触发转正：holder 订满员场次(调低余位) → 退订 → 最早排位者(田立)转正
  const db = require('../server/db.js');
  db.db.prepare(`UPDATE course_sessions SET booked_count = 0 WHERE id = ${ctx.fullSessionId}`).run();
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
    await req('POST', `/api/orders/${wlT.id}/pay`, { openid: T.user2.openid, payMethod: 'balance' });
    db.db.prepare(`UPDATE course_sessions SET date = '2026-08-09' WHERE id = ${ctx.tomorrowSessionId}`).run();
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

  // ===== B3 到课率 + 数据导出（2026-08-18，管理网页新页）=====
  console.log('\n── 6.8 到课率与导出 ──');
  // 直插已签到 booking 造固定到课率数据（绕过签到窗口；booked_count 与之一致：造 3 订 1 签）
  const attSid = await mkSession(todayStr, '08:00', '09:00', 5, 3);
  _dbx.db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status, checkin_at)
                   VALUES (?, ?, ?, 6800, 'booked', 'paid', ?)`)
    .run('B3ATT' + attSid, T.user2.openid, attSid, timeMod.nowDateTimeStr());
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
    const _cut = timeMod.addMinutesStr(timeMod.nowDateTimeStr(), 60);   // 北京时间 now+1h（addMinutesStr 跨天安全）
    const [cutD, cutT] = _cut.split(' ');
    const cutEnd = timeMod.addMinutesStr(_cut, 60).split(' ')[1].slice(0, 5);
    const cutSid = await mkSession(cutD, cutT.slice(0, 5), cutEnd, 5, 0);
    _dbx.db.prepare("UPDATE users SET balance_fen = balance_fen + 100000 WHERE openid = ?").run(T.user2.openid);
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
    db.db.prepare(`INSERT INTO schedule_templates (course_id, weekday, start_time, end_time, venue_id, coach_id, capacity)
                   VALUES (?, ?, '21:30', '22:30', 1, 1, 5)`)
      .run(crsCid, new Date(todayStr + 'T00:00:00').getDay() || 7);
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
  const wtlSid = await mkSession(todayStr, '22:30', '23:30', 1, 1);  // 满员场次（booked=1）
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
  require('../server/db.js').db.prepare("UPDATE users SET balance_fen = balance_fen + 400000 WHERE openid IN ('uid_test_pass1','uid_test_pass2')").run();
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
  // 已排队 → 再次下单被拦截（createOrder 已有 waiting 记录检查）
  r = await req('POST', '/api/orders', { openid: P.openid, sessionId: ctx.fullSessionId, amountFen: 6800, orderType: 'waitlist' });
  check('PASS-10c', '已排队重复下单被拦截', r.status === 400 && (r.data.message || '').includes('候补队列'), `msg=${r.data && r.data.message}`);
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
  db.db.prepare(`UPDATE user_passes SET expires_at = datetime('now','localtime','-1 day') WHERE user_openid = ?`).run(P.openid);
  const expiredN = await db.expireOverduePasses();
  check('PASS-12', '过期任务作废', expiredN >= 1, `n=${expiredN}`);
  r = await req('GET', `/api/passes/my?openid=${P.openid}`);
  check('PASS-12b', '过期状态展示', r.data.pass.expired === true, `expired=${r.data.pass && r.data.pass.expired}`);
  // 次卡测试用户清理
  db.db.prepare("DELETE FROM user_passes WHERE user_openid LIKE 'uid_test_pass%'").run();
  db.db.prepare("DELETE FROM orders WHERE user_openid LIKE 'uid_test_pass%'").run();
  db.db.prepare("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_pass%'").run();
  db.db.prepare("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_pass%'").run();
  db.db.prepare("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_pass%'").run();  // #49 次卡购买走 balance 扣款 → 留痕 balance_logs，先删再删 users（FK）
  db.db.prepare("DELETE FROM users WHERE openid LIKE 'uid_test_pass%'").run();

  // ===== 清理测试数据 =====
  console.log('\n── 11. 清理测试数据 ──');
  try {
    db.db.prepare("DELETE FROM orders WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM bookings WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM user_passes WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM waitlist WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM course_sessions WHERE source='test_suite'").run();
    db.db.prepare("DELETE FROM invitations WHERE inviter LIKE 'uid_test_%' OR invitee LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM coach_notes WHERE coach_openid LIKE 'uid_test_%' OR student_openid LIKE 'uid_test_%'").run();
    db.db.prepare("UPDATE coaches SET user_openid = NULL WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM balance_logs WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM member_recharges WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM coin_logs WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("DELETE FROM coin_exchanges WHERE user_openid LIKE 'uid_test_%'").run();
    db.db.prepare("UPDATE users SET coin_balance = 0 WHERE openid LIKE 'uid_test_%'").run();
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
}

main().catch(e => {
  console.error('测试脚本异常:', e);
  process.exitCode = 2;
});
