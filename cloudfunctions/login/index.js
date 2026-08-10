/**
 * 云函数：login（注册/登录合一）
 * 微信云开发 - 综合训练馆订课系统
 *
 * 首次调用=注册（写入 users 集合），再次调用=登录（login_count+1）
 * 通过云开发自动获取真实 openid，无需模拟
 *
 * 调用方式（小程序端）：
 *   wx.cloud.callFunction({ name: 'login', data: { nickname, avatar, phone } })
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext(); // 真实 openid（云开发自动注入）
  const { nickname = '', avatar = '', phone = '' } = event;

  if (!OPENID) {
    return { code: 400, message: '获取 openid 失败' };
  }

  const users = db.collection('users');

  // 1. 查库：是否已注册
  const existRes = await users.where({ openid: OPENID }).get();

  if (existRes.data.length > 0) {
    // 已注册 → 登录：更新登录信息
    const user = existRes.data[0];
    await users.doc(user._id).update({
      data: {
        last_login_at: db.serverDate(),
        login_count: (user.login_count || 0) + 1
      }
    });
    const updated = (await users.doc(user._id).get()).data;
    return {
      code: 200,
      message: '登录成功',
      isNewUser: false,
      user: toPublic(updated)
    };
  }

  // 2. 未注册 → 注册
  const addRes = await users.add({
    data: {
      openid: OPENID,
      nickname,
      avatar,
      phone,
      role: 'student',
      total_classes: 0,
      total_hours: '0h',
      total_calories: '0',
      streak: 0,
      login_count: 1,
      created_at: db.serverDate(),
      last_login_at: db.serverDate()
    }
  });
  const created = (await users.doc(addRes._id).get()).data;
  return {
    code: 201,
    message: '注册成功',
    isNewUser: true,
    user: toPublic(created)
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
