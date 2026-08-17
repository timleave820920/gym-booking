/**
 * 签到窗口配置（前端共享，与后端 server/db/bookings.js 保持同一数值）
 * ============================================================
 * 修改本文件的数值后，前端所有签到窗口判定同步生效。
 * 后端对应常量：server/db/bookings.js EARLY_WINDOW / LATE_WINDOW
 * 业务规则基线：CONVENTIONS.md B3（签到窗口纪律）
 * ============================================================
 *
 * 用法：
 *   const { EARLY_WINDOW, LATE_WINDOW } = require('../../utils/checkin-config');
 */

/** 开课前可提前签到的分钟数 */
const EARLY_WINDOW = 30;

/** 结束后可补签的分钟数 */
const LATE_WINDOW = 30;

/**
 * 判定当前时间是否在签到窗口内
 * @param {string} date       - 场次日期 YYYY-MM-DD
 * @param {string} startTime  - 开始时间 HH:MM
 * @param {string} endTime    - 结束时间 HH:MM
 * @returns {boolean}
 */
function inCheckinWindow(date, startTime, endTime) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayFull = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (date !== todayFull) return false;
  const toMin = (s) => { const [h, m] = (s || '00:00').split(':').map(Number); return h * 60 + m; };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= toMin(startTime) - EARLY_WINDOW && nowMin <= toMin(endTime) + LATE_WINDOW;
}

/**
 * 生成窗口外的提示文案
 * @param {number} nowMin     - 当前分钟数
 * @param {string} startTime  - 开始时间 HH:MM
 * @param {string} endTime    - 结束时间 HH:MM
 * @returns {string} 空字符串表示在窗口内
 */
function windowHint(nowMin, startTime, endTime) {
  const startMin = ((h, m) => h * 60 + m)(...(startTime || '00:00').split(':').map(Number));
  const endMin = ((h, m) => h * 60 + m)(...(endTime || '00:00').split(':').map(Number));
  if (nowMin < startMin - EARLY_WINDOW) {
    return `开课前 ${EARLY_WINDOW} 分钟开始可签到（${startTime} 开课）`;
  }
  if (nowMin > endMin + LATE_WINDOW) {
    return `课程已结束超过 ${LATE_WINDOW} 分钟，无法签到`;
  }
  return '';
}

module.exports = { EARLY_WINDOW, LATE_WINDOW, inCheckinWindow, windowHint };
