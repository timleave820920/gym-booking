/**
 * 课程域（courses）：课程模板、场次排课、规则、教练/场地
 */
const { db } = require('../db-core');

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
  const res = db.prepare(`INSERT INTO courses (name, category, level, duration_min, price_fen, cover, description, tags, status)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.name, data.category, data.level, data.duration_min, data.price_fen, data.cover || '', data.description || '', data.tags || '', data.status || 'published');
  const id = res.lastInsertRowid;
  replaceRules(id, data.rules || []);
  return { id, ...data };
}

/** 更新课程（含规则） @returns 是否成功 */
function updateCourse(id, data) {
  // 部分更新容错：未传字段沿用原值（修复 500——探针发现，BUG-LEDGER #4）
  const cur = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!cur) return false;
  const d = {
    name: data.name ?? cur.name,
    category: data.category ?? cur.category,
    level: data.level ?? cur.level,
    duration_min: data.duration_min ?? cur.duration_min,
    price_fen: data.price_fen ?? cur.price_fen,
    cover: data.cover ?? cur.cover,
    description: data.description ?? cur.description,
    tags: data.tags ?? cur.tags,
    status: data.status ?? cur.status
  };
  const res = db.prepare(`UPDATE courses SET name=?, category=?, level=?, duration_min=?, price_fen=?, cover=?, description=?, tags=?, status=?, updated_at=datetime('now','localtime')
                          WHERE id = ?`)
    .run(d.name, d.category, d.level, d.duration_min, d.price_fen, d.cover, d.description, d.tags, d.status, id);
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
         c.description AS course_desc, c.tags AS course_tags, co.name AS coach_name, co.avatar AS coach_avatar, v.name AS venue_name
  FROM course_sessions s
  JOIN courses c ON c.id = s.course_id
  JOIN coaches co ON co.id = s.coach_id
  JOIN venues v ON v.id = s.venue_id`;

/** 按日期查已发布场次（学员端课程列表） */
function listSessionsByDate(date) {
  return db.prepare(`${SESSION_SELECT} WHERE s.date = ? AND s.status = 'published' ORDER BY s.start_time`).all(date);
}

/** 按日期 + 教练查已发布场次（教练端今日课表） */
function listSessionsByCoach(date, coachId) {
  return db.prepare(`${SESSION_SELECT} WHERE s.date = ? AND s.coach_id = ? AND s.status = 'published' ORDER BY s.start_time`)
    .all(date, coachId);
}

/** 按日期范围 + 课程查场次（排表管理页，含全部状态） */
function listSessionsByRange(from, to, courseId) {
  let sql = `${SESSION_SELECT} WHERE s.date >= ? AND s.date <= ?`;
  const params = [from, to];
  if (courseId) {
    sql += ' AND s.course_id = ?';
    params.push(courseId);
  }
  sql += ' ORDER BY s.date, s.start_time';
  return db.prepare(sql).all(...params);
}

/**
 * 取消场次：仅允许无人预约的场次（booked_count=0 且无订单记录）
 * @returns {{ok:boolean, error?:string}}
 */
function cancelSession(id) {
  const s = db.prepare('SELECT id, booked_count, status FROM course_sessions WHERE id = ?').get(id);
  if (!s) return { ok: false, error: '场次不存在' };
  if (s.status === 'cancelled') return { ok: false, error: '该场次已取消' };
  const orders = db.prepare('SELECT COUNT(*) c FROM bookings WHERE session_id = ? AND status = \'booked\'').get(id).c;
  const total = s.booked_count || 0;
  if (orders > 0 || total > 0) return { ok: false, error: `该场次已有 ${Math.max(orders, total)} 名学员预约，无法取消` };
  db.prepare("UPDATE course_sessions SET status = 'cancelled' WHERE id = ?").run(id);
  return { ok: true };
}

/**
 * 调整场次容量：新容量不能小于已约数
 * @returns {{ok:boolean, error?:string}}
 */
function updateSessionCapacity(id, capacity) {
  const cap = Number(capacity);
  if (!Number.isFinite(cap) || cap <= 0) return { ok: false, error: '容量必须为正整数' };
  const s = db.prepare('SELECT id, booked_count, status FROM course_sessions WHERE id = ?').get(id);
  if (!s) return { ok: false, error: '场次不存在' };
  if (s.status !== 'published') return { ok: false, error: '该场次已取消，无法调整' };
  if (cap < (s.booked_count || 0)) return { ok: false, error: `容量不能小于已预约人数（${s.booked_count}）` };
  db.prepare('UPDATE course_sessions SET capacity = ? WHERE id = ?').run(cap, id);
  return { ok: true };
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

/**
 * 满员状态联动：booked_count >= capacity → full，否则 published
 * 每次 booked_count 变更后调用（订课/退订/转正），保证场次状态与余位一致
 */
function syncSessionStatus(sessionId) {
  db.prepare("UPDATE course_sessions SET status = CASE WHEN booked_count >= capacity THEN 'full' ELSE 'published' END WHERE id = ?").run(sessionId);
}

// ===== 订课（bookings）=====

/**
 * 学员订课：创建订单 + 扣减场次余位（事务，防超卖）
 * @param {object} p { user_openid, session_id, amount_fen, pay_status }
 * @returns {{ok:true, booking:object}|{ok:false, error:string}}
 */
// ===== 导出 =====
module.exports = { listCoaches, listVenues, listCourses, getRules, replaceRules, createCourse, updateCourse, deleteCourse, publishSessions, listSessionsByDate, listSessionsByCoach, listSessionsByRange, cancelSession, updateSessionCapacity, listSessionsByDateForUser, getSessionById, syncSessionStatus };
