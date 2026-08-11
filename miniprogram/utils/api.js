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
 * - 若 IP 变化，可用 ipconfig 查询后更新
 */
const USE_CLOUD = false;

const CLOUD_ENV = 'gym-prod-timleave001'; // 云环境 ID（注册正式小程序后启用）

// 本地后端地址（USE_CLOUD=false 时使用）
// 真机预览需用电脑局域网 IP；电脑 IP 变了改这里
const LOCAL_BASE_URL = 'http://192.168.194.11:3000';

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
      fail: () => reject({ code: -1, message: '无法连接本地后端，请确认 server 已启动' })
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

  // 更新用户资料
  updateProfile(data) {
    if (USE_CLOUD) {
      ensureCloud();
      return cloudCall('login', { action: 'updateProfile', ...data });
    }
    return localRequest('/api/auth/profile', 'POST', data);
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
  }
};
