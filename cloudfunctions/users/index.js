/**
 * 云函数：users（用户管理）
 * 微信云开发 - 综合训练馆订课系统
 *
 * 后台学员管理页调用，返回所有注册用户
 *
 * 调用方式（小程序端）：
 *   wx.cloud.callFunction({ name: 'users', data: { action: 'list' } })
 *   wx.cloud.callFunction({ name: 'users', data: { action: 'stats' } })
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'list' } = event;

  if (action === 'stats') {
    const countRes = await db.collection('users').count();
    return { code: 200, totalUsers: countRes.total };
  }

  // list：返回所有用户（按注册时间倒序）
  const res = await db.collection('users')
    .orderBy('created_at', 'desc')
    .limit(100)
    .get();

  return {
    code: 200,
    users: res.data.map(toPublic)
  };
};

function toPublic(user) {
  return {
    id: user._id,
    openid: user.openid,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    phone: user.phone || '',
    role: user.role || 'student',
    total_classes: user.total_classes || 0,
    total_hours: user.total_hours || '0h',
    total_calories: user.total_calories || '0',
    streak: user.streak || 0,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    login_count: user.login_count || 0
  };
}
