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

// 候补排位表（满员课付费排位，有人退订自动转正）
db.exec(`
  CREATE TABLE IF NOT EXISTS waitlist (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    wait_no       TEXT UNIQUE NOT NULL,
    user_openid   TEXT NOT NULL,
    session_id    INTEGER NOT NULL,
    amount_fen    INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'waiting',    -- waiting 排位中 / promoted 已转正 / refunded 已退款 / cancelled 主动退出
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    promoted_at   TEXT,
    refunded_at   TEXT,
    cancel_reason TEXT DEFAULT '',
    FOREIGN KEY (user_openid) REFERENCES users(openid),
    FOREIGN KEY (session_id)  REFERENCES course_sessions(id),
    UNIQUE (user_openid, session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status, created_at);
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

// ===== 课程相关（结构见 DATA-MODEL.md）=====

/** 教练列表（下拉选项用） */
function listCoaches() {
  return db.prepare("SELECT id, name, skills, status FROM coaches WHERE status='active' OR 1=1 ORDER BY id").all();
}

/** 场地列表（下拉选项用） */
function listVenues() {
  return db.prepare('SELECT id, name, capacity, status FROM venues ORDER BY id').all();
}

/** 课程列表（含排课规则） */
function listCourses() {
  const courses = db.prepare('SELECT * FROM courses ORDER BY id').all();
  const rules = db.prepare('SELECT * FROM schedule_templates ORDER BY id').all();
  const byCourse = {};
  for (const r of rules) {
    (byCourse[r.course_id] = byCourse[r.course_id] || []).push({
      weekday: r.weekday,
      start_time: r.start_time,
      end_time: r.end_time,
      coach_id: r.coach_id,
      venue_id: r.venue_id,
      capacity: r.capacity
    });
  }
  return courses.map(c => ({ ...c, rules: byCourse[c.id] || [] }));
}

/** 课程规则列表 */
function getRules(courseId) {
  return db.prepare('SELECT * FROM schedule_templates WHERE course_id = ? ORDER BY weekday, start_time').all(courseId);
}

/** 替换课程规则（先删后插，事务内） */
function replaceRules(courseId, rules) {
  db.prepare('DELETE FROM schedule_templates WHERE course_id = ?').run(courseId);
  const ins = db.prepare(`INSERT INTO schedule_templates (course_id, weekday, start_time, end_time, venue_id, coach_id, capacity)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rules || []) {
    ins.run(courseId, r.weekday, r.start_time, r.end_time, r.venue_id, r.coach_id, r.capacity);
  }
}

/** 新增课程（含规则） @returns 新课程对象 */
function createCourse(data) {
  const res = db.prepare(`INSERT INTO courses (name, category, level, duration_min, price_fen, cover, description, status)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.name, data.category, data.level, data.duration_min, data.price_fen, data.cover || '', data.description || '', data.status || 'published');
  const id = res.lastInsertRowid;
  replaceRules(id, data.rules || []);
  return { id, ...data };
}

/** 更新课程（含规则） @returns 是否成功 */
function updateCourse(id, data) {
  const res = db.prepare(`UPDATE courses SET name=?, category=?, level=?, duration_min=?, price_fen=?, cover=?, description=?, status=?, updated_at=datetime('now','localtime')
                          WHERE id = ?`)
    .run(data.name, data.category, data.level, data.duration_min, data.price_fen, data.cover || '', data.description || '', data.status || 'published', id);
  if (res.changes === 0) return false;
  replaceRules(id, data.rules || []);
  return true;
}

/**
 * 删除课程（级联删规则与场次；场次有订单则拒绝）
 * @returns {{ok:boolean, bookings?:number}}
 */
function deleteCourse(id) {
  const b = db.prepare('SELECT COUNT(*) c FROM bookings b JOIN course_sessions s ON s.id = b.session_id WHERE s.course_id = ?').get(id).c;
  if (b > 0) return { ok: false, bookings: b };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM schedule_templates WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_sessions WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    db.exec('COMMIT');
    return { ok: true };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * 发布课程：按排课规则在日期范围内生成场次（幂等，已存在的跳过）
 * @returns {{created:number, skipped:number}}
 */
function publishSessions(courseId, startDate, endDate) {
  const rules = getRules(courseId);
  if (rules.length === 0) return { created: 0, skipped: 0, reason: 'no_rules' };

  const exists = new Set(db.prepare("SELECT date || '_' || start_time || '_' || venue_id k FROM course_sessions WHERE course_id = ?")
    .all(courseId).map(r => r.k));

  const ins = db.prepare(`INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source)
                          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'published', 'manual')`);
  let created = 0, skipped = 0;

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const weekday = d.getDay() === 0 ? 7 : d.getDay(); // 周日=7
    for (const r of rules) {
      if (r.weekday !== weekday) continue;
      const key = `${iso}_${r.start_time}_${r.venue_id}`;
      if (exists.has(key)) { skipped++; continue; }
      ins.run(courseId, r.coach_id, r.venue_id, iso, r.start_time, r.end_time, r.capacity);
      exists.add(key);
      created++;
    }
  }
  return { created, skipped };
}

// 场次查询的公共 JOIN
const SESSION_SELECT = `
  SELECT s.id, s.date, s.start_time, s.end_time, s.capacity, s.booked_count, s.status,
         (s.capacity - s.booked_count) AS remaining,
         c.id AS course_id, c.name AS course_name, c.category, c.level, c.duration_min, c.price_fen, c.cover,
         co.name AS coach_name, v.name AS venue_name
  FROM course_sessions s
  JOIN courses c ON c.id = s.course_id
  JOIN coaches co ON co.id = s.coach_id
  JOIN venues v ON v.id = s.venue_id`;

/** 按日期查已发布场次（学员端课程列表） */
function listSessionsByDate(date) {
  return db.prepare(`${SESSION_SELECT} WHERE s.date = ? AND s.status = 'published' ORDER BY s.start_time`).all(date);
}

/** 按日期查场次，并标记当前用户是否已预订/已排位（openid 可选） */
function listSessionsByDateForUser(date, openid) {
  const sessions = listSessionsByDate(date);
  if (!openid) return sessions;
  // 查该用户已预订的场次 id 集合（仅 booked 状态）
  const bookedRows = db.prepare("SELECT session_id FROM bookings WHERE user_openid = ? AND status = 'booked'").all(openid);
  const bookedSet = new Set(bookedRows.map(r => r.session_id));
  // 查该用户候补排位中的场次 id 集合（仅 waiting 状态）
  const waitRows = db.prepare("SELECT session_id FROM waitlist WHERE user_openid = ? AND status = 'waiting'").all(openid);
  const waitSet = new Set(waitRows.map(r => r.session_id));
  return sessions.map(s => ({ ...s, booked_by_me: bookedSet.has(s.id), waitlisted_by_me: waitSet.has(s.id) }));
}

/** 场次详情（学员端课程详情） */
function getSessionById(id) {
  return db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) || null;
}

// ===== 订课（bookings）=====

/**
 * 学员订课：创建订单 + 扣减场次余位（事务，防超卖）
 * @param {object} p { user_openid, session_id, amount_fen, pay_status }
 * @returns {{ok:true, booking:object}|{ok:false, error:string}}
 */
function createBooking({ user_openid, session_id, amount_fen = 0, pay_status = 'paid' }) {
  // 校验用户存在
  const user = findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  // 校验场次存在且可订
  const session = getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };
  if (session.remaining <= 0) return { ok: false, error: '该课程已满员' };

  // 检查是否已订（UNIQUE 约束兜底）
  const exists = db.prepare('SELECT id, status FROM bookings WHERE user_openid = ? AND session_id = ?').get(user_openid, session_id);
  if (exists && exists.status === 'booked') return { ok: false, error: '您已预订该课程，请勿重复预订' };

  const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();

  db.exec('BEGIN');
  try {
    if (exists) {
      // 曾退订 → 重新激活原订单（保留历史 booking_no）
      db.prepare("UPDATE bookings SET status = 'booked', pay_status = ?, cancel_reason = '', checkin_at = NULL WHERE id = ?")
        .run(pay_status, exists.id);
    } else {
      // 1. 创建订单
      db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
                  VALUES (?, ?, ?, ?, 'booked', ?)`)
        .run(bookingNo, user_openid, session_id, amount_fen, pay_status);
    }
    // 2. 扣减余位
    db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(session_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    if (e.message.includes('UNIQUE')) return { ok: false, error: '您已预订该课程，请勿重复预订' };
    throw e;
  }

  const booking = db.prepare(`
    SELECT b.id, b.booking_no, b.session_id, b.amount_fen, b.status, b.pay_status, b.checkin_at, b.created_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.id = last_insert_rowid()
  `).get();
  return { ok: true, booking };
}

/**
 * 查询某学员的全部订课（我的课程）
 * @param {string} openid
 * @param {string} [status] 可选筛选：booked/cancelled
 */
function listBookingsByUser(openid, status) {
  const where = status ? 'WHERE b.user_openid = ? AND b.status = ?' : 'WHERE b.user_openid = ?';
  const params = status ? [openid, status] : [openid];
  return db.prepare(`
    SELECT b.id, b.booking_no, b.session_id, b.amount_fen, b.status, b.pay_status, b.checkin_at, b.created_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.id AS course_id, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    ${where}
    ORDER BY s.date DESC, s.start_time DESC
  `).all(...params);
}

/**
 * 退订：取消订单 + 恢复场次余位（事务）
 */
function cancelBooking(openid, bookingId) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_openid = ?').get(bookingId, openid);
  if (!booking) return { ok: false, error: '订单不存在' };
  if (booking.status === 'cancelled') return { ok: false, error: '该订单已退订' };

  db.exec('BEGIN');
  let promoted = null;
  try {
    db.prepare("UPDATE bookings SET status = 'cancelled', cancel_reason = '用户退订' WHERE id = ?").run(bookingId);
    // 仅未签到订单恢复余位
    if (!booking.checkin_at) {
      db.prepare('UPDATE course_sessions SET booked_count = MAX(booked_count - 1, 0) WHERE id = ?').run(booking.session_id);
      // 有候补者 → 最早排位者自动转正（候补队列先进先出）
      promoted = promoteFromWaitlist(booking.session_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, promoted };
}

/**
 * 候补转正：把某场次最早的 waiting 排位者转正为正式订课（需在事务内调用）
 * @returns {object|null} 转正的排位记录（含用户/场次信息）
 */
function promoteFromWaitlist(sessionId) {
  const waiting = db.prepare("SELECT * FROM waitlist WHERE session_id = ? AND status = 'waiting' ORDER BY created_at, id LIMIT 1").get(sessionId);
  if (!waiting) return null;

  // 生成订课单号并创建 booking
  const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
              VALUES (?, ?, ?, ?, 'booked', 'paid')`)
    .run(bookingNo, waiting.user_openid, waiting.session_id, waiting.amount_fen);
  // 扣减余位（退订时已 +1，这里 -1 抵消，保持满员状态）
  db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(sessionId);
  // 更新排位记录为已转正
  db.prepare("UPDATE waitlist SET status = 'promoted', promoted_at = datetime('now','localtime') WHERE id = ?").run(waiting.id);

  return {
    id: waiting.id,
    wait_no: waiting.wait_no,
    user_openid: waiting.user_openid,
    session_id: waiting.session_id,
    amount_fen: waiting.amount_fen
  };
}

/**
 * 满员付费排位
 * @param {object} p { user_openid, session_id, amount_fen }
 * @returns {{ok:true, wait:{}}|{ok:false, error:string}}
 */
function joinWaitlist({ user_openid, session_id, amount_fen = 0 }) {
  const user = findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  const session = getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };

  // 已订过 → 无需排位
  const existing = db.prepare("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'").get(user_openid, session_id);
  if (existing) return { ok: false, error: '您已预订该课程' };

  // 已在排位 → 防重复
  const queued = db.prepare("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ? AND status = 'waiting'").get(user_openid, session_id);
  if (queued) return { ok: false, error: '您已在候补队列中' };

  // 有余位 → 直接订课更合适（前端应引导，这里兜底拒绝排位）
  if (session.remaining > 0) {
    return { ok: false, error: '该课程仍有余位，请直接预订' };
  }

  const waitNo = 'WL' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  db.prepare(`INSERT INTO waitlist (wait_no, user_openid, session_id, amount_fen, status)
              VALUES (?, ?, ?, ?, 'waiting')`)
    .run(waitNo, user_openid, session_id, amount_fen);
  const wait = db.prepare(`
    SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.created_at,
           s.date, s.start_time, s.end_time, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE w.id = last_insert_rowid()
  `).get();
  return { ok: true, wait };
}

/**
 * 主动退出候补（退款）
 */
function cancelWaitlist(openid, waitId) {
  const wait = db.prepare('SELECT * FROM waitlist WHERE id = ? AND user_openid = ?').get(waitId, openid);
  if (!wait) return { ok: false, error: '排位记录不存在' };
  if (wait.status !== 'waiting') return { ok: false, error: '该排位已不在队列中' };
  db.prepare("UPDATE waitlist SET status = 'cancelled', cancel_reason = '用户退出候补', refunded_at = datetime('now','localtime') WHERE id = ?").run(waitId);
  return { ok: true };
}

/**
 * 查询某学员的全部候补记录
 */
function listWaitlistByUser(openid) {
  return db.prepare(`
    SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.created_at, w.promoted_at, w.refunded_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.id AS course_id, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE w.user_openid = ?
    ORDER BY w.created_at DESC
  `).all(openid);
}

/**
 * 过期退款任务：课程已开始仍未排到 → 自动退款（标记 refunded）
 * @returns {number} 退款的条数
 */
function refundExpiredWaitlist() {
  const expired = db.prepare(`
    SELECT w.id FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    WHERE w.status = 'waiting'
      AND (s.date < date('now','localtime')
           OR (s.date = date('now','localtime') AND s.start_time < time('now','localtime')))
  `).all();
  for (const row of expired) {
    db.prepare("UPDATE waitlist SET status = 'refunded', cancel_reason = '课程开始未排到，自动退款', refunded_at = datetime('now','localtime') WHERE id = ?").run(row.id);
  }
  return expired.length;
}

/**
 * 统计某学员订课数量
 */
function countBookingsByUser(openid) {
  return db.prepare("SELECT COUNT(*) c FROM bookings WHERE user_openid = ? AND status = 'booked'").get(openid).c;
}

/**
 * 统计已完成的锻炼次数 = 已订（booked）且场次已结束的总数
 * 场次已结束：日期早于今天，或日期=今天且结束时间早于当前时间
 */
function countFinishedWorkouts(openid) {
  const row = db.prepare(`
    SELECT COUNT(*) c
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE b.user_openid = ? AND b.status = 'booked'
      AND (s.date < date('now','localtime')
           OR (s.date = date('now','localtime') AND s.end_time < time('now','localtime')))
  `).get(openid);
  return row.c;
}

/**
 * 统计当前未开始的已订课（待上课）
 */
function countUpcomingBookings(openid) {
  const row = db.prepare(`
    SELECT COUNT(*) c
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE b.user_openid = ? AND b.status = 'booked'
      AND (s.date > date('now','localtime')
           OR (s.date = date('now','localtime') AND s.start_time >= time('now','localtime')))
  `).get(openid);
  return row.c;
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
  clearUsers,
  // 课程相关
  listCoaches,
  listVenues,
  listCourses,
  getRules,
  replaceRules,
  createCourse,
  updateCourse,
  deleteCourse,
  publishSessions,
  // 场次查询
  listSessionsByDate,
  listSessionsByDateForUser,
  getSessionById,
  // 订课
  createBooking,
  listBookingsByUser,
  cancelBooking,
  countBookingsByUser,
  countFinishedWorkouts,
  countUpcomingBookings,
  // 候补排位
  joinWaitlist,
  cancelWaitlist,
  listWaitlistByUser,
  refundExpiredWaitlist
};
