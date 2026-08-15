/**
 * API 请求封装（双模式）
 * 综合训练馆订课系统
 *
 * 模式切换（USE_CLOUD）：
 *   true  = 微信云开发（生产环境，登录拿真实 openid）
 *   false = 本地后端（开发调试，server/index.js）
 *
 * 使用云开发时：
 *   1. 微信开发者工具 → 云开发 → 开通环境
 *   2. 云数据库中创建集合：users
 *   3. 右键 cloudfunctions/login、cloudfunctions/users → 「上传并部署：云端安装依赖」
 *   4. 将 USE_CLOUD 设为 true
 *   5. app.js 中 wx.cloud.init({ env: '你的环境ID' })
 *
 * 当前状态：本地模式（等正式小程序注册 + 工商主体后切云开发）
 *
 * 本地后端地址说明：
 * - 模拟器可用 127.0.0.1；真机预览必须用电脑局域网 IP（同 WiFi）
 * - IP 自动适配：后端启动时探测本机 IP 并写入 net-config.json（gitignore），
 *   本文件运行时读取；未生成时回退到 127.0.0.1。手动启动后端同样生效。
 */
const USE_CLOUD = false;

const CLOUD_ENV = 'gym-prod-timleave001'; // 云环境 ID（注册正式小程序后启用）

// 2026-08-14 21:35 重大修正：废弃 net-config.json 自动适配作为前端地址源。
// 原因：net-config.json 是后端启动时自动写入的运行时产物，并行后端实例
// （PORT/IP 各不相同）会互相覆盖——实测被 192.168.101.7:3536 覆盖后，
// 前端优先读到错误地址，真机登录报"本地服务器没有启动"。
// 现在地址唯一来源 = FALLBACK_BASE_URL（人工配置，见下）。

// 本地后端地址（USE_CLOUD=false 时使用）—— 唯一配置源，改这里 + 重新编译即可
// 局域网模式：http://<电脑局域网IP>:3000（换网络/IP 变了就改这里）
// 公网穿透模式：cpolar/ngrok 等隧道 URL（隧道重启域名会变，也要同步改这里）
// 2026-08-15 18:22: 临时随机隧道（固定域名待 cpolar 客服处理），URL=4dc65872.r22.cpolar.top
const FALLBACK_BASE_URL = 'https://4dc65872.r22.cpolar.top';
const LOCAL_BASE_URL = FALLBACK_BASE_URL;

// ===== 本地后端请求 =====
function localRequest(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: LOCAL_BASE_URL + path,
      method,
      data,
      timeout: 10000,
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject({ code: res.statusCode, message: (res.data && res.data.message) || '请求失败' });
        }
      },
      fail: (err) => {
        // 打印真实失败原因（真机调试排查用：域名校验/超时/网络栈）
        console.error('[api] 请求失败', LOCAL_BASE_URL + path, JSON.stringify(err));
        reject({ code: -1, message: '无法连接本地后端，请确认 server 已启动' });
      }
    });
  });
}

// ===== 云开发请求 =====
function cloudCall(name, data = {}) {
  return wx.cloud.callFunction({ name, data }).then(res => res.result);
}

// 确保云开发已初始化
function ensureCloud() {
  if (!wx.cloud) {
    throw new Error('当前基础库不支持云开发，请升级');
  }
  const app = getApp();
  if (!app.globalData.cloudInited) {
    wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
    app.globalData.cloudInited = true;
  }
}

module.exports = {
  USE_CLOUD,
  CLOUD_ENV,
  LOCAL_BASE_URL,

  // 注册/登录（首次=注册，再次=登录）
  login(data) {
    if (USE_CLOUD) {
      ensureCloud();
      return cloudCall('login', data);
    }
    return localRequest('/api/auth/login', 'POST', data);
  },

  // 2026-08-15: 登录态检查（已注册用户启动直达首页，免登录页）
  checkLogin(openid) {
    return localRequest('/api/auth/check?openid=' + openid, 'GET');
  },

  // 更新用户资料
  updateProfile(data) {
    if (USE_CLOUD) {
      ensureCloud();
      return cloudCall('login', { action: 'updateProfile', ...data });
    }
    return localRequest('/api/auth/profile', 'POST', data);
  },

  // 图片上传（base64，返回 /images/xxx 路径；用于头像/封面等）
  uploadImage(name, base64Data) {
    return localRequest('/api/upload', 'POST', { name, data: base64Data });
  },

  // 2026-08-15: 微信头像下载转存（thirdwx.qlogo.cn URL → /images/ 本地文件，避免合法域名校验失败回退默认头像）
  avatarDownload(url) {
    return localRequest('/api/avatar-download', 'POST', { url });
  },

  // 2026-08-15: 教练介绍页
  getCoachProfile(coachId) {
    return localRequest('/api/coaches/' + coachId, 'GET');
  },
  getCoachSessions(coachId, from, to) {
    return localRequest(`/api/coaches/${coachId}/sessions?from=${from}&to=${to}`, 'GET');
  },

  // 用户列表（后台用）
  getUsers() {
    if (USE_CLOUD) {
      ensureCloud();
      return cloudCall('users', { action: 'list' });
    }
    return localRequest('/api/users', 'GET');
  },

  // 用户统计（传 openid 返回真实锻炼数据）
  getUsersStats(openid) {
    if (USE_CLOUD) {
      ensureCloud();
      return cloudCall('users', { action: 'stats' });
    }
    let qs = '';
    if (openid) qs = '?openid=' + openid;
    return localRequest('/api/users/stats' + qs, 'GET');
  },

  // 删除单个用户（本地后端）
  deleteUser(params) {
    return localRequest('/api/users?' + Object.keys(params).map(k => k + '=' + params[k]).join('&'), 'DELETE');
  },

  // 清空所有用户（本地后端）
  clearUsers() {
    return localRequest('/api/users/clear', 'DELETE');
  },

  // 按日期查场次（学员端课程列表；传 openid 可标记已预订）
  getSessionsByDate(date, openid) {
    if (USE_CLOUD) return Promise.reject({ code: -1, message: '云函数暂未实现课程列表' });
    let qs = 'date=' + date;
    if (openid) qs += '&openid=' + openid;
    return localRequest('/api/sessions?' + qs, 'GET');
  },

  // 教练端今日课表（按日期 + 教练）
  getCoachSchedule(date, coachId) {
    if (USE_CLOUD) return Promise.reject({ code: -1, message: '云函数暂未实现教练课表' });
    return localRequest('/api/coach/schedule?date=' + date + '&coach_id=' + coachId, 'GET');
  },

  // 场次详情（学员端课程详情；传 openid 可标记已预订）
  getSession(id, openid) {
    if (USE_CLOUD) return Promise.reject({ code: -1, message: '云函数暂未实现场次详情' });
    let qs = '';
    if (openid) qs = '?openid=' + openid;
    return localRequest('/api/sessions/' + id + qs, 'GET');
  },

  // 订课（支付成功后调用）
  bookCourse(data) {
    if (USE_CLOUD) return Promise.reject({ code: -1, message: '云函数暂未实现订课' });
    return localRequest('/api/bookings', 'POST', data);
  },

  // 查询我的订课（本地后端）
  getMyBookings(openid, status) {
    let qs = 'openid=' + openid;
    if (status) qs += '&status=' + status;
    return localRequest('/api/bookings?' + qs, 'GET');
  },

  // 退订
  cancelBooking(openid, bookingId) {
    return localRequest('/api/bookings/' + bookingId + '?openid=' + openid, 'DELETE');
  },

  // 候补排位（满员课付费排队）
  joinWaitlist(data) {
    return localRequest('/api/waitlist', 'POST', data);
  },
  // 查询我的候补（附带过期退款任务）
  getMyWaitlist(openid) {
    return localRequest('/api/waitlist?openid=' + openid, 'GET');
  },

  // 退出候补（退款）
  cancelWaitlist(openid, waitId) {
    return localRequest('/api/waitlist/' + waitId + '?openid=' + openid, 'DELETE');
  },

  // 下单（创建待支付订单；orderType: book 订课 / waitlist 候补排位）
  createOrder(data) {
    return localRequest('/api/orders', 'POST', data);
  },

  // 支付回写（模拟支付成功后调用）
  payOrder(orderId, data) {
    return localRequest('/api/orders/' + orderId + '/pay', 'POST', data);
  },

  // 查询我的订单
  getMyOrders(openid, status) {
    let qs = 'openid=' + openid;
    if (status) qs += '&status=' + status;
    return localRequest('/api/orders?' + qs, 'GET');
  },

  // 营收统计（管理后台）
  getRevenueStats() {
    return localRequest('/api/revenue', 'GET');
  },

  // 签到凭证信息（学员二维码页）
  getCheckinInfo(bookingId) {
    return localRequest('/api/checkin/' + bookingId, 'GET');
  },

  // 教练核销签到
  checkin(bookingId, openid) {
    return localRequest('/api/bookings/' + bookingId + '/checkin', 'POST', { openid });
  },

  // 按场次查订课名单（教练端）
  getSessionStudents(sessionId) {
    return localRequest('/api/sessions/' + sessionId + '/students', 'GET');
  },

  // ===== 消息中心（站内信）=====
  getMessages(openid, page) {
    return localRequest('/api/messages?openid=' + openid + '&page=' + (page || 1), 'GET');
  },
  getUnreadCount(openid) {
    return localRequest('/api/messages/unread-count?openid=' + openid, 'GET');
  },
  markMessageRead(id, openid) {
    return localRequest('/api/messages/' + id + '/read', 'POST', { openid });
  },
  markAllMessagesRead(openid) {
    return localRequest('/api/messages/read-all', 'POST', { openid });
  },

  // ===== 会员体系 =====
  getMemberLevel(openid) {
    return localRequest('/api/member/level?openid=' + openid, 'GET');
  },
  getMemberPlans(openid) {
    // 带 openid：后端按该用户首充/复充状态返回赠送比例（回归 BUG-LEDGER #8：此前漏拼 openid，展示全为首充 30%）
    const q = openid ? '?openid=' + encodeURIComponent(openid) : '';
    return localRequest('/api/member/plans' + q, 'GET');
  },
  getMemberConfig() {
    return localRequest('/api/member/config', 'GET');
  },
  getMyRecharges(openid, offset = 0, limit = 10) {
    return localRequest('/api/member/recharges?openid=' + openid + '&offset=' + offset + '&limit=' + limit, 'GET');
  },
  getInviteStats(openid) {
    return localRequest('/api/invite/stats?openid=' + openid, 'GET');
  },
  // ===== 次卡包 =====
  getPassPackages() {
    return localRequest('/api/passes/packages', 'GET');
  },
  getMyPass(openid) {
    return localRequest('/api/passes/my?openid=' + openid, 'GET');
  },
  getPassAvailable(openid, date) {
    // date=上课日期(YYYY-MM-DD)：按日期判断次卡是否覆盖上课日（2026-08-15）
    const q = date ? '&date=' + encodeURIComponent(date) : '';
    return localRequest('/api/passes/available?openid=' + openid + q, 'GET');
  },

  // 成就同步：检测新解锁成就并发 50 能量币（幂等）
  syncAchievements(openid) {
    return localRequest('/api/achievements/sync?openid=' + openid, 'GET');
  },

  bindInvite(data) {
    return localRequest('/api/invite', 'POST', data);
  },
  getMyRewards(openid) {
    return localRequest('/api/member/rewards?openid=' + openid, 'GET');
  },
  markRewardsRead(openid) {
    return localRequest('/api/member/rewards/read', 'POST', { openid });
  },

  // ===== 能量币 =====
  getCoinBalance(openid) {
    return localRequest('/api/coin/balance?openid=' + openid, 'GET');
  },
  getCoinLogs(openid) {
    return localRequest('/api/coin/logs?openid=' + openid, 'GET');
  },
  getCoinShop(openid) {
    return localRequest('/api/coin/shop?openid=' + (openid || ''), 'GET');
  },
  getCoinConfig() {
    return localRequest('/api/coin/config', 'GET');
  },
  exchangeCoin(openid, itemId) {
    return localRequest('/api/coin/exchange', 'POST', { openid, itemId });
  },
  getMyExchanges(openid) {
    return localRequest('/api/coin/exchanges?openid=' + openid, 'GET');
  }
};
