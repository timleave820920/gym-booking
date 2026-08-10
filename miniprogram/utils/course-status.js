/**
 * 课程状态工具（今日/本周/详情页共用）
 *
 * 状态规则（考虑场次日期）：
 *   - 场次日期 > 今天          → upcoming（未开始，可约）
 *   - 场次日期 < 今天          → ended（已结束）
 *   - 日期 = 今天：
 *       now < start            → upcoming（未开始，可约）
 *       start <= now < end     → ongoing（进行中，不可约）
 *       now >= end             → ended（已结束）
 */

/**
 * 判断场次状态
 * @param {string} date      场次日期 YYYY-MM-DD
 * @param {string} startTime 开始时间 HH:mm
 * @param {string} endTime   结束时间 HH:mm
 * @param {Date} [now]       可选，测试用
 * @returns {'upcoming'|'ongoing'|'ended'}
 */
function getSessionStatus(date, startTime, endTime, now) {
  const n = now || new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;

  if (date > today) return 'upcoming';      // 未来的日期，未开始
  if (date < today) return 'ended';          // 过去的日期，已结束

  // 当天：按时间判断
  const [sh, sm] = (startTime || '00:00').split(':').map(Number);
  const [eh, em] = (endTime || '00:00').split(':').map(Number);
  const start = new Date(n.getFullYear(), n.getMonth(), n.getDate(), sh, sm, 0);
  const end = new Date(n.getFullYear(), n.getMonth(), n.getDate(), eh, em, 0);
  if (n < start) return 'upcoming';
  if (n < end) return 'ongoing';
  return 'ended';
}

/**
 * 根据状态生成按钮文案 key（i18n）
 * ongoing → '进行中' / ended → '已结束' / upcoming → 价格+约课（页面自己处理）
 */
function statusBtnTextKey(status) {
  if (status === 'ongoing') return 'ongoing';
  if (status === 'ended') return 'ended';
  return 'book';
}

module.exports = {
  getSessionStatus,
  statusBtnTextKey
};
