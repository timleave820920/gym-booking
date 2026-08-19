/**
 * 次卡包域（限时次卡包 · 单卡累加模式）
 * 设计依据：次卡包设计方案 v2（D1-D10 已批复）
 * 规则：
 *  - 每用户逻辑上只有 1 张卡；重复购买累加次数 + 顺延作废日期
 *  - 订课/候补支付顺序：次卡 → 余额 → 微信（后端强制，不可跳过）
 *  - 退订对称退次；退时卡已过期 → 次数作废清理（D2/D3）
 */
const { db, driver } = require('../db-core');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）

// ===== 档位种子（可配置：数据库里增改，前端动态读取）=====
// ⚠️ 必须先 await driver.ready：本 IIFE 在模块加载时即执行（require('./db') 链路），
// MySQL 模式建表是异步门闩（driver.ready），不等则查表报 ER_NO_SUCH_TABLE 崩溃
// （2026-08-17 生产 CrashLoop 根因：seed.js 的 await 在 require 之后，拦不住模块加载期的查询）
(async function seedPackages() {
  await driver.ready; // 自守门闩：SQLite 模式立即返回，MySQL 模式等 20 表建完
  const rows = (await driver.get('SELECT COUNT(*) c FROM class_packages')).c;
  if (rows === 0) {
    // `desc` 加反引号：MySQL 保留字（SQLite 无碍，双方言兼容写法）
    await driver.run('INSERT INTO class_packages (name, total_count, valid_days, price_fen, `desc`) VALUES (?,?,?,?,?)', ['12次', 12, 60, 90000, '60 天内有效，逾期剩余次数作废；可与已有次卡叠加次数并顺延有效期']);
    await driver.run('INSERT INTO class_packages (name, total_count, valid_days, price_fen, `desc`) VALUES (?,?,?,?,?)', ['24次', 24, 120, 180000, '120 天内有效，逾期剩余次数作废；可与已有次卡叠加次数并顺延有效期']);
  }
  // 档位改名迁移（2026-08-19 用户拍板：12次包→12次、24次包→24次；老库数据同步，幂等 0 行安全）
  await driver.run("UPDATE class_packages SET name = '12次' WHERE name = '12次包'");
  await driver.run("UPDATE class_packages SET name = '24次' WHERE name = '24次包'");
})();

/** 可售档位列表 */
async function listPassPackages() {
  return await driver.all("SELECT id, name, total_count, valid_days, price_fen, `desc` FROM class_packages WHERE active = 1 ORDER BY price_fen");
}

/** 当前有效次卡（active 且未过期且剩余>0；无则 null） */
async function getUserPass(openid) {
  // 当前时刻显式传北京字符串（time.js），不依赖 SQLite 系统时区（BUG-LEDGER #28）
  return await driver.get(`
    SELECT * FROM user_passes
    WHERE user_openid = ? AND status = 'active' AND remaining > 0 AND expires_at > ?
    ORDER BY expires_at LIMIT 1
  `, [openid, time.nowDateTimeStr()]) || null;
}

/** 按上课日期判断次卡可用：卡必须覆盖上课日（date(expires_at) >= 课程日期）
 *  —— 卡今天过期 → 不能预订明天及以后场次；无 date 时退化为当前时刻判断（兼容） */
async function getUserPassForDate(openid, date) {
  const params = [openid, time.nowDateTimeStr()];
  let cond = "AND expires_at > ?";
  if (date) {
    cond += " AND date(expires_at) >= date(?)";
    params.push(date);
  }
  return await driver.get(`
    SELECT * FROM user_passes
    WHERE user_openid = ? AND status = 'active' AND remaining > 0 ${cond}
    ORDER BY expires_at LIMIT 1
  `, [...params]) || null;
}

/** 当前卡完整信息（含已过期标记，供展示；过期卡也返回，status 由 expired 标志表达） */
async function getUserPassInfo(openid) {
  const pass = await driver.get("SELECT * FROM user_passes WHERE user_openid = ? ORDER BY id DESC LIMIT 1", [openid]);
  if (!pass) return { hasPass: false };
  // 过期判定：expires_at 是北京时间字符串 → parseBeijing 统一换算绝对时刻，与系统时区无关（BUG-LEDGER #28）
  const nowTs = Date.now();
  const exp = time.parseBeijing(pass.expires_at).getTime();
  const daysLeft = Math.max(0, Math.ceil((exp - nowTs) / 864e5));
  const expired = pass.status !== 'active' || exp <= nowTs;
  return {
    hasPass: true,
    id: pass.id,
    remaining: pass.remaining,
    total: pass.total_count,
    expiresAt: pass.expires_at,
    daysLeft,
    expired
  };
}

/** 内部：到期 23:59:59 格式化（北京时间当天 23:59:59，显式时区 BUG-LEDGER #28） */
function expiryAt(d) {
  const p = time.parts(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} 23:59:59`;
}

/**
 * 购买发卡（单卡累加模式）
 * ⚠️ 由 payOrder 在其事务内调用（不在此开事务，避免嵌套）；单条 SQL 原子
 * @returns {{ok:true, pass:object, added:number}|{ok:false,error:string}}
 */
async function applyPassPurchase({ openid, orderId, packageId }) {
  const pkg = await driver.get('SELECT * FROM class_packages WHERE id = ? AND active = 1', [packageId]);
  if (!pkg) return { ok: false, error: '无效的次卡套餐' };
  const cur = await driver.get("SELECT * FROM user_passes WHERE user_openid = ? AND status = 'active' AND expires_at > ? ORDER BY id DESC LIMIT 1", [openid, time.nowDateTimeStr()]);
  let pass;
  if (cur) {
    // 有有效卡 → 累加次数 + 顺延作废日期（剩 N 天买 M 天 → 作废期 = 原作废期 + M 天）
    const base = time.parseBeijing(cur.expires_at);
    const newExp = expiryAt(new Date(base.getTime() + pkg.valid_days * 864e5));
    await driver.run('UPDATE user_passes SET remaining = remaining + ?, total_count = total_count + ?, expires_at = ?, order_id = ? WHERE id = ?', [pkg.total_count, pkg.total_count, newExp, orderId, cur.id]);
    pass = await driver.get('SELECT * FROM user_passes WHERE id = ?', [cur.id]);
  } else {
    // 无有效卡 → 从购买日重算
    const exp = expiryAt(new Date(Date.now() + pkg.valid_days * 864e5));
    const r = await driver.run(`INSERT INTO user_passes (user_openid, order_id, total_count, remaining, expires_at, status)
                VALUES (?, ?, ?, ?, ?, 'active')`, [openid, orderId, pkg.total_count, pkg.total_count, exp]);
    pass = await driver.get('SELECT * FROM user_passes WHERE id = ?', [r.lastInsertRowid]);
  }
  return { ok: true, pass, added: pkg.total_count };
}

/**
 * 扣次（订课/候补支付时，事务内调用）
 * @returns {number|null} pass_id（无可用次卡返回 null）
 */
async function consumePass(openid) {
  const pass = await getUserPass(openid);
  if (!pass) return null;
  await driver.run('UPDATE user_passes SET remaining = remaining - 1 WHERE id = ? AND remaining > 0', [pass.id]);
  return pass.id;
}

/**
 * 退次（退订/退出候补对称退款；卡已过期 → 次数作废清理）
 * @returns {'refunded'|'expired'|'none'}
 */
async function refundPass(passId) {
  if (!passId) return 'none';
  const pass = await driver.get('SELECT * FROM user_passes WHERE id = ?', [passId]);
  if (!pass) return 'none';
  const nowStr = time.nowDateTimeStr();
  if (pass.status !== 'active' || String(pass.expires_at) <= nowStr) {
    // 卡已过期 → 作废清理
    await driver.run("UPDATE user_passes SET status = 'expired' WHERE id = ?", [passId]);
    return 'expired';
  }
  await driver.run('UPDATE user_passes SET remaining = remaining + 1 WHERE id = ?', [passId]);
  return 'refunded';
}

/** 过期任务：把已过期的卡标记 expired（返回过期卡数；用于消息通知） */
async function expireOverduePasses() {
  const rows = await driver.all("SELECT id FROM user_passes WHERE status = 'active' AND expires_at <= ?", [time.nowDateTimeStr()]);
  for (const r of rows) await driver.run("UPDATE user_passes SET status = 'expired' WHERE id = ?", [r.id]);
  return rows.length;
}

module.exports = {
  listPassPackages,
  getUserPass,
  getUserPassForDate,
  getUserPassInfo,
  applyPassPurchase,
  consumePass,
  refundPass,
  expireOverduePasses
};
