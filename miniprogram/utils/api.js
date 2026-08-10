/**
 * API 请求封装
 * 综合训练馆订课系统
 *
 * 后端地址配置：
 * - 开发者工具（不校验域名）：http://127.0.0.1:3000
 * - 真机预览（同一局域网）：改为电脑 IP，如 http://192.168.194.11:3000
 * - 生产环境：替换为 HTTPS 正式域名
 */
const BASE_URL = 'http://127.0.0.1:3000';

function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
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
        reject({ code: -1, message: '无法连接服务器，请确认后端已启动', detail: err });
      }
    });
  });
}

module.exports = {
  BASE_URL,

  // 注册/登录（首次=注册，再次=登录）
  login(data) {
    return request('/api/auth/login', 'POST', data);
  },

  // 更新用户资料
  updateProfile(data) {
    return request('/api/auth/profile', 'POST', data);
  },

  // 用户列表（后台用）
  getUsers() {
    return request('/api/users', 'GET');
  },

  // 用户统计
  getUsersStats() {
    return request('/api/users/stats', 'GET');
  }
};
