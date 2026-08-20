/**
 * 吐槽反馈域（DESIGN #D9）
 * 学员实名留言场馆（承诺每条必回复）→ web 后台收件箱回复 → 站内信 + 页内展示闭环
 */
const { driver } = require('../db-core');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）
const { sendMessage } = require('./messages');

const MAX_LEN = 500;                      // 吐槽内容上限（字）
const DUP_WINDOW_MS = 60 * 1000;          // 防连点窗口：60 秒内同人同内容视为重复提交

/**
 * 学员提交吐槽（实名：昵称/头像服务端从 users 表取快照，不信任前端）
 * @param {object} p { openid, content }
 * @returns {{ok:true, feedback:object}|{ok:false,error:string}}
 */
async function createFeedback({ openid, content }) {
  const text = String(content || '').trim();
  if (!text) return { ok: false, error: '吐槽内容不能为空' };
  if (text.length > MAX_LEN) return { ok: false, error: `吐槽内容不超过 ${MAX_LEN} 字` };
  // 防连点幂等：同人 60 秒内提交过同内容 → 拒绝（防双击/网络重试重复入库）
  const dup = await driver.get(
    'SELECT id FROM feedbacks WHERE user_openid = ? AND content = ? AND created_at >= ?',
    [openid, text, time.nowDateTimeStr(new Date(Date.now() - DUP_WINDOW_MS))]
  );
  if (dup) return { ok: false, error: '请勿重复提交，场馆正在处理中' };
  const user = await driver.get('SELECT nickname, avatar FROM users WHERE openid = ?', [openid]);
  // created_at 显式写北京时间（DEFAULT datetime('now','localtime') 在 UTC 容器 = UTC，与幂等比较值差 8 小时
  // → 防连点窗口失效；BUG-LEDGER #28 规矩：一切时间取值走 time.js）
  const r = await driver.run(
    "INSERT INTO feedbacks (user_openid, nickname, avatar, content, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
    [openid, user ? user.nickname : '', user ? user.avatar : '', text, time.nowDateTimeStr()]
  );
  const fb = await driver.get('SELECT * FROM feedbacks WHERE id = ?', [r.lastInsertRowid]);
  return { ok: true, feedback: fb };
}

/**
 * 我的吐槽历史（分页，新→旧；含场馆回复）
 */
async function listMyFeedbacks(openid, page = 1) {
  const size = 20;
  const off = (Math.max(1, Number(page) || 1) - 1) * size;
  // LIMIT/OFFSET 文本拼接：mysql2 把 number 编码成 DOUBLE 报 ER_WRONG_ARGUMENTS（BUG-LEDGER #60）
  return await driver.all(
    `SELECT id, content, status, reply, replied_at, created_at
     FROM feedbacks WHERE user_openid = ?
     ORDER BY created_at DESC, id DESC LIMIT ${size} OFFSET ${off}`, [openid]);
}

/**
 * 后台收件箱（未回复优先；含待回复统计）
 */
async function listAdminFeedbacks(status, page = 1) {
  const size = 30;
  const off = (Math.max(1, Number(page) || 1) - 1) * size;
  const where = status === 'replied' ? "WHERE status = 'replied'" : (status === 'open' ? "WHERE status = 'open'" : '');
  const list = await driver.all(
    `SELECT id, user_openid, nickname, avatar, content, status, reply, replied_at, reply_by, created_at
     FROM feedbacks ${where}
     ORDER BY (status = 'open') DESC, created_at DESC, id DESC LIMIT ${size} OFFSET ${off}`);
  const counts = await driver.get("SELECT SUM(status = 'open') AS open, SUM(status = 'replied') AS replied FROM feedbacks");
  // Number() 强转：MySQL SUM 返回 DECIMAL（decimalNumbers:true 下已是 number，双保险 BUG-LEDGER #60）
  return { list, counts: { open: Number(counts.open) || 0, replied: Number(counts.replied) || 0 } };
}

/**
 * 场馆回复（回复落库 + status→replied + 站内信通知学员跳吐槽页）
 * 已回复幂等：重复回复直接拒绝（防 web 双击/并发重复发信）
 * @returns {{ok:true, feedback:object, msgId?:number}|{ok:false,error:string}}
 */
async function replyFeedback(id, reply) {
  const text = String(reply || '').trim();
  if (!text) return { ok: false, error: '回复内容不能为空' };
  if (text.length > MAX_LEN) return { ok: false, error: `回复不超过 ${MAX_LEN} 字` };
  const fb = await driver.get('SELECT * FROM feedbacks WHERE id = ?', [id]);
  if (!fb) return { ok: false, error: '吐槽不存在' };
  if (fb.status === 'replied') return { ok: false, error: '该吐槽已回复，请勿重复回复' };
  await driver.run(
    "UPDATE feedbacks SET status = 'replied', reply = ?, replied_at = ?, reply_by = 'admin' WHERE id = ? AND status = 'open'",
    [text, time.nowDateTimeStr(), id]
  );
  const updated = await driver.get('SELECT * FROM feedbacks WHERE id = ?', [id]);
  // 站内信通知（事务外，回复已落库才发；type=feedback + biz_id=吐槽 id → 前端点击跳吐槽页）
  const msgId = await sendMessage({
    user_openid: fb.user_openid,
    type: 'feedback',
    title: '场馆回复',
    content: `场馆回复了你的吐槽：「${text.slice(0, 40)}${text.length > 40 ? '…' : ''}」`,
    biz_type: 'feedback',
    biz_id: id,
    jump_url: '/pages/feedback/index'
  });
  return { ok: true, feedback: updated, msgId };
}

module.exports = { createFeedback, listMyFeedbacks, listAdminFeedbacks, replyFeedback, MAX_LEN };
