/**
 * 消息域（messages）：站内信、开课提醒、批量通知
 */
const { db } = require('../db-core');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）

function sendMessage(m) {
  if (!m || !m.user_openid || !m.title) return null;
  if (m.dedup_key) {
    const exists = db.prepare('SELECT id FROM messages WHERE user_openid = ? AND dedup_key = ?').get(m.user_openid, m.dedup_key);
    if (exists) return null;
  }
  const res = db.prepare(`INSERT INTO messages (user_openid, type, title, content, biz_type, biz_id, jump_url, dedup_key)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(m.user_openid, m.type || 'system', m.title, m.content || '', m.biz_type || '', m.biz_id || 0, m.jump_url || '', m.dedup_key || '');
  return res.lastInsertRowid;
}

/** 全员广播（openids 不传则发给所有已注册用户） */
function broadcastMessage(m, openids) {
  if (!m) return 0;
  if (!openids || openids.length === 0) {
    openids = db.prepare('SELECT DISTINCT user_openid FROM users').all().map(r => r.user_openid);
  }
  let count = 0;
  for (const oid of openids) {
    if (sendMessage({ ...m, user_openid: oid })) count += 1;
  }
  return count;
}

/** 消息列表（分页，每页 20 条） */
function listMessages(openid, page = 1) {
  const size = 20;
  const off = (Math.max(1, Number(page) || 1) - 1) * size;
  return db.prepare('SELECT * FROM messages WHERE user_openid = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(openid, size, off);
}

/** 未读数 */
function unreadMessageCount(openid) {
  return db.prepare('SELECT COUNT(*) c FROM messages WHERE user_openid = ? AND is_read = 0').get(openid).c;
}

/** 标记单条已读（校验归属） */
function markMessageRead(id, openid) {
  return db.prepare('UPDATE messages SET is_read = 1 WHERE id = ? AND user_openid = ?').run(id, openid).changes > 0;
}

/** 全部已读 */
function markAllMessagesRead(openid) {
  return db.prepare('UPDATE messages SET is_read = 1 WHERE user_openid = ? AND is_read = 0').run(openid).changes;
}

/** 未来 N 小时内开场的已发布场次（开课提醒用） */
function listSessionsStartingSoon(hours) {
  // 取时间走 time.js（显式北京时间，不依赖容器系统时区，BUG-LEDGER #28）
  const today = time.todayStr();
  const startHH = time.nowTimeStr().slice(0, 5);
  const endHH = time.nowTimeStr(new Date(Date.now() + hours * 3600e3)).slice(0, 5);
  return db.prepare(`
    SELECT s.id, s.date, s.start_time, s.end_time, s.course_id, c.name AS course_name, v.name AS venue_name
    FROM course_sessions s
    JOIN courses c ON c.id = s.course_id
    JOIN venues v ON v.id = s.venue_id
    WHERE s.status = 'published' AND s.date = ? AND s.start_time > ? AND s.start_time <= ?
  `).all(today, startHH, endHH);
}

/** 某场次已订学员 openid 列表 */
function listBookedUsersBySession(sessionId) {
  return db.prepare("SELECT DISTINCT user_openid FROM bookings WHERE session_id = ? AND status = 'booked'").all(sessionId).map(r => r.user_openid);
}

/** 生成订单号 */
// ===== 导出 =====
module.exports = { sendMessage, broadcastMessage, listMessages, unreadMessageCount, markMessageRead, markAllMessagesRead, listSessionsStartingSoon, listBookedUsersBySession };
