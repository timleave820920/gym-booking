/**
 * 用户域（users）：账号注册/登录、资料、后台用户管理
 */
const { db } = require('../db-core');

function findUserByOpenid(openid) {
  return db.prepare('SELECT * FROM users WHERE openid = ?').get(openid) || null;
}

/**
 * 注册新用户
 */
function createUser({ openid, nickname = '', avatar = '', phone = '', role = 'student' }) {
  const result = db.prepare(`
    INSERT INTO users (openid, nickname, avatar, phone, role, login_count)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(openid, nickname, avatar, phone, role);
  return findUserByOpenid(openid);
}

/**
 * 更新登录信息（登录次数 +1，更新最后登录时间）
 */
function touchLogin(openid) {
  db.prepare(`
    UPDATE users
    SET last_login_at = datetime('now','localtime'), login_count = login_count + 1
    WHERE openid = ?
  `).run(openid);
  return findUserByOpenid(openid);
}

/**
 * 更新用户资料（昵称/头像）
 */
function updateProfile(openid, { nickname, avatar }) {
  db.prepare('UPDATE users SET nickname = ?, avatar = ? WHERE openid = ?')
    .run(nickname || '', avatar || '', openid);
  return findUserByOpenid(openid);
}

// ===== 会员体系（等级/储值/奖励/邀请）=====
// 数值统一从 member-config.js 读取（唯一数据源，改配置即全局生效）

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

/**
 * 列出所有用户（后台用）
 */
function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

/**
 * 删除指定用户（按 id）
 * @returns {boolean} 是否删除成功
 */
function deleteUserById(id) {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * 删除指定用户（按 openid）
 * @returns {boolean} 是否删除成功
 */
function deleteUserByOpenid(openid) {
  const result = db.prepare('DELETE FROM users WHERE openid = ?').run(openid);
  return result.changes > 0;
}

/**
 * 清空所有用户
 * @returns {number} 删除的用户数
 */
function clearUsers() {
  const count = countUsers();
  db.exec('DELETE FROM users;');
  // 重置自增 ID，让新注册从 1 开始
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'users';");
  return count;
}

// ===== 课程相关（结构见 DATA-MODEL.md）=====
// ===== 导出 =====
module.exports = { findUserByOpenid, createUser, touchLogin, updateProfile, countUsers, listUsers, deleteUserById, deleteUserByOpenid, clearUsers };
