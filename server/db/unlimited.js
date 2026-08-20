/**
 * 季卡/年卡域（DESIGN #D14）：有效期内无限次订课 0 元，同一时间只能订一堂课
 * 规则：
 *  - 单用户逻辑单卡：最新一条 active 且未过期 = 当前卡；重复购买 → 续期顺延（新卡从旧卡到期次日算起）
 *  - 订课/候补有卡自动用（0 元，pay_source='unlimited'），无需支付选择
 *  - 退订无次数可退：直接释放名额（不退款、不扣卡）
 */
const { db, driver } = require('../db-core');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）

// ===== 档位种子（运营配置：数据库里增改，前端动态读取）=====
// ⚠️ 必须先 await driver.ready（同 passes.js seedPackages，MySQL 建表异步门闩）
(async function seedUnlimitedPlans() {
  await driver.ready;
  const rows = (await driver.get('SELECT COUNT(*) c FROM unlimited_plans')).c;
  if (rows === 0) {
    await driver.run('INSERT INTO unlimited_plans (\`type\`, name, months, price_fen) VALUES (?,?,?,?)', ['season', '季卡', 3, 298000]);
    await driver.run('INSERT INTO unlimited_plans (\`type\`, name, months, price_fen) VALUES (?,?,?,?)', ['year', '年卡', 12, 988000]);
  }
})();

/** 卡档位列表（价格运营配置动态读取） */
async function listUnlimitedPlans() {
  return await driver.all("SELECT id, \`type\`, name, months, price_fen FROM unlimited_plans WHERE active = 1 ORDER BY price_fen");
}

/** 当前有效卡（active 且未过期；无则 null）——北京时间字符串比较（BUG-LEDGER #28） */
async function getMyUnlimitedPass(openid) {
  return await driver.get(`
    SELECT * FROM unlimited_passes
    WHERE user_openid = ? AND status = 'active' AND expires_at > ?
    ORDER BY id DESC LIMIT 1
  `, [openid, time.nowDateTimeStr()]) || null;
}

/** 我的卡完整信息（含已过期标记；无卡返回 hasPass:false） */
async function getMyUnlimitedPassInfo(openid) {
  const pass = await driver.get("SELECT * FROM unlimited_passes WHERE user_openid = ? ORDER BY id DESC LIMIT 1", [openid]);
  if (!pass) return { hasPass: false };
  const nowTs = Date.now();
  const exp = time.parseBeijing(pass.expires_at).getTime();
  const daysLeft = Math.max(0, Math.ceil((exp - nowTs) / 864e5));
  const expired = pass.status !== 'active' || exp <= nowTs;
  return {
    hasPass: true,
    id: pass.id,
    type: pass.type,
    expiresAt: pass.expires_at,
    daysLeft,
    expired
  };
}

/** 内部：+N 个月后 23:59:59 格式化（北京时间，显式时区 BUG-LEDGER #28） */
function expiryInMonths(baseTs, months) {
  const d = new Date(baseTs);
  d.setMonth(d.getMonth() + months);
  const p = time.parts(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} 23:59:59`;
}

/**
 * 购买发卡/续期（由 payOrder 事务内调用，不在此开事务，单条 SQL 原子）
 * 拍板口径（2026-08-19）：旧卡未过期 → 续期顺延（新卡从旧卡到期次日算起 = 旧到期时刻 + months 个月）；
 * 无有效卡/已过期 → 从购买日重算，插新行（逻辑单卡取最新）
 * @returns {{ok:true, pass:object}|{ok:false,error:string}}
 */
async function applyUnlimitedPurchase({ openid, orderId, planId }) {
  const plan = await driver.get('SELECT * FROM unlimited_plans WHERE id = ? AND active = 1', [planId]);
  if (!plan) return { ok: false, error: '无效的卡档位' };
  const cur = await getMyUnlimitedPass(openid);
  let pass;
  if (cur) {
    // 续期顺延：新到期 = 旧到期 + months 个月
    const newExp = expiryInMonths(time.parseBeijing(cur.expires_at).getTime(), plan.months);
    await driver.run('UPDATE unlimited_passes SET expires_at = ?, order_id = ? WHERE id = ?', [newExp, orderId, cur.id]);
    pass = await driver.get('SELECT * FROM unlimited_passes WHERE id = ?', [cur.id]);
  } else {
    const exp = expiryInMonths(Date.now(), plan.months);
    const r = await driver.run(`INSERT INTO unlimited_passes (user_openid, \`type\`, order_id, start_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?, 'active')`, [openid, plan.type, orderId, time.nowDateTimeStr().slice(0, 10), exp]);
    pass = await driver.get('SELECT * FROM unlimited_passes WHERE id = ?', [r.lastInsertRowid]);
  }
  return { ok: true, pass };
}

/** 有有效无限卡？——订课/候补 0 元判定（payOrder 事务内调用） */
async function hasUnlimitedPass(openid) {
  return !!(await getMyUnlimitedPass(openid));
}

/** 过期任务：把已过期卡标记 expired（返回过期卡数） */
async function expireOverdueUnlimitedPasses() {
  const rows = await driver.all("SELECT id FROM unlimited_passes WHERE status = 'active' AND expires_at <= ?", [time.nowDateTimeStr()]);
  for (const r of rows) await driver.run("UPDATE unlimited_passes SET status = 'expired' WHERE id = ?", [r.id]);
  return rows.length;
}

module.exports = {
  listUnlimitedPlans,
  getMyUnlimitedPass,
  getMyUnlimitedPassInfo,
  applyUnlimitedPurchase,
  hasUnlimitedPass,
  expireOverdueUnlimitedPasses
};
