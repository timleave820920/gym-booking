/**
 * 课程卡片排序（BUG-LEDGER #36 / BUGS-INBOX #42）
 * 纯函数模块，便于 minitest 直接 require 断言（无 wx 依赖）。
 *
 * 规则（用户要求）：
 * - 待上课：按 (date, start_time) 升序 —— 最近要开始的排最前，越远越靠后
 * - 已完成：按 (date, end_time) 降序 —— 刚刚结束的排最前，很久以前的排最后
 * - 教练工作台（#42）：进行中 → 未开始（越近越前）→ 已结束（刚结束在前）
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

/** 教练工作台排序（BUGS-INBOX #42）：进行中 → 未开始（越近越前）→ 已结束（刚结束在前）。
 *  输入场次需含 status（'ongoing'|'upcoming'|'ended'，course-status.js 判定）与 date/start_time。 */
function sortCoachSessions(list) {
  const rank = { ongoing: 0, upcoming: 1, ended: 2 };
  return (list || []).slice().sort((a, b) => {
    const ra = rank[a.status] !== undefined ? rank[a.status] : 2;
    const rb = rank[b.status] !== undefined ? rank[b.status] : 2;
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      // 已结束：开始时间越晚越前（刚结束的在前）
      return (b.date + ' ' + b.start_time).localeCompare(a.date + ' ' + a.start_time);
    }
    // 进行中/未开始：开始时间越早越前
    return (a.date + ' ' + a.start_time).localeCompare(b.date + ' ' + b.start_time);
  });
}

module.exports = { sortUpcoming, sortCompleted, sortCoachSessions };
