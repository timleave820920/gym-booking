/**
 * 按时段问候词（共享工具，BUG-LEDGER 项目审查 P0-1a）
 * 统一入口：所有页面的问候词判定集中在此，避免多处重复不一致。
 *
 * 用法：
 *   const { getGreeting } = require('../../utils/greeting');
 *   const word = getGreeting();           // 返回当前时段中文问候
 *   const word = getGreeting(i18n.t());   // 传入字典时返回中英对应
 */
const i18n = require('./i18n.js');

/**
 * 根据当前北京时间返回时段问候词
 * @param {Object} [t] - i18n 字典（不传则取默认中文）
 * @returns {string}
 */
function getGreeting(t) {
  if (!t) t = i18n.t();
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return t.greetingMorning;
  if (hour >= 12 && hour < 13) return t.greetingNoon;
  if (hour >= 13 && hour < 18) return t.greetingAfternoon;
  if (hour >= 18 && hour < 22) return t.greetingEvening;
  return t.greetingLate; // 22:00 - 次日 6:00
}

module.exports = { getGreeting };
