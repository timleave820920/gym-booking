/**
 * 次卡包域（限时次卡包 · 单卡累加模式）
 * 设计依据：次卡包设计方案 v2（D1-D10 已批复）
 * 规则：
 *  - 每用户逻辑上只有 1 张卡；重复购买累加次数 + 顺延作废日期
 *  - 订课/候补支付顺序：次卡 → 余额 → 微信（后端强制，不可跳过）
 *  - 退订对称退次；退时卡已过期 → 次数作废清理（D2/D3）
 */
const { db } = require('../db-core');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）

// ===== 档位种子（可配置：数据库里增改，前端动态读取）=====
(function seedPackages() {
  const rows = db.prepare('SELECT COUNT(*) c FROM class_packages').get().c;
  if (rows === 0) {
    const stmt = db.prepare('INSERT INTO class_packages (name, total_count, valid_days, price_fen, desc) VALUES (?,?,?,?,?)');
    stmt.run('12次包', 12, 60, 90000, '60 天内有效，逾期剩余次数作废；可与已有次卡叠加次数并顺延有效期');
    stmt.run('24次包', 24, 120, 180000, '120 天内有效，逾期剩余次数作废；可与已有次卡叠加次数并顺延有效期');
  }
})();

/** 可售档位列表 */
function listPassPackages() {
  return db.prepare("SELECT id, name, total_count, valid_days, price_fen, desc FROM class_packages WHERE active = 1 ORDER BY price_fen").all();
}

/** 当前有效次卡（active 且未过期且剩余>0；无则 null） */
function getUserPass(openid) {
  // 当前时刻显式传北京字符串（time.js），不依赖 SQLite 系统时区（BUG-LEDGER #28）
  return db.prepare(`
    SELECT * FROM user_passes
    WHERE user_openid = ? AND status = 'active' AND remaining > 0 AND expires_at > ?
    ORDER BY expires_at LIMIT 1
  `).get(openid, time.nowDateTimeStr()) || null;
}

/** 按上课日期判断次卡可用：卡必须覆盖上课日（date(expires_at) >= 课程日期）
 *  —— 卡今天过期 → 不能预订明天及以后场次；无 date 时退化为当前时刻判断（兼容） */
function getUserPassForDate(openid, date) {
  const params = [openid, time.nowDateTimeStr()];
  let cond = "AND expires_at > ?";
  if (date) {
    cond += " AND date(expires_at) >= date(?)";
    params.push(date);
  }
  return db.prepare(`
    SELECT * FROM user_passes
    WHERE user_openid = ? AND status = 'active' AND remaining > 0 ${cond}
    ORDER BY expires_at LIMIT 1
  `).get(...params) || null;
}

/** 当前卡完整信息（含已过期标记，供展示；过期卡也返回，status 由 expired 标志表达） */
function getUserPassInfo(openid) {
  const pass = db.prepare("SELECT * FROM user_passes WHERE user_openid = ? ORDER BY id DESC LIMIT 1").get(openid);
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
function applyPassPurchase({ openid, orderId, packageId }) {
  const pkg = db.prepare('SELECT * FROM class_packages WHERE id = ? AND active = 1').get(packageId);
  if (!pkg) return { ok: false, error: '无效的次卡套餐' };
  const cur = db.prepare("SELECT * FROM user_passes WHERE user_openid = ? AND status = 'active' AND expires_at > ? ORDER BY id DESC LIMIT 1").get(openid, time.nowDateTimeStr());
  let pass;
  if (cur) {
    // 有有效卡 → 累加次数 + 顺延作废日期（剩 N 天买 M 天 → 作废期 = 原作废期 + M 天）
    const base = time.parseBeijing(cur.expires_at);
    const newExp = expiryAt(new Date(base.getTime() + pkg.valid_days * 864e5));
    db.prepare('UPDATE user_passes SET remaining = remaining + ?, total_count = total_count + ?, expires_at = ?, order_id = ? WHERE id = ?')
      .run(pkg.total_count, pkg.total_count, newExp, orderId, cur.id);
    pass = db.prepare('SELECT * FROM user_passes WHERE id = ?').get(cur.id);
  } else {
    // 无有效卡 → 从购买日重算
    const exp = expiryAt(new Date(Date.now() + pkg.valid_days * 864e5));
    db.prepare(`INSERT INTO user_passes (user_openid, order_id, total_count, remaining, expires_at, status)
                VALUES (?, ?, ?, ?, ?, 'active')`)
      .run(openid, orderId, pkg.total_count, pkg.total_count, exp);
    pass = db.prepare('SELECT * FROM user_passes WHERE id = last_insert_rowid()').get();
  }
  return { ok: true, pass, added: pkg.total_count };
}

/**
 * 扣次（订课/候补支付时，事务内调用）
 * @returns {number|null} pass_id（无可用次卡返回 null）
 */
function consumePass(openid) {
  const pass = getUserPass(openid);
  if (!pass) return null;
  db.prepare('UPDATE user_passes SET remaining = remaining - 1 WHERE id = ? AND remaining > 0').run(pass.id);
  return pass.id;
}

/**
 * 退次（退订/退出候补对称退款；卡已过期 → 次数作废清理）
 * @returns {'refunded'|'expired'|'none'}
 */
function refundPass(passId) {
  if (!passId) return 'none';
  const pass = db.prepare('SELECT * FROM user_passes WHERE id = ?').get(passId);
  if (!pass) return 'none';
  const nowStr = time.nowDateTimeStr();
  if (pass.status !== 'active' || String(pass.expires_at) <= nowStr) {
    // 卡已过期 → 作废清理
    db.prepare("UPDATE user_passes SET status = 'expired' WHERE id = ?").run(passId);
    return 'expired';
  }
  db.prepare('UPDATE user_passes SET remaining = remaining + 1 WHERE id = ?').run(passId);
  return 'refunded';
}

/** 过期任务：把已过期的卡标记 expired（返回过期卡数；用于消息通知） */
function expireOverduePasses() {
  const rows = db.prepare("SELECT id FROM user_passes WHERE status = 'active' AND expires_at <= ?").all(time.nowDateTimeStr());
  for (const r of rows) db.prepare("UPDATE user_passes SET status = 'expired' WHERE id = ?").run(r.id);
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
