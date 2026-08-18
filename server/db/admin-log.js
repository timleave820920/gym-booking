/**
 * 管理操作日志域（B3 2026-08-18）：排课/删除/清空等管理关键操作入库留痕，管理网页可查
 * 与 logger.js（文件级 ops.log）区分：本模块落库可查询，供 web 管理后台「操作日志」页展示
 */
const { db, driver } = require('../db-core');

/**
 * 记录一条管理操作
 * @param {string} action 操作类型：course_create/course_update/course_delete/course_publish/session_cancel/session_capacity/coach_delete/...
 * @param {object|string} detail 详情（课程/场次 id 等，JSON 序列化存储）
 */
async function addAdminLog(action, detail = {}) {
  try {
    await driver.run('INSERT INTO admin_logs (action, detail, operator) VALUES (?, ?, ?)',
      [action, typeof detail === 'string' ? detail : JSON.stringify(detail), 'admin']);
  } catch (e) {
    console.error('[admin_log]', e.message);
  }
}

/** 最近 N 条管理操作日志（倒序） */
async function listAdminLogs(limit = 50) {
  // LIMIT 文本拼接：mysql2 execute 把 number 一律编码成 DOUBLE 绑定，MySQL 的 LIMIT 需整数类型 → ER_WRONG_ARGUMENTS 500
  // （BUG-LEDGER #60 连带；limit 来自 Number() 强转内部整数，无注入面）
  return await driver.all(`SELECT * FROM admin_logs ORDER BY id DESC LIMIT ${Number(limit) || 50}`);
}

module.exports = { addAdminLog, listAdminLogs };
