/**
 * 综合训练馆订课系统 - 后端服务
 * Node.js 原生 HTTP + SQLite
 *
 * 启动：node server/index.js  （默认端口 3000）
 *
 * API:
 *   POST /api/auth/login    注册/登录（首次=注册，再次=登录）
 *   POST /api/auth/profile  更新用户资料（昵称/头像）
 *   GET  /api/users         用户列表（后台用）
 *   GET  /api/users/stats   用户统计
 *   GET  /api/health        健康检查
 */
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // 允许局域网访问（真机调试）

// ===== 微信小程序配置（从环境变量读取，勿硬编码 secret）=====
// 启动方式：WX_APPID=xxx WX_SECRET=yyy node server/index.js
const WX_APPID = process.env.WX_APPID || 'wx509088154a505409'; // 你的 AppID
const WX_SECRET = process.env.WX_SECRET || '';                  // AppSecret（开发环境可临时填入）

// ===== 工具函数 =====

/**
 * 微信 code2session：用 wx.login 的 code 换取真实 openid
 * 文档: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 * @returns {Promise<{openid?: string, errcode?: number, errmsg?: string}>}
 */
function code2Session(code) {
  return new Promise((resolve) => {
    if (!code || !WX_SECRET) {
      // 未配置 secret → 无法换取，返回空（调用方回退演示模式）
      return resolve({});
    }
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_SECRET}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ errcode: -1, errmsg: '响应解析失败' });
        }
      });
    });
    req.on('error', (e) => resolve({ errcode: -2, errmsg: e.message }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ errcode: -3, errmsg: '请求微信超时' });
    });
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }
  return false;
}

// ===== 路由处理 =====

async function handleLogin(req, res) {
  const body = await readBody(req);
  const { code, openid, nickname, avatar, phone } = body;

  // 1. 优先用 code 调微信接口换真实 openid（真实微信身份）
  let finalOpenid = null;
  let wechatVerified = false;
  if (code) {
    const session = await code2Session(code);
    if (session.openid) {
      finalOpenid = session.openid;   // 真实微信 openid
      wechatVerified = true;
    } else if (session.errcode) {
      console.warn('[wechat] code2session 失败:', session.errcode, session.errmsg);
      // 换取失败：若客户端传了 openid 则回退（演示/离线场景）
      finalOpenid = openid || null;
    }
  } else {
    finalOpenid = openid || null;     // 无 code（演示环境直接传 openid）
  }

  if (!finalOpenid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid 或 code' });
  }

  // 2. 查库：是否已注册
  let user = db.findUserByOpenid(finalOpenid);

  if (user) {
    // 已注册 → 登录：更新登录信息
    user = db.touchLogin(finalOpenid);
    return sendJson(res, 200, {
      code: 200,
      message: '登录成功',
      isNewUser: false,
      wechatVerified,
      user: toPublicUser(user)
    });
  }

  // 3. 未注册 → 注册
  user = db.createUser({
    openid: finalOpenid,
    nickname: nickname || '',
    avatar: avatar || '',
    phone: phone || ''
  });
  return sendJson(res, 201, {
    code: 201,
    message: '注册成功',
    isNewUser: true,
    wechatVerified,
    user: toPublicUser(user)
  });
}

async function handleProfile(req, res) {
  const body = await readBody(req);
  const { openid, nickname, avatar } = body;
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  const user = db.findUserByOpenid(openid);
  if (!user) {
    return sendJson(res, 404, { code: 404, message: '用户不存在，请先登录' });
  }
  const updated = db.updateProfile(openid, { nickname, avatar });
  return sendJson(res, 200, {
    code: 200,
    message: '资料已更新',
    user: toPublicUser(updated)
  });
}

function handleUsers(req, res) {
  const users = db.listUsers();
  return sendJson(res, 200, { code: 200, users: users.map(toPublicUser) });
}

function handleStats(req, res) {
  // 支持 ?openid=xxx 返回该用户真实锻炼数据
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const base = {
    code: 200,
    totalUsers: db.countUsers()
  };
  if (openid) {
    base.myStats = {
      finishedWorkouts: db.countFinishedWorkouts(openid),  // 已完成锻炼次数
      upcomingBookings: db.countUpcomingBookings(openid),  // 待上课数
      totalBookings: db.countBookingsByUser(openid)        // 已订课总数
    };
  }
  return sendJson(res, 200, base);
}

// 删除单个用户（?id=xxx 或 ?openid=xxx）
function handleDeleteUser(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = url.searchParams.get('id');
  const openid = url.searchParams.get('openid');

  let deleted = false;
  if (id) {
    deleted = db.deleteUserById(id);
  } else if (openid) {
    deleted = db.deleteUserByOpenid(openid);
  }

  if (!deleted) {
    return sendJson(res, 404, { code: 404, message: '用户不存在或已删除' });
  }
  return sendJson(res, 200, { code: 200, message: '用户已删除', totalUsers: db.countUsers() });
}

// 清空所有用户
function handleClearUsers(req, res) {
  const removed = db.clearUsers();
  return sendJson(res, 200, {
    code: 200,
    message: `已清空 ${removed} 名用户`,
    removed,
    totalUsers: 0
  });
}

// 订课（支付成功后调用）
async function handleCreateBooking(req, res) {
  const body = await readBody(req);
  const { openid, sessionId, amountFen, payStatus } = body;
  if (!openid || !sessionId) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid 或 sessionId' });
  }
  const result = db.createBooking({
    user_openid: openid,
    session_id: sessionId,
    amount_fen: amountFen || 0,
    pay_status: payStatus || 'paid'
  });
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  return sendJson(res, 201, { code: 201, message: '订课成功', booking: result.booking });
}

// 查询我的订课（GET /api/bookings?openid=xxx&status=booked）
function handleListBookings(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const status = url.searchParams.get('status') || undefined;
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  const bookings = db.listBookingsByUser(openid, status);
  return sendJson(res, 200, { code: 200, bookings });
}

// 退订（DELETE /api/bookings/:id?openid=xxx）
function handleCancelBooking(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');
  const bookingId = parseInt(pathParts[pathParts.length - 1], 10);
  const openid = url.searchParams.get('openid');
  if (!bookingId || !openid) {
    return sendJson(res, 400, { code: 400, message: '缺少订课ID或openid' });
  }
  const result = db.cancelBooking(openid, bookingId);
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  return sendJson(res, 200, {
    code: 200,
    message: '已退订',
    promoted: result.promoted ? { openid: result.promoted.user_openid, waitNo: result.promoted.wait_no } : null
  });
}

// ===== 候补排位（waitlist）=====

// 满员付费排位（POST /api/waitlist）
async function handleJoinWaitlist(req, res) {
  const body = await readBody(req);
  const { openid, sessionId, amountFen } = body;
  if (!openid || !sessionId) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid 或 sessionId' });
  }
  const result = db.joinWaitlist({
    user_openid: openid,
    session_id: sessionId,
    amount_fen: amountFen || 0
  });
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  return sendJson(res, 201, { code: 201, message: '候补排位成功', wait: result.wait });
}

// 查询我的候补（GET /api/waitlist?openid=xxx，附带过期退款任务）
function handleListWaitlist(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  // 顺带执行过期退款任务（课程已开始未排到 → 自动退款）
  const refunded = db.refundExpiredWaitlist();
  const waits = db.listWaitlistByUser(openid);
  return sendJson(res, 200, { code: 200, waits, refunded });
}

// 退出候补（DELETE /api/waitlist/:id?openid=xxx）
function handleCancelWaitlist(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');
  const waitId = parseInt(pathParts[pathParts.length - 1], 10);
  const openid = url.searchParams.get('openid');
  if (!waitId || !openid) {
    return sendJson(res, 400, { code: 400, message: '缺少排位ID或openid' });
  }
  const result = db.cancelWaitlist(openid, waitId);
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  return sendJson(res, 200, { code: 200, message: '已退出候补，费用已原路退回' });
}

// ===== 课程管理（电脑端课程编辑网页用）=====

// 下拉选项元数据
function handleMeta(req, res) {
  const imgDir = path.join(__dirname, '..', 'miniprogram', 'images');
  let images = [];
  try {
    images = fs.readdirSync(imgDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).map(f => `/images/${f}`);
  } catch (e) { /* 目录不存在则空 */ }
  return sendJson(res, 200, {
    code: 200,
    coaches: db.listCoaches(),
    venues: db.listVenues(),
    categories: [...new Set(['Hybrid综合训练', '燃脂团课', '力量训练', '瑜伽普拉提', '骑行有氧'].concat(db.listCourses().map(c => c.category)))],
    levels: [1, 2, 3, 4, 5],
    durations: [30, 45, 60, 90, 120],
    prices: [50, 58, 68, 80, 88, 90, 108, 128],
    statuses: ['published', 'draft'],
    statusLabels: { published: '已发布', draft: '草稿' },
    descriptions: ['', '全身综合体能训练，含力量与心肺', '新手友好，从基础动作开始', '高强度进阶，挑战极限'],
    images,
    timeSlots: (() => { const s = []; for (let h = 6; h < 22; h++) for (const m of [0, 30]) s.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); return s; })(),
    weekdays: [1, 2, 3, 4, 5, 6, 7].map(v => ({ v, label: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][v - 1] })),
    capacities: [10, 15, 20, 25, 30]
  });
}

function handleListCourses(req, res) {
  return sendJson(res, 200, { code: 200, courses: db.listCourses() });
}

function handleCreateCourse(req, res, body) {
  const { name, category, level, duration_min, price_fen, cover, description, status, rules } = body || {};
  if (!name || !category) {
    return sendJson(res, 400, { code: 400, message: '课程名称与分类必填' });
  }
  const course = db.createCourse({
    name, category,
    level: level || 3,
    duration_min: duration_min || 60,
    price_fen: price_fen || 0,
    cover: cover || '', description: description || '', status: status || 'published', rules: rules || []
  });
  return sendJson(res, 201, { code: 201, message: '课程已创建', course: { id: course.id } });
}

function handleUpdateCourse(req, res, id, body) {
  if (!body || !body.name) {
    return sendJson(res, 400, { code: 400, message: '课程名称必填' });
  }
  const ok = db.updateCourse(id, body);
  if (!ok) return sendJson(res, 404, { code: 404, message: '课程不存在' });
  return sendJson(res, 200, { code: 200, message: '课程已保存' });
}

function handleDeleteCourse(req, res, id) {
  const result = db.deleteCourse(id);
  if (!result.ok) {
    return sendJson(res, 409, { code: 409, message: `课程存在 ${result.bookings} 条预约记录，无法删除` });
  }
  return sendJson(res, 200, { code: 200, message: '课程已删除' });
}

function handlePublishCourse(req, res, id, body) {
  const { start_date, end_date } = body || {};
  if (!start_date || !end_date) {
    return sendJson(res, 400, { code: 400, message: '请选择发布起止日期' });
  }
  const course = db.listCourses().find(c => c.id === Number(id));
  if (!course) return sendJson(res, 404, { code: 404, message: '课程不存在' });
  const result = db.publishSessions(Number(id), start_date, end_date);
  if (result.reason === 'no_rules') {
    return sendJson(res, 400, { code: 400, message: '请先添加至少一条每周排课规则' });
  }
  return sendJson(res, 200, {
    code: 200,
    message: `发布完成：新增 ${result.created} 个场次，跳过 ${result.skipped} 个已存在场次`,
    ...result
  });
}

// ===== 静态资源（课程编辑网页 + 图片）=====
function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { code: 404, message: '资源不存在' });
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ===== 场次查询（学员端课程列表/详情）=====
function handleSessionsByDate(req, res, date) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid') || null;
  const sessions = db.listSessionsByDateForUser(date, openid);
  return sendJson(res, 200, { code: 200, date, sessions });
}

function handleSessionDetail(req, res, id) {
  const s = db.getSessionById(Number(id));
  if (!s) return sendJson(res, 404, { code: 404, message: '场次不存在' });
  // 携带 openid 时标记是否已订
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid') || null;
  let result = s;
  if (openid) {
    const booked = db.db.prepare("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'").get(openid, s.id);
    result = { ...s, booked_by_me: !!booked };
  }
  return sendJson(res, 200, { code: 200, session: result });
}

function toPublicUser(user) {
  return {
    id: user.id,
    openid: user.openid,
    nickname: user.nickname,
    avatar: user.avatar,
    phone: user.phone,
    role: user.role,
    total_classes: user.total_classes,
    total_hours: user.total_hours,
    total_calories: user.total_calories,
    streak: user.streak,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    login_count: user.login_count
  };
}

// ===== 服务器 =====

const server = http.createServer(async (req, res) => {
  try {
    if (handleCors(req, res)) return;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // 路由分发
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      await handleLogin(req, res);
    } else if (req.method === 'POST' && pathname === '/api/auth/profile') {
      await handleProfile(req, res);
    } else if (req.method === 'GET' && pathname === '/api/users') {
      handleUsers(req, res);
    } else if (req.method === 'GET' && pathname === '/api/users/stats') {
      handleStats(req, res);
    } else if (req.method === 'DELETE' && pathname === '/api/users') {
      handleDeleteUser(req, res);
    } else if (req.method === 'DELETE' && pathname === '/api/users/clear') {
      handleClearUsers(req, res);
    } else if (req.method === 'POST' && pathname === '/api/bookings') {
      await handleCreateBooking(req, res);
    } else if (req.method === 'GET' && pathname === '/api/bookings') {
      handleListBookings(req, res);
    } else if (req.method === 'DELETE' && pathname.startsWith('/api/bookings/')) {
      handleCancelBooking(req, res);
    } else if (req.method === 'POST' && pathname === '/api/waitlist') {
      await handleJoinWaitlist(req, res);
    } else if (req.method === 'GET' && pathname === '/api/waitlist') {
      handleListWaitlist(req, res);
    } else if (req.method === 'DELETE' && pathname.startsWith('/api/waitlist/')) {
      handleCancelWaitlist(req, res);
    } else if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { code: 200, status: 'ok', time: new Date().toISOString() });
    } else if (req.method === 'GET' && pathname === '/api/meta') {
      handleMeta(req, res);
    } else if (req.method === 'GET' && pathname === '/api/courses') {
      handleListCourses(req, res);
    } else if (req.method === 'POST' && pathname === '/api/courses') {
      const body = await readBody(req);
      handleCreateCourse(req, res, body);
    } else if (req.method === 'PUT' && /^\/api\/courses\/\d+$/.test(pathname)) {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      handleUpdateCourse(req, res, id, body);
    } else if (req.method === 'DELETE' && /^\/api\/courses\/\d+$/.test(pathname)) {
      const id = pathname.split('/')[3];
      handleDeleteCourse(req, res, id);
    } else if (req.method === 'POST' && /^\/api\/courses\/\d+\/publish$/.test(pathname)) {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      handlePublishCourse(req, res, id, body);
    } else if (req.method === 'GET' && pathname === '/api/sessions') {
      const date = url.searchParams.get('date');
      if (!date) {
        return sendJson(res, 400, { code: 400, message: '缺少 date 参数（YYYY-MM-DD）' });
      }
      handleSessionsByDate(req, res, date);
    } else if (req.method === 'GET' && /^\/api\/sessions\/\d+$/.test(pathname)) {
      handleSessionDetail(req, res, pathname.split('/')[3]);
    } else if (pathname === '/' || pathname === '/courses.html') {
      serveStatic(res, path.join(__dirname, '..', 'web', 'courses.html'));
    } else if (pathname.startsWith('/web/')) {
      serveStatic(res, path.join(__dirname, '..', 'web', pathname.slice(5)));
    } else if (pathname.startsWith('/images/')) {
      const name = path.basename(pathname);
      serveStatic(res, path.join(__dirname, '..', 'miniprogram', 'images', name));
    } else {
      sendJson(res, 404, { code: 404, message: '接口不存在' });
    }
  } catch (e) {
    console.error('[server error]', e);
    sendJson(res, 500, { code: 500, message: '服务器内部错误: ' + e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log('========================================');
  console.log('  综合训练馆订课系统 - 后端服务已启动');
  console.log(`  地址: http://127.0.0.1:${PORT}`);
  console.log(`  局域网: http://<本机IP>:${PORT}`);
  console.log(`  数据库: server/data/gym.db`);
  console.log('========================================');
});
