/**
 * API 请求封装
 * 综合训练馆订课系统
 *
 * 2026-08-18 P0 清理：移除 USE_CLOUD 云函数双分支（USE_CLOUD 恒为 false，
 * 云函数代码从未执行）。所有请求走 localRequest → 云托管 callContainer（USE_TCB=true）。
 * cloudfunctions/ 目录已归档，不再部署。
 *
 * 本地后端地址说明：
 * - 模拟器可用 127.0.0.1；真机预览必须用电脑局域网 IP（同 WiFi）
 * - IP 自动适配：后端启动时探测本机 IP 并写入 net-config.json（gitignore），
 *   本文件运行时读取；未生成时回退到 127.0.0.1。手动启动后端同样生效。
 */
// 云托管模式（2026-08-15 部署）—— 唯一请求通道
// true  = 用 wx.cloud.callContainer 直连云托管（微信私有协议，无需配置 request 合法域名/无需备案）
const USE_TCB = true;
const TCB_ENV = 'prod-d0g3mnc4m283b5b36'; // 云托管环境 ID（用户控制台显示）
const TCB_SERVICE = 'gym-server';         // 云托管容器服务名（callContainer 必填）
// 云托管公网域名（图片等静态资源用；callContainer 走私有协议，但 <image> 加载需要公网 URL）
const TCB_BASE_URL = 'https://gym-server-297498-11-1469244356.sh.run.tcloudbase.com';

// 相对路径 → 完整 URL（头像/封面等后端转存到 /images/ 的资源）
// 云托管模式：容器内文件需通过公网域名 HTTP 访问；本地模式：直接用包内相对路径
function toFullUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//.test(p)) return p;         // 已是完整 URL
  if (USE_TCB) return TCB_BASE_URL + p;          // 云托管：拼公网域名
  return p;                                       // 本地：包内相对路径直接显示
}

// ===== 云托管请求（callContainer 走微信私有协议） =====
function localRequest(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: TCB_ENV },
      service: TCB_SERVICE,
      path,
      method,
      data,
      success: (res) => {
        const status = res.statusCode || 200;
        if (status >= 200 && status < 300) {
          resolve(res.data);
        } else {
          reject({ code: status, message: (res.data && res.data.message) || '请求失败' });
        }
      },
      fail: (err) => {
        console.error('[api][tcb] 请求失败', path, JSON.stringify(err));
        reject({ code: -1, message: '无法连接云端服务，请稍后重试' });
      }
    });
  });
}

module.exports = {
  USE_TCB,
  TCB_ENV,
  TCB_SERVICE,
  TCB_BASE_URL,
  toFullUrl,

  // 注册/登录（首次=注册，再次=登录）
  login(data) {
    return localRequest('/api/auth/login', 'POST', data);
  },

  // 手机号授权 code → 真实手机号（2026-08-18 B1 合规；企业认证后生效，未认证返回 400 明确报错）
  phoneLogin(code) {
    return localRequest('/api/auth/phone-login', 'POST', { code });
  },

  // 2026-08-15: 登录态检查（已注册用户启动直达首页，免登录页）
  checkLogin(openid) {
    return localRequest('/api/auth/check?openid=' + openid, 'GET');
  },

  // 更新用户资料
  updateProfile(data) {
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

  // 下拉元数据（课程/教练/场地/分类等，管理后台用）
  getMeta() {
    return localRequest('/api/meta', 'GET');
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
    return localRequest('/api/users', 'GET');
  },

  // 用户统计（传 openid 返回真实锻炼数据）
  getUsersStats(openid) {
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
    let qs = 'date=' + date;
    if (openid) qs += '&openid=' + openid;
    return localRequest('/api/sessions?' + qs, 'GET');
  },

  // 教练端今日课表（按日期 + 教练）
  getCoachSchedule(date, coachId) {
    return localRequest('/api/coach/schedule?date=' + date + '&coach_id=' + coachId, 'GET');
  },

  // 场次详情（学员端课程详情；传 openid 可标记已预订）
  getSession(id, openid) {
    let qs = '';
    if (openid) qs = '?openid=' + openid;
    return localRequest('/api/sessions/' + id + qs, 'GET');
  },

  // 订课（支付成功后调用）
  bookCourse(data) {
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

  // 微信支付开通状态（未配置商户号 → { enabled: false }，前端禁用微信支付选项）
  wxpayStatus() {
    return localRequest('/api/wxpay/status', 'GET');
  },

  // 微信统一下单（B2：返回 wx.requestPayment 所需参数 payParams）
  wxpayCreate(data) {
    return localRequest('/api/wxpay/create', 'POST', data);
  },

  // 测试支付模式（PAY_MOCK=1）：mock 回调落库，等价微信支付成功
  wxpayMockNotify(data) {
    return localRequest('/api/wxpay/mock-notify', 'POST', data);
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

  // 教练核销签到（按订课 ID，兼容入口）
  checkin(bookingId, openid) {
    return localRequest('/api/bookings/' + bookingId + '/checkin', 'POST', { openid });
  },

  // 教练按签到码核销（随机 5 位纯数字，BUGS-INBOX #11）
  checkinByCode(code, openid) {
    return localRequest('/api/checkin/by-code', 'POST', { code, openid });
  },

  // 按场次查订课名单（教练端）
  getSessionStudents(sessionId) {
    return localRequest('/api/sessions/' + sessionId + '/students', 'GET');
  },

  // ===== 教练工作台（DESIGN #D1）=====
  // 我的学员（已签到聚合）
  getCoachStudents(coachOpenid) {
    return localRequest('/api/coach/students?coach_openid=' + encodeURIComponent(coachOpenid), 'GET');
  },
  // 学员跟课记录
  getCoachStudentLessons(coachOpenid, studentOpenid) {
    return localRequest('/api/coach/student-lessons?coach_openid=' + encodeURIComponent(coachOpenid) + '&student_openid=' + encodeURIComponent(studentOpenid), 'GET');
  },
  // 学员笔记（读）
  getCoachNote(coachOpenid, studentOpenid) {
    return localRequest('/api/coach/notes?coach_openid=' + encodeURIComponent(coachOpenid) + '&student_openid=' + encodeURIComponent(studentOpenid), 'GET');
  },
  // 学员笔记（写，upsert）
  saveCoachNote(coachOpenid, studentOpenid, content) {
    return localRequest('/api/coach/notes', 'PUT', { coach_openid: coachOpenid, student_openid: studentOpenid, content });
  },
  // 月度结算
  getCoachSettlement(coachId, month) {
    return localRequest('/api/coach/settlement?coach_id=' + coachId + '&month=' + month, 'GET');
  },
  // 管理后台设教练
  coachAssign(openid, coachId) {
    return localRequest('/api/admin/coach-assign', 'POST', { openid, coach_id: coachId });
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

  // ===== 季卡/年卡（无限次卡，DESIGN #D14）=====
  getUnlimitedPlans() {
    return localRequest('/api/unlimited/plans', 'GET');
  },
  getUnlimitedPass(openid) {
    return localRequest('/api/unlimited/my?openid=' + openid, 'GET');
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
  },

  // ===== 浏览埋点（DESIGN #D5）=====
  // 批量上报用户行为事件（track.js 攒批调用；白名单外事件服务端静默丢弃）
  trackBatch(data) {
    return localRequest('/api/track/batch', 'POST', data);
  },

  // ===== 社交画像（DESIGN #D5-3）：性别/生日自填，首次送 20 能量币 =====
  getMyProfile(openid) {
    return localRequest('/api/me/profile?openid=' + openid, 'GET');
  },
  updateMyProfile(data) {
    return localRequest('/api/me/profile', 'PUT', data);
  },

  // ===== 吐槽反馈（DESIGN #D9）：留言场馆 + 我的吐槽历史 =====
  createFeedback(data) {
    return localRequest('/api/feedback', 'POST', data);
  },
  getMyFeedbacks(openid, page = 1) {
    return localRequest(`/api/my-feedbacks?openid=${openid}&page=${page}`, 'GET');
  }
};
