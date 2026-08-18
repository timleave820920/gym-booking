/**
 * 用户域（users）：账号注册/登录、资料、后台用户管理
 */
const { db, driver } = require('../db-core');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）

async function findUserByOpenid(openid) {
  return await driver.get('SELECT * FROM users WHERE openid = ?', [openid]) || null;
}

/**
 * 注册新用户
 */
async function createUser({ openid, nickname = '', avatar = '', phone = '', role = 'student' }) {
  const result = await driver.run(`
    INSERT INTO users (openid, nickname, avatar, phone, \`role\`, login_count)
    VALUES (?, ?, ?, ?, ?, 1)
  `, [openid, nickname, avatar, phone, role]);
  return await findUserByOpenid(openid);
}

/**
 * 更新登录信息（登录次数 +1，更新最后登录时间）
 */
async function touchLogin(openid) {
  await driver.run(`
    UPDATE users
    SET last_login_at = ?, login_count = login_count + 1
    WHERE openid = ?
  `, [time.nowDateTimeStr(), openid]);
  return await findUserByOpenid(openid);
}

/**
 * 更新用户资料（昵称/头像）
 */
async function updateProfile(openid, { nickname, avatar }) {
  await driver.run('UPDATE users SET nickname = ?, avatar = ? WHERE openid = ?', [nickname || '', avatar || '', openid]);
  return await findUserByOpenid(openid);
}

// ===== 社交画像（DESIGN #D5）：性别/生日（微信自 2021 年起不再提供真实性别年龄，只能用户自填）=====

/** 读取画像：gender 0=未知 1=男 2=女；birthday YYYY-MM-DD；in_birthday_month 供前端高亮/8 折提示 */
async function getUserProfile(openid) {
  const user = await findUserByOpenid(openid);
  if (!user) return null;
  const birthday = user.birthday || '';
  return {
    openid,
    gender: user.gender || 0,
    birthday,
    profile_bonus_claimed: !!user.profile_bonus_claimed,
    in_birthday_month: !!(birthday && birthday.slice(0, 7) === time.todayStr().slice(0, 7))
  };
}

/**
 * 填写/更新画像；首次填写（此前无任何画像信息）发放 20 能量币（一次性，profile_bonus_claimed 落库防重复）
 * @returns {{ok:true, profile, bonusCoins:number}|{ok:false, error:string}}
 */
async function updateUserProfile(openid, { gender, birthday }) {
  const user = await findUserByOpenid(openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };
  if (gender !== undefined && ![0, 1, 2].includes(Number(gender))) {
    return { ok: false, error: '性别取值：0 未知 / 1 男 / 2 女' };
  }
  if (birthday !== undefined && birthday !== '' && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday)) {
    return { ok: false, error: '生日格式应为 YYYY-MM-DD' };
  }
  const firstTime = !user.gender && !user.birthday;
  const g = gender === undefined ? (user.gender || 0) : Number(gender);
  const b = birthday === undefined ? (user.birthday || '') : birthday;
  await driver.run('UPDATE users SET gender = ?, birthday = ?, profile_bonus_claimed = 1 WHERE openid = ?', [g, b, openid]);
  let bonusCoins = 0;
  if (firstTime) {
    // 惰性 require 防循环依赖（coin.js → users.js 单向，这里反向取用）
    const { addCoins } = require('./coin');
    const ENERGY_CONFIG = require('../energy-config.js');
    const after = await addCoins(openid, ENERGY_CONFIG.earnRules.profile, '完善画像奖励', 'PROFILE-BONUS', true);
    bonusCoins = after ? ENERGY_CONFIG.earnRules.profile : 0;
  }
  return { ok: true, profile: await getUserProfile(openid), bonusCoins };
}

// ===== 会员体系（等级/储值/奖励/邀请）=====
// 数值统一从 member-config.js 读取（唯一数据源，改配置即全局生效）

async function countUsers() {
  return (await driver.get('SELECT COUNT(*) AS count FROM users')).count;
}

/**
 * 列出所有用户（后台用）
 */
async function listUsers() {
  return await driver.all('SELECT * FROM users ORDER BY created_at DESC');
}

/**
 * 删除指定用户（按 id）
 * @returns {boolean} 是否删除成功
 */
async function deleteUserById(id) {
  const result = await driver.run('DELETE FROM users WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * 删除指定用户（按 openid）
 * @returns {boolean} 是否删除成功
 */
async function deleteUserByOpenid(openid) {
  const result = await driver.run('DELETE FROM users WHERE openid = ?', [openid]);
  return result.changes > 0;
}

/**
 * 清空所有用户
 * @returns {number} 删除的用户数
 */
async function clearUsers() {
  const count = await countUsers();
  db.exec('DELETE FROM users;');
  // 重置自增 ID，让新注册从 1 开始
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'users';");
  return count;
}

// ===== 课程相关（结构见 DATA-MODEL.md）=====
// ===== 导出 =====
module.exports = { findUserByOpenid, createUser, touchLogin, updateProfile, countUsers, listUsers, deleteUserById, deleteUserByOpenid, clearUsers, getUserProfile, updateUserProfile };
