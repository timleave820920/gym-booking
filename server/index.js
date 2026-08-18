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
 *   POST /api/bookings      订课
 *   GET  /api/bookings      查询我的订课
 *   DELETE /api/bookings/:id 退订
 *   POST /api/waitlist      候补排位
 *   GET  /api/waitlist      查询我的候补（含过期退款）
 *   DELETE /api/waitlist/:id 退出候补
 *   POST /api/orders        下单（创建待支付订单）
 *   POST /api/orders/:id/pay 支付回写
 *   GET  /api/orders        查询我的订单
 *   GET  /api/health        健康检查
 */
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const { driver } = require('./db');
const { logOp } = require('./logger');

// ===== 加载 .env（WX_APPID / WX_SECRET / PORT 等；不覆盖已存在的环境变量）=====
// 2026-08-14 添加：真机朋友测试需要真实 openid，secret 放 server/.env（gitignore，不入库）
try {
  const envPath = require('node:path').join(__dirname, '.env');
  const envContent = require('node:fs').readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
} catch (e) { /* .env 不存在时静默跳过 */ }

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // 允许局域网访问（真机调试）

// ===== 局域网 IP 自动适配 =====
// 启动时探测本机局域网 IPv4，写入小程序可读取的 net-config.json（gitignore）
// 优先无线网卡（WLAN/Wi-Fi/无线），取第一个非内部地址
function detectLanIP() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) {
        candidates.push({ name, addr: item.address });
      }
    }
  }
  if (candidates.length === 0) return null;
  const wireless = candidates.find(c => /wlan|wi-?fi|wireless|无线|wifi_v/i.test(c.name));
  return (wireless || candidates[0]).addr;
}

function writeNetConfig() {
  const ip = detectLanIP();
  const file = path.join(__dirname, '..', 'miniprogram', 'utils', 'net-config.json');
  try {
    if (!ip) {
      console.warn('[net] 未探测到局域网 IP，跳过 net-config 写入（前端将回退 127.0.0.1）');
      return null;
    }
    const payload = {
      ip,
      baseUrl: `http://${ip}:${PORT}`,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  } catch (e) {
    console.warn('[net] 写入 net-config.json 失败:', e.message);
    return null;
  }
}

// ===== 微信小程序配置（从环境变量读取，勿硬编码 secret）=====
// 启动方式：WX_APPID=xxx WX_SECRET=yyy node server/index.js
const WX_APPID = process.env.WX_APPID || 'wx0aee5332d4ef20fd'; // 与 project.config.json 前端 AppID 一致（正式小程序 2026-08-15）
const WX_SECRET = process.env.WX_SECRET || '';                  // AppSecret（开发环境可临时填入）

// ===== 微信官方 API 白名单（BUG-LEDGER #46，2026-08-17）=====
// 微信云托管出网经安全网关，网关用自签名证书重签 HTTPS——白名单内关证书校验（平台适配），
// 白名单外保持默认严格校验。api.mch.weixin.qq.com 为未来微信支付预留。
const WECHAT_API_HOSTS = new Set(['api.weixin.qq.com', 'api.mch.weixin.qq.com']);

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
    // BUG-LEDGER #46（2026-08-17）：微信云托管出网经安全网关，网关用自签名证书重签 HTTPS——
    // Node 默认校验 CA 报 self-signed certificate，code2Session 永远失败（-2），微信登录换号必挂
    // （此前被演示账号兜底掩盖，BUG-LEDGER #45 去掉兜底后显形）。
    // 正式形态：仅微信官方 API 白名单内关证书校验（平台适配，用户 2026-08-17 确认），白名单外保持默认严格校验
    const req = https.get(url, { rejectUnauthorized: !WECHAT_API_HOSTS.has(new URL(url).hostname) }, (res) => {
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
  const { code, openid, nickname, avatar, phone, role } = body;

  // 1. 优先用 code 调微信接口换真实 openid（真实微信身份）
  // 2026-08-17 用户指令：登录不再有演示账号兜底——有 code 只信 code，
  // 换号失败直接报错（前端弹窗重试），绝不回退客户端 openid（否则微信一键登录会静默变成演示账号）
  let finalOpenid = null;
  let wechatVerified = false;
  if (code) {
    const session = await code2Session(code);
    if (session.openid) {
      finalOpenid = session.openid;   // 真实微信 openid
      wechatVerified = true;
    } else {
      if (session.errcode) {
        console.warn('[wechat] code2session 失败:', session.errcode, session.errmsg);
      }
      const reason = session.errcode
        ? `微信登录校验失败（${session.errcode}）`
        : '微信登录校验失败（AppSecret 未配置或登录码失效）';
      return sendJson(res, 400, { code: 400, message: reason + '，请重试' });
    }
  } else {
    finalOpenid = openid || null;     // 无 code（本地/CI 测试环境直接传 openid）
  }

  if (!finalOpenid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid 或 code' });
  }

  // 2. 查库：是否已注册
  let user = await db.findUserByOpenid(finalOpenid);

  if (user) {
    // 已注册 → 登录：更新登录信息
    user = await db.touchLogin(finalOpenid);
    // 2026-08-14: 登录携带昵称且库中昵称为空 → 补全（详情页预约墙头像下方显示昵称）
    const curNick = (user.nickname || '').trim();
    if (nickname && nickname.trim() && !curNick) {
      user = await db.updateProfile(finalOpenid, { nickname: nickname.trim(), avatar: avatar || user.avatar || '' });
    }
    return sendJson(res, 200, {
      code: 200,
      message: '登录成功',
      isNewUser: false,
      wechatVerified,
      user: await toPublicUser(user)
    });
  }

  // 3. 未注册 → 注册
  user = await db.createUser({
    openid: finalOpenid,
    nickname: nickname || '',
    avatar: avatar || '',
    phone: phone || '',
    role: role || 'student'
  });
  return sendJson(res, 201, {
    code: 201,
    message: '注册成功',
    isNewUser: true,
    wechatVerified,
    user: await toPublicUser(user)
  });
}

async function handleProfile(req, res) {
  const body = await readBody(req);
  const { openid, nickname, avatar } = body;
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  const user = await db.findUserByOpenid(openid);
  if (!user) {
    return sendJson(res, 404, { code: 404, message: '用户不存在，请先登录' });
  }
  const updated = await db.updateProfile(openid, { nickname, avatar });
  return sendJson(res, 200, {
    code: 200,
    message: '资料已更新',
    user: await toPublicUser(updated)
  });
}

async function handleUsers(req, res) {
  const users = await db.listUsers();
  // BUGS-INBOX #41：toPublicUser 为 async，map 不 await 会得到 Promise 数组（序列化后全空对象）
  const publics = await Promise.all(users.map(toPublicUser));
  return sendJson(res, 200, { code: 200, users: publics });
}

async function handleStats(req, res) {
  // 支持 ?openid=xxx 返回该用户真实锻炼数据
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const base = {
    code: 200,
    totalUsers: await db.countUsers()
  };
  if (openid) {
    base.myStats = {
      finishedWorkouts: await db.countFinishedWorkouts(openid),  // 已完成锻炼次数
      upcomingBookings: await db.countUpcomingBookings(openid),  // 待上课数
      totalBookings: await db.countBookingsByUser(openid)        // 已订课总数
    };
  }
  return sendJson(res, 200, base);
}

// 删除单个用户（?id=xxx 或 ?openid=xxx）
async function handleDeleteUser(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = url.searchParams.get('id');
  const openid = url.searchParams.get('openid');

  let deleted = false;
  if (id) {
    deleted = await db.deleteUserById(id);
  } else if (openid) {
    deleted = await db.deleteUserByOpenid(openid);
  }

  if (!deleted) {
    return sendJson(res, 404, { code: 404, message: '用户不存在或已删除' });
  }
  return sendJson(res, 200, { code: 200, message: '用户已删除', totalUsers: await db.countUsers() });
}

// 清空所有用户
async function handleClearUsers(req, res) {
  const removed = await db.clearUsers();
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
  const result = await db.createBooking({
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
async function handleListBookings(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const status = url.searchParams.get('status') || undefined;
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  const bookings = await db.listBookingsByUser(openid, status);
  return sendJson(res, 200, { code: 200, bookings });
}

// 退订（DELETE /api/bookings/:id?openid=xxx）
async function handleCancelBooking(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');
  const bookingId = parseInt(pathParts[pathParts.length - 1], 10);
  const openid = url.searchParams.get('openid');
  if (!bookingId || !openid) {
    return sendJson(res, 400, { code: 400, message: '缺少订课ID或openid' });
  }
  const result = await db.cancelBooking(openid, bookingId);
  if (!result.ok) {
    await logOp(openid, 'refund', { bookingId }, 'fail');
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  await logOp(openid, 'refund', { bookingId, promoted: !!(result.promoted) }, 'ok');
  return sendJson(res, 200, {
    code: 200,
    message: '已退订',
    promoted: result.promoted ? { openid: result.promoted.user_openid, waitNo: result.promoted.wait_no } : null
  });
}

// ===== 签到（checkin）=====

// 签到凭证信息（GET /api/checkin/:id，学员二维码页）
async function handleCheckinInfo(req, res) {
  const pathParts = req.url.split('/');
  const bookingId = parseInt(pathParts[pathParts.length - 1], 10);
  const info = await db.getCheckinInfo(bookingId);
  if (!info) return sendJson(res, 404, { code: 404, message: '订课记录不存在' });
  return sendJson(res, 200, { code: 200, info });
}

// 教练核销签到（POST /api/bookings/:id/checkin）
async function handleCheckin(req, res) {
  const pathParts = req.url.split('/');
  const bookingId = parseInt(pathParts[pathParts.length - 2], 10);
  const body = await readBody(req);
  const { openid } = body;
  if (!bookingId || !openid) {
    return sendJson(res, 400, { code: 400, message: '缺少订课ID或openid' });
  }
  const result = await db.checkinBooking({ bookingId, coachOpenid: openid });
  if (!result.ok) {
    await logOp(openid, 'checkin', { bookingId }, 'fail');
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  await logOp(result.booking.user_openid, 'checkin', { bookingId, course: result.booking.course_name }, 'ok', result.booking.booking_no);
  return sendJson(res, 200, { code: 200, message: '签到成功', booking: result.booking });
}

// 教练按签到码核销（POST /api/checkin/by-code，BUGS-INBOX #11：随机 5 位码）
async function handleCheckinByCode(req, res) {
  const body = await readBody(req);
  const { code, openid } = body || {};
  if (!code || !openid) {
    return sendJson(res, 400, { code: 400, message: '缺少签到码或openid' });
  }
  const result = await db.checkinByCode({ code, coachOpenid: openid });
  if (!result.ok) {
    await logOp(openid, 'checkin', { code }, 'fail');
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  await logOp(result.booking.user_openid, 'checkin', { code, course: result.booking.course_name }, 'ok', result.booking.booking_no);
  return sendJson(res, 200, { code: 200, message: '签到成功', booking: result.booking });
}

// 按场次查订课名单（GET /api/sessions/:id/students，教练端）
async function handleSessionStudents(req, res) {
  const pathParts = req.url.split('/');
  const sessionId = parseInt(pathParts[pathParts.length - 2], 10);
  const students = await db.listBookingsBySession(sessionId);
  const checked = students.filter(s => s.checkin_at).length;
  return sendJson(res, 200, { code: 200, students, checked, total: students.length });
}

// ===== 候补排位（waitlist）=====

// 满员付费排位（POST /api/waitlist）
async function handleJoinWaitlist(req, res) {
  const body = await readBody(req);
  const { openid, sessionId, amountFen, expireMode } = body;
  if (!openid || !sessionId) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid 或 sessionId' });
  }
  const result = await db.joinWaitlist({
    user_openid: openid,
    session_id: sessionId,
    amount_fen: amountFen || 0,
    expire_mode: expireMode || 'start'
  });
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  return sendJson(res, 201, { code: 201, message: '候补排位成功', wait: result.wait });
}

// 查询我的候补（GET /api/waitlist?openid=xxx，附带过期退款任务）
async function handleListWaitlist(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  // 顺带执行过期退款任务（课程已开始未排到 → 自动退款）
  const refunded = await db.refundExpiredWaitlist();
  const waits = await db.listWaitlistByUser(openid);
  return sendJson(res, 200, { code: 200, waits, refunded });
}

// 退出候补（DELETE /api/waitlist/:id?openid=xxx）
async function handleCancelWaitlist(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');
  const waitId = parseInt(pathParts[pathParts.length - 1], 10);
  const openid = url.searchParams.get('openid');
  if (!waitId || !openid) {
    return sendJson(res, 400, { code: 400, message: '缺少排位ID或openid' });
  }
  const result = await db.cancelWaitlist(openid, waitId);
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  return sendJson(res, 200, { code: 200, message: '已退出候补，费用已原路退回' });
}

// ===== 会员体系（member）=====

// 会员等级信息（GET /api/member/level?openid=xxx）
async function handleMemberLevel(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const level = await db.getMemberLevel(openid);
  if (!level) return sendJson(res, 404, { code: 404, message: '用户不存在' });
  return sendJson(res, 200, { code: 200, level });
}

// 充值套餐（GET /api/member/plans?openid=xxx，带 openid 时按用户首充状态计算赠送）
async function handleMemberPlans(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const plans = await Promise.all(db.RECHARGE_PLANS.map(async p => {
    // 每档首充送 30% / 复充送 10%（配置在 member-config.js）
    const { bonus, isFirst } = openid
      ? await db.calcRechargeBonus(openid, p.amount)
      : { bonus: Math.round(p.amount * p.firstBonusRate), isFirst: true };
    return {
      id: p.id, amount: p.amount,
      amountYuan: p.amount / 100,
      firstBonusRate: p.firstBonusRate,
      repeatBonusRate: p.repeatBonusRate,
      isFirst,
      bonus, bonusYuan: bonus / 100,
      totalYuan: (p.amount + bonus) / 100
    };
  }));
  return sendJson(res, 200, { code: 200, plans });
}

// 会员配置（GET /api/member/config，前端统一读取数值）
function handleMemberConfig(req, res) {
  const config = require('./member-config.js');
  // 组装前端友好格式
  return sendJson(res, 200, {
    code: 200,
    config: {
      levels: config.levels.map(l => {
        const pct = Math.round(l.discount * 100);   // 90 / 85 / 80 / 75
        const discountText = (pct % 10 === 0) ? (pct / 10) + ' 折' : pct + ' 折';  // 90→9折 85→85折
        return { ...l, discountText };
      }),
      rechargePlans: config.rechargePlans.map(p => ({
        ...p,
        amountYuan: p.amount / 100,
        firstBonusYuan: Math.round(p.amount * p.firstBonusRate) / 100,
        repeatBonusYuan: Math.round(p.amount * p.repeatBonusRate) / 100
      })),
      inviteRewards: config.inviteRewards.map(r => ({
        ...r,
        rewardYuan: r.fen / 100,
        label: r.at + ' 人'
      })),
      memberPrice: config.memberPrice,
      levelStyles: config.levelStyles
    }
  });
}

// 充值记录（GET /api/member/recharges?openid=xxx）
async function handleMemberRecharges(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  // 分页参数（默认最近 10 笔）
  const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
  const limit = parseInt(url.searchParams.get('limit') || '10', 10) || 10;
  const recharges = await db.listRecharges(openid, offset, limit);
  return sendJson(res, 200, { code: 200, recharges, hasMore: recharges.length >= limit });
}

// 邀请绑定（POST /api/invite）
async function handleInvite(req, res) {
  const body = await readBody(req);
  const { inviter, invitee } = body;
  if (!inviter || !invitee) return sendJson(res, 400, { code: 400, message: '缺少 inviter 或 invitee' });
  const result = await db.bindInvitation({ inviter, invitee });
  if (!result.ok) return sendJson(res, 400, { code: 400, message: result.error });
  return sendJson(res, 200, { code: 200, message: '邀请关系已建立' });
}

// 邀请战绩（GET /api/invite/stats?openid=xxx）
async function handleInviteStats(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const stats = await db.getInviteStats(openid);
  return sendJson(res, 200, { code: 200, ...stats });
}

// 未读储值奖励（GET /api/member/rewards?openid=xxx，登录庆祝用）
async function handleMemberRewards(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const rewards = await db.listUnreadBalanceLogs(openid);
  return sendJson(res, 200, { code: 200, rewards });
}

// 标记奖励已读（POST /api/member/rewards/read）
async function handleMemberRewardsRead(req, res) {
  const body = await readBody(req);
  const { openid } = body;
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  await db.markBalanceLogsRead(openid);
  return sendJson(res, 200, { code: 200, message: '已标记' });
}

// ===== 能量币（coin）=====

// 余额 + 今日获取（GET /api/coin/balance?openid=xxx）
async function handleCoinBalance(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const info = await db.getCoinInfo(openid);
  if (!info) return sendJson(res, 404, { code: 404, message: '用户不存在' });
  return sendJson(res, 200, { code: 200, ...info });
}

// 流水（GET /api/coin/logs?openid=xxx）
async function handleCoinLogs(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const logs = await db.listCoinLogs(openid);
  return sendJson(res, 200, { code: 200, logs });
}

// 商店奖品（GET /api/coin/shop?openid=xxx）
async function handleCoinShop(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid') || '';
  const items = await db.listShopItems(openid);
  return sendJson(res, 200, { code: 200, items });
}

// 兑换奖品（POST /api/coin/exchange）
async function handleCoinExchange(req, res) {
  const body = await readBody(req);
  const { openid, itemId } = body;
  if (!openid || !itemId) return sendJson(res, 400, { code: 400, message: '缺少 openid 或 itemId' });
  const result = await db.exchangeCoinItem({ openid, itemId });
  if (!result.ok) {
    await logOp(openid, 'exchange', { itemId }, 'fail');
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  await logOp(openid, 'exchange', { itemId, cost: result.exchange && result.exchange.cost }, 'ok', result.exchange && result.exchange.exchange_no);
  return sendJson(res, 200, { code: 200, message: '兑换成功', exchange: result.exchange });
}

// 我的兑换记录（GET /api/coin/exchanges?openid=xxx）
async function handleCoinExchanges(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const exchanges = await db.listMyExchanges(openid);
  return sendJson(res, 200, { code: 200, exchanges });
}

// 能量币配置（GET /api/coin/config，前端展示获取规则）
function handleCoinConfig(req, res) {
  const cfg = require('./energy-config.js');
  return sendJson(res, 200, { code: 200, config: cfg });
}

// ===== 订单（orders）=====

// 下单（POST /api/orders）→ 创建待支付订单
async function handleCreateOrder(req, res) {
  const body = await readBody(req);
  const { openid, sessionId, amountFen, orderType, expireMode } = body;
  // 充值/次卡订单无场次（sessionId 可省略或为 0）
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  if (orderType !== 'recharge' && orderType !== 'pass' && !sessionId) {
    return sendJson(res, 400, { code: 400, message: '缺少 sessionId' });
  }
  const result = await db.createOrder({
    user_openid: openid,
    session_id: sessionId,
    amount_fen: amountFen || 0,
    order_type: orderType || 'book',
    expire_mode: expireMode || 'start'
  });
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  return sendJson(res, 201, { code: 201, message: '下单成功', order: result.order });
}

// 支付回写（POST /api/orders/:id/pay）→ 模拟支付成功后调用
async function handlePayOrder(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');
  // /api/orders/:id/pay → id 在倒数第二段
  const orderId = parseInt(pathParts[pathParts.length - 2], 10);
  const body = await readBody(req);
  const { openid, payMethod } = body;
  if (!orderId || !openid) {
    return sendJson(res, 400, { code: 400, message: '缺少订单ID或openid' });
  }
  const result = await db.payOrder({
    openid,
    orderId,
    pay_method: payMethod || 'balance'
  });
  if (!result.ok) {
    await logOp(openid, 'pay', { orderId, payMethod, orderType: 'unknown' }, 'fail');
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  await logOp(openid, 'pay', { orderId, payMethod, orderType: result.order.order_type, amountFen: result.order.amount_fen }, result.already ? 'already' : 'ok', result.order.order_no);
  if (result.order.order_type === 'pass' && result.recharge && result.recharge.pass) {
    await logOp(openid, 'pass_buy', { orderId, pkg: result.recharge.pkgName, added: result.recharge.added, remaining: result.recharge.pass.remaining }, 'ok', result.order.order_no);
  }
  return sendJson(res, 200, {
    code: 200,
    message: result.already ? '订单已支付' : '支付成功',
    already: !!result.already,
    order: result.order,
    booking: result.booking,
    wait: result.wait,
    recharge: result.recharge || null,
    reward: result.reward || null
  });
}

// 查询我的订单（GET /api/orders?openid=xxx&status=paid）
async function handleListOrders(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const status = url.searchParams.get('status') || undefined;
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  const orders = await db.listOrdersByUser(openid, status);
  return sendJson(res, 200, { code: 200, orders });
}

// 营收统计（GET /api/revenue，管理后台）
async function handleRevenue(req, res) {
  const stats = await db.getRevenueStats();
  return sendJson(res, 200, { code: 200, ...stats });
}

// ===== 课程管理（电脑端课程编辑网页用）=====

// 下拉选项元数据
async function handleMeta(req, res) {
  const imgDir = path.join(__dirname, '..', 'miniprogram', 'images');
  let images = [];
  try {
    images = fs.readdirSync(imgDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).map(f => `/images/${f}`);
  } catch (e) { /* 目录不存在则空 */ }
  return sendJson(res, 200, {
    code: 200,
    coaches: await db.listCoaches(),
    venues: await db.listVenues(),
    categories: [...new Set(['Hybrid综合训练', '燃脂团课', '力量训练', '瑜伽普拉提', '骑行有氧'].concat((await db.listCourses()).map(c => c.category)))],
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

async function handleListCourses(req, res) {
  return sendJson(res, 200, { code: 200, courses: await db.listCourses() });
}

async function handleCreateCourse(req, res, body) {
  const { name, category, level, duration_min, price_fen, cover, description, status, rules, coach_bio } = body || {};
  if (!name || !category) {
    return sendJson(res, 400, { code: 400, message: '课程名称与分类必填' });
  }
  const course = await db.createCourse({
    name, category,
    level: level || 3,
    duration_min: duration_min || 60,
    price_fen: price_fen || 0,
    cover: cover || '', description: description || '', status: status || 'published', rules: rules || []
  });
  // 「教练介绍」→ 写入该课程教练档案 bio（DESIGN #D2 修复：原字段后端未保存；
  // 未排课前无教练可挂，静默跳过，排课后再次保存课程即生效）
  if (coach_bio !== undefined) await db.setCourseCoachBio(course.id, coach_bio);
  return sendJson(res, 201, { code: 201, message: '课程已创建', course: { id: course.id } });
}

async function handleUpdateCourse(req, res, id, body) {
  if (!body || !body.name) {
    return sendJson(res, 400, { code: 400, message: '课程名称必填' });
  }
  const ok = await db.updateCourse(id, body);
  if (!ok) return sendJson(res, 404, { code: 404, message: '课程不存在' });
  if (body.coach_bio !== undefined) await db.setCourseCoachBio(id, body.coach_bio);
  return sendJson(res, 200, { code: 200, message: '课程已保存' });
}

async function handleDeleteCourse(req, res, id) {
  const result = await db.deleteCourse(id);
  if (!result.ok) {
    return sendJson(res, 409, { code: 409, message: `课程存在 ${result.bookings} 条预约记录，无法删除` });
  }
  return sendJson(res, 200, { code: 200, message: '课程已删除' });
}

async function handlePublishCourse(req, res, id, body) {
  const { start_date, end_date } = body || {};
  if (!start_date || !end_date) {
    return sendJson(res, 400, { code: 400, message: '请选择发布起止日期' });
  }
  const course = (await db.listCourses()).find(c => c.id === Number(id));
  if (!course) return sendJson(res, 404, { code: 404, message: '课程不存在' });
  const result = await db.publishSessions(Number(id), start_date, end_date);
  if (result.reason === 'no_rules') {
    return sendJson(res, 400, { code: 400, message: '请先添加至少一条每周排课规则' });
  }
  const conflictMsg = result.conflicts && result.conflicts.length > 0
    ? `；跳过 ${result.conflicts.length} 个场地时间冲突场次（如 ${result.conflicts[0].date} ${result.conflicts[0].start_time}）`
    : '';
  return sendJson(res, 200, {
    code: 200,
    message: `发布完成：新增 ${result.created} 个场次，跳过 ${result.skipped} 个已存在/冲突场次${conflictMsg}`,
    ...result
  });
}

// ===== 图片上传（课程封面等，存到 miniprogram/images/）=====
function handleUpload(req, res, body) {
  const { name, data, dir } = body || {};
  if (!name || !data) return sendJson(res, 400, { code: 400, message: '缺少文件名称或内容' });
  const ext = path.extname(name).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return sendJson(res, 400, { code: 400, message: '仅支持 png/jpg/jpeg/webp 图片' });
  }
  // data 形如 data:image/png;base64,xxxx
  const m = /^data:image\/[\w.+-]+;base64,(.+)$/.exec(String(data));
  if (!m) return sendJson(res, 400, { code: 400, message: '图片内容格式不正确' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length === 0 || buf.length > 512 * 1024) {
    return sendJson(res, 400, { code: 400, message: '图片为空或超过 512KB 限制' });
  }
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
  // dir=uploads → server/uploads（服务器端资源，不随小程序包发布，用于详情页轮播图）
  const imgDir = dir === 'uploads'
    ? path.join(__dirname, 'uploads')
    : path.join(__dirname, '..', 'miniprogram', 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, fileName), buf);
  const urlPrefix = dir === 'uploads' ? '/uploads/' : '/images/';
  return sendJson(res, 200, { code: 200, path: urlPrefix + fileName, message: '上传成功' });
}

// ===== 微信头像下载转存（2026-08-15）=====
// chooseAvatar 选「微信头像」返回 thirdwx.qlogo.cn 网络 URL，直接存 URL 会因合法域名校验显示失败
// （回退默认头像）；这里服务端下载后转存到 miniprogram/images/，包内相对路径直接显示
function handleAvatarDownload(req, res, body) {
  const { url } = body || {};
  if (!url || !/^https:\/\/thirdwx\.qlogo\.cn\//.test(String(url))) {
    return sendJson(res, 400, { code: 400, message: '仅支持微信头像链接(thirdwx.qlogo.cn)' });
  }
  const req2 = https.get(url, (res2) => {
    if (res2.statusCode !== 200) {
      req2.destroy();
      return sendJson(res, 502, { code: 502, message: '头像下载失败' });
    }
    const chunks = [];
    res2.on('data', c => chunks.push(c));
    res2.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0 || buf.length > 512 * 1024) {
          return sendJson(res, 400, { code: 400, message: '头像为空或超过 512KB' });
        }
        const ct = res2.headers['content-type'] || '';
        if (!/^image\//.test(ct)) {
          return sendJson(res, 400, { code: 400, message: '非图片内容' });
        }
        const ext = (ct.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const fileName = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const imgDir = path.join(__dirname, '..', 'miniprogram', 'images');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        fs.writeFileSync(path.join(imgDir, fileName), buf);
        sendJson(res, 200, { code: 200, path: '/images/' + fileName, message: '头像转存成功' });
      } catch (e) {
        sendJson(res, 500, { code: 500, message: '转存失败: ' + e.message });
      }
    });
    res2.on('error', () => sendJson(res, 502, { code: 502, message: '头像下载失败' }));
  });
  req2.on('error', () => sendJson(res, 502, { code: 502, message: '头像下载失败' }));
  req2.setTimeout(8000, () => { req2.destroy(); });
}

// ===== 排表管理：范围场次 / 取消 / 改容量 / 规则替换 =====
async function handleSessionsByRange(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const courseId = url.searchParams.get('course_id') ? Number(url.searchParams.get('course_id')) : 0;
  if (!from || !to) return sendJson(res, 400, { code: 400, message: '缺少 from/to 日期参数' });
  const sessions = await db.listSessionsByRange(from, to, courseId || null);
  return sendJson(res, 200, { code: 200, sessions });
}

async function handleCancelSession(req, res, id) {
  const result = await db.cancelSession(Number(id));
  if (!result.ok) return sendJson(res, 400, { code: 400, message: result.error });
  return sendJson(res, 200, { code: 200, message: '场次已取消' });
}

async function handleUpdateSession(req, res, id, body) {
  const result = await db.updateSessionCapacity(Number(id), body.capacity);
  if (!result.ok) return sendJson(res, 400, { code: 400, message: result.error });
  return sendJson(res, 200, { code: 200, message: '容量已更新' });
}

async function handleReplaceRules(req, res, id, body) {
  const course = (await db.listCourses()).find(c => c.id === Number(id));
  if (!course) return sendJson(res, 404, { code: 404, message: '课程不存在' });
  const result = await db.replaceRules(Number(id), body.rules || []);
  if (!result.ok) return sendJson(res, 400, { code: 400, message: result.error });
  return sendJson(res, 200, { code: 200, message: '排课规则已保存' });
}

// ===== 消息中心（站内信）=====
async function handleListMessages(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const page = Number(url.searchParams.get('page') || 1);
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const messages = await db.listMessages(openid, page);
  const unread = await db.unreadMessageCount(openid);
  return sendJson(res, 200, { code: 200, messages, unread, page });
}

async function handleUnreadCount(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  return sendJson(res, 200, { code: 200, unread: await db.unreadMessageCount(openid) });
}

async function handleMarkRead(req, res, id, body) {
  const openid = (body || {}).openid;
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  await db.markMessageRead(Number(id), openid);
  return sendJson(res, 200, { code: 200, message: '已读' });
}

async function handleMarkAllRead(req, res, body) {
  const openid = (body || {}).openid;
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const n = await db.markAllMessagesRead(openid);
  return sendJson(res, 200, { code: 200, message: `已将 ${n} 条消息标记为已读`, cleared: n });
}

// ===== 静态资源（课程编辑网页 + 图片）=====
function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { code: 404, message: '资源不存在' });
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ===== 场次查询（学员端课程列表/详情）=====
async function handleSessionsByDate(req, res, date) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid') || null;
  const sessions = await db.listSessionsByDateForUser(date, openid);
  return sendJson(res, 200, { code: 200, date, sessions });
}

async function handleSessionDetail(req, res, id) {
  const s = await db.getSessionById(Number(id));
  if (!s) return sendJson(res, 404, { code: 404, message: '场次不存在' });
  // 携带 openid 时标记是否已订
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid') || null;
  let result = s;
  if (openid) {
    const booked = await driver.get("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'", [openid, s.id]);
    const waited = await driver.get("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ? AND status = 'waiting'", [openid, s.id]);
    result = { ...s, booked_by_me: !!booked, waitlisted_by_me: !!waited };
  }
  // 轮播图 JSON → 数组；已预约用户（预约墙头像+昵称）
  let images = [];
  try { images = JSON.parse(result.course_images || '[]'); } catch (e) { images = []; }
  const bookedUsers = await db.listBookedUsersWithInfo(result.id, openid);
  return sendJson(res, 200, { code: 200, session: { ...result, images, bookedUsers } });
}

async function toPublicUser(user) {
  let coach_id = null;
  if (user.role === 'coach') {
    // 教练账号 → 返回绑定的教练档案 id（DESIGN #D1 设教练后可能不是 1，前端工作台按 coach_id 加载）
    const c = await db.findCoachByOpenid(user.openid);
    coach_id = c ? c.id : null;
  }
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
    login_count: user.login_count,
    coach_id
  };
}

// ===== 服务器 =====


// ===== 路由表（批4：if-else 链 → 声明式路由） =====
// m: method ｜ p: 字符串精确路径 或 正则 ｜ f: handler(req, res, url)
const API_ROUTES = [
  { m: 'POST',   p: '/api/auth/login',          f: async(q, r) => await handleLogin(q, r) },
  // 2026-08-15: 登录态检查（已注册用户启动小程序免登录直达首页）
  { m: 'GET',    p: '/api/auth/check',          f: async(q, r, u) => {
      const openid = u.searchParams.get('openid');
      if (!openid) return sendJson(r, 400, { code: 400, message: '缺少 openid' });
      const user = await db.findUserByOpenid(openid);
      sendJson(r, 200, { code: 200, exists: !!user, user: user ? await toPublicUser(user) : null });
    } },
  { m: 'POST',   p: '/api/auth/profile',        f: async (q, r) => await handleProfile(q, r) },
  { m: 'GET',    p: '/api/users',               f: async(q, r) => await handleUsers(q, r) },
  { m: 'GET',    p: '/api/users/stats',         f: async(q, r) => await handleStats(q, r) },
  { m: 'DELETE', p: '/api/users',               f: async(q, r) => await handleDeleteUser(q, r) },
  { m: 'DELETE', p: '/api/users/clear',         f: async(q, r) => await handleClearUsers(q, r) },
  { m: 'POST',   p: '/api/bookings',            f: async (q, r) => await handleCreateBooking(q, r) },
  { m: 'GET',    p: '/api/bookings',            f: async(q, r) => await handleListBookings(q, r) },
  { m: 'DELETE', p: /^\/api\/bookings\//,    f: async(q, r) => await handleCancelBooking(q, r) },
  { m: 'POST',   p: /^\/api\/bookings\/\d+\/checkin$/, f: async (q, r) => await handleCheckin(q, r) },
  { m: 'POST',   p: '/api/checkin/by-code',       f: async (q, r) => await handleCheckinByCode(q, r) }, // 按码核销（BUGS-INBOX #11）
  { m: 'GET',    p: /^\/api\/checkin\/\d+$/, f: async(q, r) => await handleCheckinInfo(q, r) },
  { m: 'GET',    p: /^\/api\/sessions\/\d+\/students$/, f: async(q, r) => await handleSessionStudents(q, r) },
  { m: 'POST',   p: '/api/waitlist',            f: async (q, r) => await handleJoinWaitlist(q, r) },
  { m: 'GET',    p: '/api/waitlist',            f: async(q, r) => await handleListWaitlist(q, r) },
  { m: 'DELETE', p: /^\/api\/waitlist\//,    f: async(q, r) => await handleCancelWaitlist(q, r) },
  { m: 'POST',   p: '/api/orders',              f: async (q, r) => await handleCreateOrder(q, r) },
  { m: 'POST',   p: /^\/api\/orders\/\d+\/pay$/, f: async (q, r) => await handlePayOrder(q, r) },
  { m: 'GET',    p: '/api/orders',              f: async(q, r) => await handleListOrders(q, r) },
  { m: 'GET',    p: '/api/revenue',             f: async(q, r) => await handleRevenue(q, r) },
  { m: 'GET',    p: '/api/member/level',        f: async(q, r) => await handleMemberLevel(q, r) },
  { m: 'GET',    p: '/api/member/plans',        f: async(q, r) => await handleMemberPlans(q, r) },
  { m: 'GET',    p: '/api/member/config',       f: (q, r) => handleMemberConfig(q, r) },
  { m: 'GET',    p: '/api/member/recharges',    f: async(q, r) => await handleMemberRecharges(q, r) },
  { m: 'GET',    p: '/api/member/rewards',      f: async(q, r) => await handleMemberRewards(q, r) },
  { m: 'POST',   p: '/api/member/rewards/read', f: async (q, r) => await handleMemberRewardsRead(q, r) },
  { m: 'POST',   p: '/api/invite',              f: async (q, r) => await handleInvite(q, r) },
  { m: 'GET',    p: '/api/invite/stats',        f: async(q, r) => await handleInviteStats(q, r) },
  { m: 'GET',    p: '/api/invite/details',      f: async(q, r, u) => {
      const openid = u.searchParams.get('openid');
      if (!openid) return sendJson(r, 400, { code: 400, message: '缺少 openid' });
      sendJson(r, 200, { code: 200, details: await db.listInvitationDetails(openid) });
    } },
  { m: 'GET',    p: '/api/admin/invite-board',  f: async(q, r) => sendJson(r, 200, { code: 200, board: await db.inviteBoardStats() }) },
  // ===== 次卡包 =====
  { m: 'GET',    p: '/api/passes/packages',     f: async(q, r) => sendJson(r, 200, { code: 200, packages: await db.listPassPackages() }) },
  { m: 'GET',    p: '/api/achievements/sync',   f: async(q, r, u) => {
      const openid = u.searchParams.get('openid');
      if (!openid) return sendJson(r, 400, { code: 400, message: '缺少 openid' });
      sendJson(r, 200, { code: 200, ...await db.syncAchievements(openid), reward: db.REWARD_COINS });
    } },
  { m: 'GET',    p: '/api/passes/my',           f: async(q, r, u) => {
      const openid = u.searchParams.get('openid');
      if (!openid) return sendJson(r, 400, { code: 400, message: '缺少 openid' });
      sendJson(r, 200, { code: 200, pass: await db.getUserPassInfo(openid) });
    } },
  { m: 'GET',    p: '/api/passes/available',    f: async(q, r, u) => {
      const openid = u.searchParams.get('openid');
      if (!openid) return sendJson(r, 400, { code: 400, message: '缺少 openid' });
      // 2026-08-15: 支持按上课日期判断（date=YYYY-MM-DD，缺省退化为当前时刻判断）
      const date = u.searchParams.get('date') || null;
      const info = await db.getUserPassInfo(openid);
      const pass = date ? await db.getUserPassForDate(openid, date) : await db.getUserPass(openid);
      // 有卡但对该日期不可用（已彻底过期 / 卡覆盖不了上课日）→ 前端显示「次数包已过期」
      const expiredForDate = info.hasPass && !pass;
      sendJson(r, 200, { code: 200, available: pass ? pass.remaining : 0, expiredForDate, pass: info.hasPass ? info : null });
    } },
  { m: 'GET',    p: '/api/coin/balance',        f: async(q, r) => await handleCoinBalance(q, r) },
  { m: 'GET',    p: '/api/coin/logs',           f: async(q, r) => await handleCoinLogs(q, r) },
  { m: 'GET',    p: '/api/coin/shop',           f: async(q, r) => await handleCoinShop(q, r) },
  { m: 'GET',    p: '/api/coin/exchanges',      f: async(q, r) => await handleCoinExchanges(q, r) },
  { m: 'GET',    p: '/api/coin/config',         f: (q, r) => handleCoinConfig(q, r) },
  { m: 'POST',   p: '/api/coin/exchange',       f: async (q, r) => await handleCoinExchange(q, r) },
  { m: 'GET',    p: '/api/messages',            f: async(q, r) => await handleListMessages(q, r) },
  { m: 'GET',    p: '/api/messages/unread-count', f: async(q, r) => await handleUnreadCount(q, r) },
  { m: 'POST',   p: /^\/api\/messages\/\d+\/read$/, f: async (q, r, u) => {
      const id = u.pathname.split('/')[3];
      const body = await readBody(q);
      await handleMarkRead(q, r, id, body);
    } },
  { m: 'POST',   p: '/api/messages/read-all',   f: async (q, r) => {
      const body = await readBody(q);
      await handleMarkAllRead(q, r, body);
    } },
  { m: 'GET',    p: '/api/health',              f: (q, r) => sendJson(r, 200, { code: 200, status: 'ok', time: new Date().toISOString() }) },
  { m: 'GET',    p: '/api/meta',                f: async(q, r) => await handleMeta(q, r) },
  { m: 'GET',    p: '/api/courses',             f: async(q, r) => await handleListCourses(q, r) },
  { m: 'POST',   p: '/api/courses',             f: async (q, r) => {
      const body = await readBody(q);
      await handleCreateCourse(q, r, body);
    } },
  { m: 'PUT',    p: /^\/api\/courses\/\d+$/, f: async (q, r, u) => {
      const id = u.pathname.split('/')[3];
      const body = await readBody(q);
      await handleUpdateCourse(q, r, id, body);
    } },
  { m: 'DELETE', p: /^\/api\/courses\/\d+$/, f: async(q, r, u) => await handleDeleteCourse(q, r, u.pathname.split('/')[3]) },
  { m: 'POST',   p: /^\/api\/courses\/\d+\/publish$/, f: async (q, r, u) => {
      const id = u.pathname.split('/')[3];
      const body = await readBody(q);
      await handlePublishCourse(q, r, id, body);
    } },
  { m: 'PUT',    p: /^\/api\/courses\/\d+\/rules$/, f: async (q, r, u) => {
      const id = u.pathname.split('/')[3];
      const body = await readBody(q);
      await handleReplaceRules(q, r, id, body);
    } },
  { m: 'POST',   p: '/api/upload',              f: async (q, r) => {
      const body = await readBody(q);
      handleUpload(q, r, body);
    } },
  // 2026-08-15: 微信头像下载转存（thirdwx.qlogo.cn → /images/）
  { m: 'POST',   p: '/api/avatar-download',     f: async (q, r) => {
      const body = await readBody(q);
      handleAvatarDownload(q, r, body);
    } },
  { m: 'GET',    p: '/api/admin/sessions',      f: async(q, r) => await handleSessionsByRange(q, r) },
  { m: 'DELETE', p: /^\/api\/sessions\/\d+$/, f: async(q, r, u) => await handleCancelSession(q, r, u.pathname.split('/')[3]) },
  { m: 'PUT',    p: /^\/api\/sessions\/\d+$/, f: async (q, r, u) => {
      const id = u.pathname.split('/')[3];
      const body = await readBody(q);
      await handleUpdateSession(q, r, id, body);
    } },
  { m: 'GET',    p: '/api/sessions',            f: async(q, r, u) => {
      const date = u.searchParams.get('date');
      if (!date) return sendJson(r, 400, { code: 400, message: '缺少 date 参数（YYYY-MM-DD）' });
      await handleSessionsByDate(q, r, date);
    } },
  { m: 'GET',    p: '/api/coach/schedule',      f: async(q, r, u) => {
      const date = u.searchParams.get('date');
      const coachId = Number(u.searchParams.get('coach_id') || 0);
      if (!date || !coachId) return sendJson(r, 400, { code: 400, message: '缺少 date 或 coach_id 参数' });
      const sessions = await db.listSessionsByCoach(date, coachId);
      sendJson(r, 200, { code: 200, sessions });
    } },
  // 2026-08-15: 教练介绍页——详情（档案/生活照/认证/成绩）+ 指定日期范围课程
  { m: 'GET',    p: /^\/api\/coaches\/\d+$/,    f: async(q, r, u) => {
      const id = Number(u.pathname.split('/')[3]);
      const coach = await db.getCoachById(id);
      if (!coach) return sendJson(r, 404, { code: 404, message: '教练不存在' });
      let certs = [], achievements = [];
      try { certs = JSON.parse(coach.certs || '[]'); } catch (e) {}
      try { achievements = JSON.parse(coach.achievements || '[]'); } catch (e) {}
      sendJson(r, 200, { code: 200, coach: { ...coach, certs, achievements } });
    } },
  { m: 'GET',    p: /^\/api\/coaches\/\d+\/sessions$/, f: async(q, r, u) => {
      const id = Number(u.pathname.split('/')[3]);
      const from = u.searchParams.get('from');
      const to = u.searchParams.get('to');
      if (!from || !to) return sendJson(r, 400, { code: 400, message: '缺少 from/to 日期参数' });
      const sessions = await db.listSessionsByRange(from, to, 0, id);
      sendJson(r, 200, { code: 200, sessions });
    } },
  // ===== 教练工作台（DESIGN #D1）=====
  // 我的学员（已签到聚合）
  { m: 'GET',    p: '/api/coach/students',       f: async(q, r, u) => {
      const openid = u.searchParams.get('coach_openid') || '';
      if (!openid) return sendJson(r, 400, { code: 400, message: '缺少 coach_openid 参数' });
      const students = await db.listCoachStudents(openid);
      if (!students) return sendJson(r, 404, { code: 404, message: '教练档案不存在，请先设置教练档案' });
      sendJson(r, 200, { code: 200, students });
    } },
  // 学员跟课记录（教练查某学员全部签到课程）
  { m: 'GET',    p: '/api/coach/student-lessons', f: async(q, r, u) => {
      const coachOpenid = u.searchParams.get('coach_openid') || '';
      const studentOpenid = u.searchParams.get('student_openid') || '';
      if (!coachOpenid || !studentOpenid) return sendJson(r, 400, { code: 400, message: '缺少 coach_openid 或 student_openid 参数' });
      const lessons = await db.listStudentLessons(coachOpenid, studentOpenid);
      if (!lessons) return sendJson(r, 404, { code: 404, message: '教练档案不存在，请先设置教练档案' });
      sendJson(r, 200, { code: 200, lessons });
    } },
  // 学员笔记（仅本人）
  { m: 'GET',    p: '/api/coach/notes',          f: async(q, r, u) => {
      const coachOpenid = u.searchParams.get('coach_openid') || '';
      const studentOpenid = u.searchParams.get('student_openid') || '';
      if (!coachOpenid || !studentOpenid) return sendJson(r, 400, { code: 400, message: '缺少 coach_openid 或 student_openid 参数' });
      sendJson(r, 200, { code: 200, note: await db.getCoachNote(coachOpenid, studentOpenid) });
    } },
  { m: 'PUT',    p: '/api/coach/notes',          f: async (q, r, u) => {
      const body = await readBody(q);
      const { coach_openid: coachOpenid = '', student_openid: studentOpenid = '', content = '' } = body || {};
      if (!coachOpenid || !studentOpenid) return sendJson(r, 400, { code: 400, message: '缺少 coach_openid 或 student_openid' });
      if (typeof content !== 'string' || content.length > 500) return sendJson(r, 400, { code: 400, message: '笔记内容需为文本且不超过 500 字' });
      sendJson(r, 200, { code: 200, note: await db.upsertCoachNote(coachOpenid, studentOpenid, content) });
    } },
  // 月度结算（只读聚合）
  { m: 'GET',    p: '/api/coach/settlement',     f: async(q, r, u) => {
      const coachId = Number(u.searchParams.get('coach_id') || 0);
      const month = u.searchParams.get('month') || '';
      if (!coachId || !month) return sendJson(r, 400, { code: 400, message: '缺少 coach_id 或 month 参数（YYYY-MM）' });
      const s = await db.getCoachSettlement(coachId, month);
      if (!s) return sendJson(r, 400, { code: 400, message: 'month 格式应为 YYYY-MM' });
      sendJson(r, 200, { code: 200, settlement: s });
    } },
  // 管理后台设教练（web 管理「教练分配」页）
  { m: 'POST',   p: '/api/admin/coach-assign',   f: async (q, r, u) => {
      const body = await readBody(q);
      const { openid = '', coach_id: coachId = 0 } = body || {};
      if (!openid || !coachId) return sendJson(r, 400, { code: 400, message: '缺少 openid 或 coach_id' });
      const res = await db.assignCoach(openid, coachId);
      if (!res.ok) return sendJson(r, 400, { code: 400, message: res.error });
      await logOp('admin', 'coach_assign', { openid, coachId }, 'ok');
      sendJson(r, 200, { code: 200, ok: true });
    } },
  { m: 'GET',    p: '/api/admin/coaches',        f: async (q, r, u) => {
      // 教练档案列表（含绑定用户昵称）+ 全部用户（DESIGN #D2：用户管理语义，展示基本信息）——管理页一次拉全
      const [coaches, rawUsers] = await Promise.all([db.listCoachesWithBind(), db.listUsers()]);
      const users = rawUsers.map(u => ({
        openid: u.openid, nickname: u.nickname, avatar: u.avatar, role: u.role,
        created_at: u.created_at, last_login_at: u.last_login_at, login_count: u.login_count
      }));
      sendJson(r, 200, { code: 200, coaches, users });
    } },
  { m: 'POST',   p: '/api/admin/coach-unassign', f: async (q, r, u) => {
      const body = await readBody(q);
      const { coach_id: coachId = 0 } = body || {};
      if (!coachId) return sendJson(r, 400, { code: 400, message: '缺少 coach_id' });
      const res = await db.unassignCoach(coachId);
      if (!res.ok) return sendJson(r, 400, { code: 400, message: res.error });
      await logOp('admin', 'coach_unassign', { coachId }, 'ok');
      sendJson(r, 200, { code: 200, ok: true });
    } },
  // 用户级设/取消教练（DESIGN #D2：管理网页按用户勾选，登录按 role 分流；无档案自动建档）
  { m: 'POST',   p: '/api/admin/user-role',       f: async (q, r, u) => {
      const body = await readBody(q);
      const { openid = '', role = '' } = body || {};
      if (!openid || !role) return sendJson(r, 400, { code: 400, message: '缺少 openid 或 role' });
      const res = await db.setUserRole(openid, role);
      if (!res.ok) return sendJson(r, 400, { code: 400, message: res.error });
      await logOp('admin', 'user_role', { openid, role, coach_id: res.coach_id || null }, 'ok');
      sendJson(r, 200, { code: 200, ok: true, coach_id: res.coach_id || null });
    } },
  // 编辑教练档案（DESIGN #D2：名字/头像/技能/简介，前端教练详情与课程详情展示）
  { m: 'PUT',    p: /^\/api\/admin\/coaches\/\d+$/, f: async (q, r, u) => {
      const id = Number(u.pathname.split('/')[4]);
      const body = await readBody(q);
      const { name, avatar, skills, bio } = body || {};
      if (name === undefined && avatar === undefined && skills === undefined && bio === undefined) {
        return sendJson(r, 400, { code: 400, message: '没有可更新的字段' });
      }
      const res = await db.updateCoachProfile(id, { name, avatar, skills, bio });
      if (!res.ok) return sendJson(r, 400, { code: 400, message: res.error });
      await logOp('admin', 'coach_update', { coachId: id, name: name || null }, 'ok');
      sendJson(r, 200, { code: 200, ok: true });
    } },
  // 删除教练档案（web 管理页，2026-08-18：清理合并/误建残留空档案；有绑定/课程/模板的拒绝删除）
  { m: 'DELETE', p: /^\/api\/admin\/coaches\/\d+$/, f: async (q, r, u) => {
      const id = Number(u.pathname.split('/')[4]);
      const res = await db.deleteCoach(id);
      if (!res.ok) return sendJson(r, 400, { code: 400, message: res.error });
      await logOp('admin', 'coach_delete', { coachId: id }, 'ok');
      sendJson(r, 200, { code: 200, ok: true });
    } },
  { m: 'GET',    p: /^\/api\/sessions\/\d+$/, f: async(q, r, u) => await handleSessionDetail(q, r, u.pathname.split('/')[3]) }
];

// 教练简介种子：喻馥雅（课程详情页教练说明 placeholder；IIFE 包裹因 CJS 无顶层 await）
(async () => {
  try {
    await driver.run("UPDATE coaches SET bio = ? WHERE name = '喻馥雅' AND (bio IS NULL OR bio = '')", ['Hyrox个人精英运动员，40+引体达人，二娃妈妈，素人零基础']);
  } catch (e) {}
})();

// ===== 管理访问码（web 管理网页 ADMIN_TOKEN 保护，BUGS-INBOX #8） =====
// ADMIN_TOKEN 环境变量配置后，web 专属管理接口必须携带 Admin-Token header；
// 未配置（本地开发）不校验，行为不变。运行时读 env（测试可动态开关，见 coverage 探针）。
// 保护集合 = 小程序端不调用、仅管理网页使用的接口（课程写/场次写/运营读）：
// 共享接口（GET /api/users、POST /api/upload、GET /api/revenue、DELETE /api/users/clear
// 等被小程序 admin 页共用）不在此列，避免误伤小程序管理后台。
const ADMIN_PATHS = [
  { m: 'POST',   p: /^\/api\/courses(\/\d+)?(\/(publish|rules))?$/ },
  { m: 'PUT',    p: /^\/api\/courses\/\d+(\/rules)?$/ },
  { m: 'DELETE', p: /^\/api\/courses\/\d+$/ },
  { m: 'PUT',    p: /^\/api\/sessions\/\d+$/ },
  { m: 'DELETE', p: /^\/api\/sessions\/\d+$/ },
  { m: 'GET',    p: /^\/api\/admin\/(sessions|invite-board)$/ },
  { m: 'GET',    p: /^\/api\/admin\/coaches$/ },
  { m: 'PUT',    p: /^\/api\/admin\/coaches\/\d+$/ },
  { m: 'DELETE', p: /^\/api\/admin\/coaches\/\d+$/ },
  // 教练分配（BUGS-INBOX #14：065968e 遗漏——web 管理网页「教练分配」可被任何人调用，
  // 绕过访问码把任意用户设成教练提权；小程序 admin-students 页共用此接口，真机如需
  // 设教练请改走 web 管理网页（#8 架构方向：管理操作统一在 web，带 Admin-Token））
  { m: 'POST',   p: /^\/api\/admin\/(coach-assign|coach-unassign|user-role)$/ },
];
function isAdminPath(method, pathname) {
  return ADMIN_PATHS.some(x => x.m === method && x.p.test(pathname));
}

const server = http.createServer(async (req, res) => {
  try {
    // 数据库就绪门闩：MySQL 模式建表异步完成，就绪前请求等待（SQLite 已 resolve，零开销）
    // —— listen 已不阻塞 ready（云托管冷启动探针窗口极短），请求层兜底防打到空表
    await driver.ready;
    // 请求日志（真机联调排查用；正式环境可移除或按需开启）
    if (process.env.REQUEST_LOG === '1') {
      console.log(`[req] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
    }
    if (handleCors(req, res)) return;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ===== 路由分发（路由表） =====
    let matched = false;
    for (const route of API_ROUTES) {
      if (route.m !== req.method) continue;
      const hit = typeof route.p === 'string' ? pathname === route.p : route.p.test(pathname);
      if (hit) {
        // 管理访问码校验（ADMIN_TOKEN 配置时，管理网页接口强制校验）
        const adminToken = process.env.ADMIN_TOKEN || '';
        if (adminToken && isAdminPath(req.method, pathname)) {
          const token = req.headers['admin-token'];
          if (token !== adminToken) {
            await logOp('web', 'admin_access_denied', { pathname, ip: req.socket.remoteAddress }, 'fail');
            return sendJson(res, 401, { code: 401, message: '访问码错误' });
          }
        }
        matched = true; await route.f(req, res, url); break;
      }
    }
    if (matched) return;

    // 静态资源与页面（不分 method）
    if (pathname === '/' || pathname === '/courses.html') {
      serveStatic(res, path.join(__dirname, '..', 'web', 'courses.html'));
    } else if (pathname.startsWith('/web/')) {
      serveStatic(res, path.join(__dirname, '..', 'web', pathname.slice(5)));
    } else if (pathname.startsWith('/images/')) {
      const name = path.basename(pathname);
      serveStatic(res, path.join(__dirname, '..', 'miniprogram', 'images', name));
    } else if (pathname.startsWith('/video/')) {
      const name = path.basename(pathname);
      serveStatic(res, path.join(__dirname, 'video', name));
    } else if (pathname.startsWith('/uploads/')) {
      const name = path.basename(pathname);
      serveStatic(res, path.join(__dirname, 'uploads', name));
    } else {
      sendJson(res, 404, { code: 404, message: '接口不存在' });
    }
  } catch (e) {
    console.error('[server error]', e);
    sendJson(res, 500, { code: 500, message: '服务器内部错误: ' + e.message });
  }
});

// ===== 启动 =====
// 独立启动时监听端口；被 require（如测试/覆盖率）时不监听，导出供复用
// driver.ready 门闩（DESIGN #D2 S5）：MySQL 模式建表异步完成。listen 不阻塞 ready——
// 云托管冷启动探针窗口极短，先 listen 让探针尽早通过；请求处理器开头 await driver.ready
// 兜底（DB 就绪前请求自会等待），建表失败由 ready.catch 退出进程（防无表服务空转）
if (require.main === module) {
  server.listen(PORT, HOST, () => {
  // 启动时探测局域网 IP 并写入前端配置（IP 自动适配）
  const net = writeNetConfig();
  console.log('========================================');
  console.log('  综合训练馆订课系统 - 后端服务已启动');
  console.log(`  地址: http://127.0.0.1:${PORT}`);
  console.log(`  局域网: http://${net ? net.ip : '<未探测到>'}:${PORT}`);
  console.log(`  前端适配: ${net ? '已写入 miniprogram/utils/net-config.json（重新编译小程序生效）' : '回退 127.0.0.1'}`);
  console.log(`  数据库: server/data/gym.db`);
  console.log('========================================');

  // 消息中心：开课提醒定时任务（每 60 秒扫描未来 2 小时内开场的场次，通知已订学员）
  setInterval(async() => {
    try {
      const sessions = await db.listSessionsStartingSoon(2);
      for (const s of sessions) {
        const users = await db.listBookedUsersBySession(s.id);
        for (const oid of users) {
          await db.sendMessage({
            user_openid: oid, type: 'remind', title: '开课提醒',
            content: `${s.start_time}「${s.course_name}」即将开课，记得提前 15 分钟到场热身`,
            biz_type: 'course', biz_id: s.id, jump_url: '/pages/student-my-courses/index',
            dedup_key: `class_remind:${s.id}`
          });
        }
      }
    } catch (e) {
      console.error('[class reminder]', e.message);
    }
  }, 60 * 1000);

  // 次卡过期任务：标记过期卡 + 发过期通知（每 5 分钟；dedup_key 防重复通知）
  setInterval(async() => {
    try {
      const expired = await db.expireOverduePasses();
      if (expired > 0) {
        // 取刚过期的卡发通知（passes 表行级 dedup 用 messages dedup_key）
        const rows = await driver.all("SELECT user_openid, remaining, expires_at FROM user_passes WHERE status = 'expired' AND remaining > 0");
        for (const rw of rows) {
          await db.sendMessage({
            user_openid: rw.user_openid, type: 'pass', title: '次卡已过期',
            content: `次卡已于 ${rw.expires_at} 过期，剩余 ${rw.remaining} 次已作废`,
            biz_type: 'pass', biz_id: 0, jump_url: '/pages/member-level/index',
            dedup_key: `pass_expired:${rw.user_openid}`
          });
        }
      }
    } catch (e) {
      console.error('[pass expire]', e.message);
    }
  }, 5 * 60 * 1000);
  });
  // 建表就绪后进程内跑种子（幂等，已有数据跳过）。种子不再阻塞启动：
  // 旧架构 CMD `seed.js && index.js` 依赖 seed 进程显式退出（BUG-LEDGER #34），一旦挂起
  // index 永不启动、探针 refused、部署回滚；现在 listen 先行（探针窗口内即监听 3000），
  // seed 只是启动链路里的一个后续步骤，失败可查（CrashLoop）但不再拖死整个部署。
  driver.ready
    .then(() => { console.log('[启动] 数据库就绪（20 表建齐）'); return require('./seed').run(); })
    .then(() => console.log('[启动] 种子数据检查完成（幂等，已有数据跳过）'))
    .catch(e => { console.error('[启动] 数据库就绪/种子失败:', e); process.exit(1); });
} else {
  // 被测试/覆盖率脚本 require：导出服务与数据库供同进程调用
  module.exports = { server, PORT, db };
}
