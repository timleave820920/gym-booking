/**
 * 数据库层 - SQLite (node:sqlite)
 * 综合训练馆订课系统
 * 存储已注册用户，支持注册/登录判定
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'gym.db');
// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 打开数据库（WAL 模式，允许并发读写）
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// 初始化用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    openid        TEXT UNIQUE NOT NULL,          -- 微信 openid（唯一身份标识）
    nickname      TEXT DEFAULT '',               -- 微信昵称
    avatar        TEXT DEFAULT '',               -- 头像 URL
    phone         TEXT DEFAULT '',               -- 手机号（可选）
    role          TEXT DEFAULT 'student',        -- 角色：student/coach/admin
    total_classes INTEGER DEFAULT 0,             -- 累计上课次数
    total_hours   TEXT DEFAULT '0h',             -- 累计时长
    total_calories TEXT DEFAULT '0',             -- 累计卡路里
    streak        INTEGER DEFAULT 0,             -- 连续打卡
    created_at    TEXT DEFAULT (datetime('now','localtime')),  -- 注册时间
    last_login_at TEXT DEFAULT (datetime('now','localtime')),  -- 最后登录时间
    login_count   INTEGER DEFAULT 0              -- 登录次数
  );
`);

// ===== 课程相关表（结构见 DATA-MODEL.md）=====

// 教练资料表
db.exec(`
  CREATE TABLE IF NOT EXISTS coaches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_openid TEXT,
    name        TEXT NOT NULL,
    avatar      TEXT DEFAULT '',
    skills      TEXT DEFAULT '',
    rating      REAL DEFAULT 5.0,
    status      TEXT DEFAULT 'active'
  );
`);

// 场地表
db.exec(`
  CREATE TABLE IF NOT EXISTS venues (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    location TEXT DEFAULT '',
    capacity INTEGER DEFAULT 20,
    status   TEXT DEFAULT 'active'
  );
`);

// 课程模板表（价格存"分"）
db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL,
    level        INTEGER DEFAULT 3,
    duration_min INTEGER DEFAULT 60,
    price_fen    INTEGER DEFAULT 6800,
    cover        TEXT DEFAULT '',
    description  TEXT DEFAULT '',
    status       TEXT DEFAULT 'published',
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// 每周重复排课规则表
db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id  INTEGER NOT NULL,
    weekday    INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time   TEXT NOT NULL,
    venue_id   INTEGER NOT NULL,
    coach_id   INTEGER NOT NULL,
    capacity   INTEGER DEFAULT 20,
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (venue_id)  REFERENCES venues(id),
    FOREIGN KEY (coach_id)  REFERENCES coaches(id)
  );
`);

// 课程场次表（排课实例，余位 = capacity - booked_count）
db.exec(`
  CREATE TABLE IF NOT EXISTS course_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL,
    coach_id     INTEGER NOT NULL,
    venue_id     INTEGER NOT NULL,
    date         TEXT NOT NULL,
    start_time   TEXT NOT NULL,
    end_time     TEXT NOT NULL,
    capacity     INTEGER DEFAULT 20,
    booked_count INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'published',
    source       TEXT DEFAULT 'manual',
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (coach_id)  REFERENCES coaches(id),
    FOREIGN KEY (venue_id)  REFERENCES venues(id)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON course_sessions(date, status);
  CREATE INDEX IF NOT EXISTS idx_sessions_course ON course_sessions(course_id, date);
`);

// 预约/订单表
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_no    TEXT UNIQUE NOT NULL,
    user_openid   TEXT NOT NULL,
    session_id    INTEGER NOT NULL,
    amount_fen    INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'booked',
    pay_status    TEXT DEFAULT 'unpaid',
    checkin_at    TEXT,
    cancel_reason TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_openid) REFERENCES users(openid),
    FOREIGN KEY (session_id)  REFERENCES course_sessions(id),
    UNIQUE (user_openid, session_id)
  );
`);

/**
 * 根据 openid 查找用户
 */
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

/**
 * 查询用户总数（统计用）
 */
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

module.exports = {
  db,
  findUserByOpenid,
  createUser,
  touchLogin,
  updateProfile,
  countUsers,
  listUsers,
  deleteUserById,
  deleteUserByOpenid,
  clearUsers
};
