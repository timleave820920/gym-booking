/**
 * 客户来源域（DESIGN #D7）：渠道清单配置单源 + 双轨归因 + 漏斗聚合
 * 双轨归因（调研修正 2026-08-20）：
 *  - first-touch（拉新）：users.source，首次归因为准不覆盖——回答「用户是哪个渠道拉来的」
 *  - last-touch（促单）：users.last_channel + 下单时快照 orders.channel_id，30 天保护期——
 *    期内扫码更新，期外不抢（防老用户被渠道码反复拉走刷 KPI）——回答「这笔钱是哪个渠道带来的」
 * 渠道码 = wxacode scene 短码（c1~c9，限 32 字符禁 %/中文），短码恒定名字可改，已印的码不受影响
 */
const { driver } = require('../db-core');
const { findUserByOpenid } = require('./users');
const { batchTrack } = require('./events');
const time = require('../time.js');

// 渠道清单（代码单源；P2 再做后台维护，设计文档已拍板）
const CHANNELS = {
  c1: '小红书',
  c2: '抖音',
  c3: '大众点评',
  c4: '美团',
  c9: '其他'
};

/** last-touch 保护期：30 天（调研修正结论 ⑤） */
const CHANNEL_TOUCH_WINDOW_MS = 30 * 24 * 3600 * 1000;

function isValidChannel(code) {
  return !!(code && CHANNELS[code]);
}

/**
 * 渠道归因（login 带 channel / claim 扫码归因共用入口）
 * @param {string} openid
 * @param {string} channel 渠道短码（c1~c9）
 * @param {string} [batch] 投放批次（同渠道不同内容，运营自命名）
 * @returns {{ok:boolean, error?:string}}
 */
async function applyChannelAttribution(openid, channel, batch = '') {
  if (!isValidChannel(channel)) return { ok: false, error: '未知渠道码' };
  const user = await findUserByOpenid(openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  const sets = [];
  const params = [];
  // first-touch：source 为空才写（首次为准，含批次；已有不覆盖，防渠道码混用刷归因）
  if (!user.source) {
    sets.push('source = ?', 'channel_batch = ?');
    params.push(channel, String(batch || '').slice(0, 50));
  }
  // last-touch：30 天保护期（从未归因或距上次 ≤30 天 → 更新并刷新保护期；期外不抢）
  const lastAt = user.last_channel_at;
  const withinWindow = !lastAt || (Date.now() - time.parseBeijing(lastAt).getTime()) <= CHANNEL_TOUCH_WINDOW_MS;
  if (withinWindow) {
    sets.push('last_channel = ?', 'last_channel_at = ?');
    params.push(channel, time.nowDateTimeStr());
  }
  if (sets.length) {
    params.push(openid);
    await driver.run(`UPDATE users SET ${sets.join(', ')} WHERE openid = ?`, params);
  }
  // channel_open 事件（漏斗「打开」计数，PV 口径：每次扫码记一次；keyword 存批次）
  await batchTrack(openid, [{ event_type: 'channel_open', source: channel, keyword: String(batch || '').slice(0, 50) }]);
  return { ok: true };
}

/**
 * 渠道漏斗聚合（web 运营看板「客户来源」）
 * 口径（与 eventsAnalysis 同源字符串比较，created_at 时区口径一致）：
 *  - opens 打开：channel_open 事件数（PV）
 *  - regs 注册：窗口内建档（users.created_at）且 source 非空
 *  - firstOrders 首订：该渠道用户中窗口内成交单（paid/refunded）≥1 的去重用户数
 *  - repeatOrders 复购：成交单 ≥2 的去重用户数
 *  - 转化率小数（前端渲染 %）；未归因行 = source 为空的窗口内成交用户
 *  - batches 批次明细：按 channel_batch 聚合（注册 + 成交买家）
 * @param {number} days 统计窗口（默认 30）
 */
async function sourceAnalysis(days = 30) {
  // addDaysStr 正数=未来 → 窗口起点取过去 N 天（否则 created_at >= 未来恒 false，全 0）
  const since = time.addDaysStr(time.todayStr(), -(Number(days) || 30));
  const rows = [];
  for (const [code, name] of Object.entries(CHANNELS)) {
    const opens = Number((await driver.get(
      "SELECT COUNT(*) c FROM course_events WHERE event_type = 'channel_open' AND source = ? AND created_at >= ?",
      [code, since])).c);
    const regs = Number((await driver.get(
      'SELECT COUNT(*) c FROM users WHERE `source` = ? AND created_at >= ?', [code, since])).c);
    const firstOrders = Number((await driver.get(
      `SELECT COUNT(DISTINCT u.openid) c FROM users u JOIN orders o ON o.user_openid = u.openid
       WHERE u.\`source\` = ? AND o.status IN ('paid','refunded') AND o.created_at >= ?`,
      [code, since])).c);
    const repeatOrders = Number((await driver.get(
      `SELECT COUNT(*) c FROM (
         SELECT u.openid FROM users u JOIN orders o ON o.user_openid = u.openid
         WHERE u.\`source\` = ? AND o.status IN ('paid','refunded') AND o.created_at >= ?
         GROUP BY u.openid HAVING COUNT(*) >= 2) t`,
      [code, since])).c);
    rows.push({
      code,
      name,
      opens,
      regs,
      regRate: opens ? +(regs / opens).toFixed(3) : 0,          // 打开→注册
      firstOrders,
      repeatOrders,
      firstRate: regs ? +(firstOrders / regs).toFixed(3) : 0,   // 注册→首订
      repeatRate: firstOrders ? +(repeatOrders / firstOrders).toFixed(3) : 0 // 首订→复购
    });
  }
  // 未归因：无渠道的用户（有成交才计入，防止「未归因」数被零下单用户灌水）
  const unattributed = Number((await driver.get(
    `SELECT COUNT(DISTINCT u.openid) c FROM users u JOIN orders o ON o.user_openid = u.openid
     WHERE (u.\`source\` = '' OR u.\`source\` IS NULL) AND o.status IN ('paid','refunded') AND o.created_at >= ?`,
    [since])).c);
  // 批次明细（按批次聚合：注册 + 成交买家，运营判断哪条内容有效）
  const batches = await driver.all(
    `SELECT u.channel_batch AS batch, u.\`source\` AS channel, COUNT(DISTINCT u.openid) AS regs,
            COUNT(DISTINCT CASE WHEN o.id IS NOT NULL THEN u.openid END) AS buyers
     FROM users u LEFT JOIN orders o ON o.user_openid = u.openid AND o.status IN ('paid','refunded')
     WHERE u.channel_batch <> '' AND u.created_at >= ?
     GROUP BY u.channel_batch, u.\`source\` ORDER BY regs DESC`,
    [since]);
  return { days, rows, unattributed, batches };
}

module.exports = { CHANNELS, isValidChannel, applyChannelAttribution, sourceAnalysis };
