/**
 * 课程卡片排序（BUG-LEDGER #36）
 * 纯函数模块，便于 minitest 直接 require 断言（无 wx 依赖）。
 *
 * 规则（用户要求）：
 * - 待上课：按 (date, start_time) 升序 —— 最近要开始的排最前，越远越靠后
 * - 已完成：按 (date, end_time) 降序 —— 刚刚结束的排最前，很久以前的排最后
 */

/** 待上课排序：日期+开始时间升序（最近先来） */
function sortUpcoming(list) {
  return (list || []).slice().sort((a, b) =>
    (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time));
}

/** 已完成排序：日期+结束时间降序（刚结束在前） */
function sortCompleted(list) {
  return (list || []).slice().sort((a, b) =>
    (b.date + ' ' + b.end).localeCompare(a.date + ' ' + a.end));
}

module.exports = { sortUpcoming, sortCompleted };
