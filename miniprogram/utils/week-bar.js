/**
 * 周日期条生成器（共享工具，BUG-LEDGER 项目审查 P0-1b）
 * 统一入口：今天起 7 天（含今天），过去日期不显示。
 * 替代原先 student-courses / coach-home / coach-profile 三处重复的 buildWeek。
 *
 * 用法：
 *   const { buildWeekDays } = require('../../utils/week-bar');
 *   const days = buildWeekDays();
 *   // days[0] = { weekday: '今天', date: '18', full: '2026-08-18', selected: true }
 */
const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 生成今天起 7 天的日期条数据
 * @returns {Array<{weekday: string, date: string, full: string, selected: boolean}>}
 */
function buildWeekDays() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const full = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    days.push({
      weekday: i === 0 ? '今天' : '周' + WEEK_SHORT[d.getDay()],
      date: pad(d.getDate()),
      full,
      selected: i === 0
    });
  }
  return days;
}

module.exports = { buildWeekDays, WEEK_SHORT };
