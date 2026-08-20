/**
 * server/db/schedule.js —— 排课发布节奏（DESIGN #D10）
 * 运营约定：每周五 22:00 发布下周（周六 ~ 下周五）课表（手动排课，系统不自动生成）。
 * 本模块只计算「下一次发布日」——纯函数，测试可注入任意时刻直连断言边界。
 *
 * 时间口径：time.js 显式北京时间（BUG-LEDGER #28，UTC 容器不依赖系统时区）。
 */

const time = require('../time');

const PAD = (n) => String(n).padStart(2, '0');

/**
 * 下一次课表发布日 = 最近的未来周五 22:00（北京时间）
 * 规则：今天(now) ≤ 本周五 22:00 → 本周五；今天(now) > 本周五 22:00 → 下周五
 * @param {Date} [now] 任意时刻（测试注入；默认服务器当前时间）
 * @returns {{ nextPublish: string, text: string, display: string }}
 *   nextPublish 'YYYY-MM-DD'（本周五/下周五）
 *   text 展示文案：同年 '8月21日'；跨年（目标在明年 1 月）'2027年1月8日'
 *   display 'YYYY-MM-DD 22:00'（完整时间串，前端可直接展示）
 */
function nextPublishInfo(now = new Date()) {
  const p = time.parts(now);
  const today = `${p.y}-${PAD(p.mo)}-${PAD(p.d)}`;
  // 0=周日..6=周六；到本周五的天数（今天周五=0）
  const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  const toFriday = (5 - dow + 7) % 7;
  const passed = dow === 5 && p.h >= 22;   // 周五且已过 22:00 → 下次是下周五
  const target = time.addDaysStr(today, passed ? toFriday + 7 : toFriday);

  const [ty, tmo, td] = target.split('-').map(Number);
  const text = ty === p.y ? `${tmo}月${td}日` : `${ty}年${tmo}月${td}日`;
  return { nextPublish: target, text, display: `${target} 22:00` };
}

module.exports = { nextPublishInfo };
