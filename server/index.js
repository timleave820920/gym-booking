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
  const { code, openid, nickname, avatar, phone, role } = body;

  // 1. 优先用 code 调微信接口换真实 openid（真实微信身份）
  let finalOpenid = null;
  let wechatVerified = false;
  if (code) {
    const session = await code2Session(code);
    if (session.openid) {
      finalOpenid = session.openid;   // 真实微信 openid
      wechatVerified = true;
    } else {
      // 换取失败（errcode）或未配置 secret（空对象）→ 回退客户端 openid
      if (session.errcode) {
        console.warn('[wechat] code2session 失败:', session.errcode, session.errmsg);
      }
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
    phone: phone || '',
    role: role || 'student'
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

// ===== 签到（checkin）=====

// 签到凭证信息（GET /api/checkin/:id，学员二维码页）
function handleCheckinInfo(req, res) {
  const pathParts = req.url.split('/');
  const bookingId = parseInt(pathParts[pathParts.length - 1], 10);
  const info = db.getCheckinInfo(bookingId);
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
  const result = db.checkinBooking({ bookingId, coachOpenid: openid });
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
  }
  return sendJson(res, 200, { code: 200, message: '签到成功', booking: result.booking });
}

// 按场次查订课名单（GET /api/sessions/:id/students，教练端）
function handleSessionStudents(req, res) {
  const pathParts = req.url.split('/');
  const sessionId = parseInt(pathParts[pathParts.length - 2], 10);
  const students = db.listBookingsBySession(sessionId);
  const checked = students.filter(s => s.checkin_at).length;
  return sendJson(res, 200, { code: 200, students, checked, total: students.length });
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

// ===== 会员体系（member）=====

// 会员等级信息（GET /api/member/level?openid=xxx）
function handleMemberLevel(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const level = db.getMemberLevel(openid);
  if (!level) return sendJson(res, 404, { code: 404, message: '用户不存在' });
  return sendJson(res, 200, { code: 200, level });
}

// 充值套餐（GET /api/member/plans?openid=xxx，带 openid 时按用户首充状态计算赠送）
function handleMemberPlans(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const plans = db.RECHARGE_PLANS.map(p => {
    // 每档首充送 30% / 复充送 10%（配置在 member-config.js）
    const { bonus, isFirst } = openid
      ? db.calcRechargeBonus(openid, p.amount)
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
  });
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
function handleMemberRecharges(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  // 分页参数（默认最近 10 笔）
  const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
  const limit = parseInt(url.searchParams.get('limit') || '10', 10) || 10;
  const recharges = db.listRecharges(openid, offset, limit);
  return sendJson(res, 200, { code: 200, recharges, hasMore: recharges.length >= limit });
}

// 邀请绑定（POST /api/invite）
async function handleInvite(req, res) {
  const body = await readBody(req);
  const { inviter, invitee } = body;
  if (!inviter || !invitee) return sendJson(res, 400, { code: 400, message: '缺少 inviter 或 invitee' });
  const result = db.bindInvitation({ inviter, invitee });
  if (!result.ok) return sendJson(res, 400, { code: 400, message: result.error });
  return sendJson(res, 200, { code: 200, message: '邀请关系已建立' });
}

// 邀请战绩（GET /api/invite/stats?openid=xxx）
function handleInviteStats(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const stats = db.getInviteStats(openid);
  return sendJson(res, 200, { code: 200, ...stats });
}

// 未读储值奖励（GET /api/member/rewards?openid=xxx，登录庆祝用）
function handleMemberRewards(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const rewards = db.listUnreadBalanceLogs(openid);
  return sendJson(res, 200, { code: 200, rewards });
}

// 标记奖励已读（POST /api/member/rewards/read）
async function handleMemberRewardsRead(req, res) {
  const body = await readBody(req);
  const { openid } = body;
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  db.markBalanceLogsRead(openid);
  return sendJson(res, 200, { code: 200, message: '已标记' });
}

// ===== 能量币（coin）=====

// 余额 + 今日获取（GET /api/coin/balance?openid=xxx）
function handleCoinBalance(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const info = db.getCoinInfo(openid);
  if (!info) return sendJson(res, 404, { code: 404, message: '用户不存在' });
  return sendJson(res, 200, { code: 200, ...info });
}

// 流水（GET /api/coin/logs?openid=xxx）
function handleCoinLogs(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const logs = db.listCoinLogs(openid);
  return sendJson(res, 200, { code: 200, logs });
}

// 商店奖品（GET /api/coin/shop?openid=xxx）
function handleCoinShop(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid') || '';
  const items = db.listShopItems(openid);
  return sendJson(res, 200, { code: 200, items });
}

// 兑换奖品（POST /api/coin/exchange）
async function handleCoinExchange(req, res) {
  const body = await readBody(req);
  const { openid, itemId } = body;
  if (!openid || !itemId) return sendJson(res, 400, { code: 400, message: '缺少 openid 或 itemId' });
  const result = db.exchangeCoinItem({ openid, itemId });
  if (!result.ok) return sendJson(res, 400, { code: 400, message: result.error });
  return sendJson(res, 200, { code: 200, message: '兑换成功', exchange: result.exchange });
}

// 我的兑换记录（GET /api/coin/exchanges?openid=xxx）
function handleCoinExchanges(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  const exchanges = db.listMyExchanges(openid);
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
  const { openid, sessionId, amountFen, orderType } = body;
  // 充值订单无场次（sessionId 可省略或为 0）
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  if (orderType !== 'recharge' && !sessionId) {
    return sendJson(res, 400, { code: 400, message: '缺少 sessionId' });
  }
  const result = db.createOrder({
    user_openid: openid,
    session_id: sessionId,
    amount_fen: amountFen || 0,
    order_type: orderType || 'book'
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
  const result = db.payOrder({
    openid,
    orderId,
    pay_method: payMethod || 'balance'
  });
  if (!result.ok) {
    return sendJson(res, 400, { code: 400, message: result.error });
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
function handleListOrders(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const openid = url.searchParams.get('openid');
  const status = url.searchParams.get('status') || undefined;
  if (!openid) {
    return sendJson(res, 400, { code: 400, message: '缺少 openid' });
  }
  const orders = db.listOrdersByUser(openid, status);
  return sendJson(res, 200, { code: 200, orders });
}

// 营收统计（GET /api/revenue，管理后台）
function handleRevenue(req, res) {
  const stats = db.getRevenueStats();
  return sendJson(res, 200, { code: 200, ...stats });
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

// ===== 图片上传（课程封面等，存到 miniprogram/images/）=====
function handleUpload(req, res, body) {
  const { name, data } = body || {};
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
  const imgDir = path.join(__dirname, '..', 'miniprogram', 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, fileName), buf);
  return sendJson(res, 200, { code: 200, path: `/images/${fileName}`, message: '上传成功' });
}

// ===== 排表管理：范围场次 / 取消 / 改容量 / 规则替换 =====
function handleSessionsByRange(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const courseId = url.searchParams.get('course_id') ? Number(url.searchParams.get('course_id')) : 0;
  if (!from || !to) return sendJson(res, 400, { code: 400, message: '缺少 from/to 日期参数' });
  const sessions = db.listSessionsByRange(from, to, courseId || null);
  return sendJson(res, 200, { code: 200, sessions });
}

function handleCancelSession(req, res, id) {
  const result = db.cancelSession(Number(id));
  if (!result.ok) return sendJson(res, 400, { code: 400, message: result.error });
  return sendJson(res, 200, { code: 200, message: '场次已取消' });
}

function handleUpdateSession(req, res, id, body) {
  const result = db.updateSessionCapacity(Number(id), body.capacity);
  if (!result.ok) return sendJson(res, 400, { code: 400, message: result.error });
  return sendJson(res, 200, { code: 200, message: '容量已更新' });
}

function handleReplaceRules(req, res, id, body) {
  const course = db.listCourses().find(c => c.id === Number(id));
  if (!course) return sendJson(res, 404, { code: 404, message: '课程不存在' });
  db.replaceRules(Number(id), body.rules || []);
  return sendJson(res, 200, { code: 200, message: '排课规则已保存' });
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
    } else if (req.method === 'POST' && /^\/api\/bookings\/\d+\/checkin$/.test(pathname)) {
      await handleCheckin(req, res);
    } else if (req.method === 'GET' && /^\/api\/checkin\/\d+$/.test(pathname)) {
      handleCheckinInfo(req, res);
    } else if (req.method === 'GET' && /^\/api\/sessions\/\d+\/students$/.test(pathname)) {
      handleSessionStudents(req, res);
    } else if (req.method === 'POST' && pathname === '/api/waitlist') {
      await handleJoinWaitlist(req, res);
    } else if (req.method === 'GET' && pathname === '/api/waitlist') {
      handleListWaitlist(req, res);
    } else if (req.method === 'DELETE' && pathname.startsWith('/api/waitlist/')) {
      handleCancelWaitlist(req, res);
    } else if (req.method === 'POST' && pathname === '/api/orders') {
      await handleCreateOrder(req, res);
    } else if (req.method === 'POST' && /^\/api\/orders\/\d+\/pay$/.test(pathname)) {
      await handlePayOrder(req, res);
    } else if (req.method === 'GET' && pathname === '/api/orders') {
      handleListOrders(req, res);
    } else if (req.method === 'GET' && pathname === '/api/revenue') {
      handleRevenue(req, res);
    } else if (req.method === 'GET' && pathname === '/api/member/level') {
      handleMemberLevel(req, res);
    } else if (req.method === 'GET' && pathname === '/api/member/plans') {
      handleMemberPlans(req, res);
    } else if (req.method === 'GET' && pathname === '/api/member/config') {
      handleMemberConfig(req, res);
    } else if (req.method === 'GET' && pathname === '/api/member/recharges') {
      handleMemberRecharges(req, res);
    } else if (req.method === 'GET' && pathname === '/api/member/rewards') {
      handleMemberRewards(req, res);
    } else if (req.method === 'POST' && pathname === '/api/member/rewards/read') {
      await handleMemberRewardsRead(req, res);
    } else if (req.method === 'POST' && pathname === '/api/invite') {
      await handleInvite(req, res);
    } else if (req.method === 'GET' && pathname === '/api/invite/stats') {
      handleInviteStats(req, res);
    } else if (req.method === 'GET' && pathname === '/api/coin/balance') {
      handleCoinBalance(req, res);
    } else if (req.method === 'GET' && pathname === '/api/coin/logs') {
      handleCoinLogs(req, res);
    } else if (req.method === 'GET' && pathname === '/api/coin/shop') {
      handleCoinShop(req, res);
    } else if (req.method === 'GET' && pathname === '/api/coin/exchanges') {
      handleCoinExchanges(req, res);
    } else if (req.method === 'GET' && pathname === '/api/coin/config') {
      handleCoinConfig(req, res);
    } else if (req.method === 'POST' && pathname === '/api/coin/exchange') {
      await handleCoinExchange(req, res);
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
    } else if (req.method === 'PUT' && /^\/api\/courses\/\d+\/rules$/.test(pathname)) {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      handleReplaceRules(req, res, id, body);
    } else if (req.method === 'POST' && pathname === '/api/upload') {
      const body = await readBody(req);
      handleUpload(req, res, body);
    } else if (req.method === 'GET' && pathname === '/api/admin/sessions') {
      handleSessionsByRange(req, res);
    } else if (req.method === 'DELETE' && /^\/api\/sessions\/\d+$/.test(pathname)) {
      handleCancelSession(req, res, pathname.split('/')[3]);
    } else if (req.method === 'PUT' && /^\/api\/sessions\/\d+$/.test(pathname)) {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      handleUpdateSession(req, res, id, body);
    } else if (req.method === 'GET' && pathname === '/api/sessions') {
      const date = url.searchParams.get('date');
      if (!date) {
        return sendJson(res, 400, { code: 400, message: '缺少 date 参数（YYYY-MM-DD）' });
      }
      handleSessionsByDate(req, res, date);
    } else if (req.method === 'GET' && pathname === '/api/coach/schedule') {
      const date = url.searchParams.get('date');
      const coachId = Number(url.searchParams.get('coach_id') || 0);
      if (!date || !coachId) {
        return sendJson(res, 400, { code: 400, message: '缺少 date 或 coach_id 参数' });
      }
      const sessions = db.listSessionsByCoach(date, coachId);
      sendJson(res, 200, { code: 200, sessions });
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
  // 启动时探测局域网 IP 并写入前端配置（IP 自动适配）
  const net = writeNetConfig();
  console.log('========================================');
  console.log('  综合训练馆订课系统 - 后端服务已启动');
  console.log(`  地址: http://127.0.0.1:${PORT}`);
  console.log(`  局域网: http://${net ? net.ip : '<未探测到>'}:${PORT}`);
  console.log(`  前端适配: ${net ? '已写入 miniprogram/utils/net-config.json（重新编译小程序生效）' : '回退 127.0.0.1'}`);
  console.log(`  数据库: server/data/gym.db`);
  console.log('========================================');
});
