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
module.exports = { findUserByOpenid, createUser, touchLogin, updateProfile, countUsers, listUsers, deleteUserById, deleteUserByOpenid, clearUsers };
