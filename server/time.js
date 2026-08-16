/**
 * server/time.js —— 服务器「当前时间」唯一取值入口（北京时间）
 *
 * 为什么存在（BUG-LEDGER #28）：云托管容器 node:22-alpine 默认系统时区为 UTC，
 * 裸用 new Date().getHours()/getFullYear()/toLocaleString('sv-SE') 等隐式依赖
 * 系统时区的写法，在容器里北京时间会差 8 小时——签到窗口判定「时间未到」、
 * 次卡/候补过期判定全部错位，而本地测试（Windows 北京时间）发现不了。
 *
 * 本模块用 Intl 显式指定 Asia/Shanghai，与容器系统时区无关（双保险：
 * Dockerfile 另已固定 TZ=Asia/Shanghai，保证 SQLite datetime('now','localtime')
 * 写入值也为北京时间）。
 *
 * 强制规矩（CONVENTIONS.md C4）：业务代码取「当前时间」必须走本模块；
 * 禁止裸 new Date().getHours()/getMinutes()/getFullYear()/toLocaleString('sv-SE')；
 * SQL 中与 datetime('now','localtime') 比较时用 nowDateTimeStr() 显式传参，
 * 不依赖 SQLite 的系统时区。
 */
const TZ = 'Asia/Shanghai';

const pad = (n) => String(n).padStart(2, '0');

/** 北京时间各部件（Intl 显式时区，任意系统时区下结果一致） */
function parts(date = new Date()) {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const get = (type) => Number(p.find((x) => x.type === type).value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** 北京时间今天 'YYYY-MM-DD' */
function todayStr() {
  const p = parts();
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** 北京时间当前时刻 'HH:MM:SS'（date 可传任意 Date，默认现在） */
function nowTimeStr(date = new Date()) {
  const p = parts(date);
  return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** 北京时间当前时刻 'YYYY-MM-DD HH:MM:SS'（与 SQLite datetime('now','localtime') 同格式） */
function nowDateTimeStr() {
  const p = parts();
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** 北京时间当前分钟数（0-1439，签到窗口等按分钟判定用） */
function nowMin() {
  const p = parts();
  return p.h * 60 + p.mi;
}

/** 解析北京时间字符串 'YYYY-MM-DD HH:MM:SS' → 绝对时刻 Date（UTC 时间戳，与系统时区无关） */
function parseBeijing(str) {
  const [d, t = '00:00:00'] = String(str).split(' ');
  const [y, mo, dd] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, dd, h - 8, mi, s));
}

/** 'YYYY-MM-DD' 前一天（用 Date.UTC 运算，无时区问题） */
function prevDateStr(s) {
  const [y, mo, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d - 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

module.exports = { TZ, parts, todayStr, nowTimeStr, nowDateTimeStr, nowMin, parseBeijing, prevDateStr };
