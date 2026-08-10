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
const db = require('./db');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // 允许局域网访问（真机调试）

// ===== 工具函数 =====

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

  // 真实环境：用 code 调微信 jscode2session 接口换取 openid
  // 演示环境：客户端直接传模拟 openid（或由 wx.login code 生成的稳定标识）
  const finalOpenid = openid || (code ? `demo_${code.slice(0, 20)}` : null);
  if (!finalOpenid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid 或 code' });
  }

  // 1. 查库：是否已注册
  let user = db.findUserByOpenid(finalOpenid);

  if (user) {
    // 已注册 → 登录：更新登录信息
    user = db.touchLogin(finalOpenid);
    return sendJson(res, 200, {
      code: 200,
      message: '登录成功',
      isNewUser: false,
      user: toPublicUser(user)
    });
  }

  // 2. 未注册 → 注册
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
  return sendJson(res, 200, {
    code: 200,
    totalUsers: db.countUsers()
  });
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
    } else if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { code: 200, status: 'ok', time: new Date().toISOString() });
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
