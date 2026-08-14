/**
 * 会员域（members）：等级、余额、充值套餐与赠送、退款、未读流水
 */
const { db } = require('../db-core');
const { findUserByOpenid } = require('./users');
const { addCoins } = require('./coin');
const ENERGY_CONFIG = require('../energy-config.js');
const SHOP_ITEMS = require('../shop-items.js');

const MEMBER_CONFIG = require('../member-config.js');
const LEVELS = MEMBER_CONFIG.levels;
const RECHARGE_PLANS = MEMBER_CONFIG.rechargePlans;
const INVITE_REWARDS = MEMBER_CONFIG.inviteRewards;

/** 计算会员等级信息 */
function getMemberLevel(openid) {
  const user = findUserByOpenid(openid);
  if (!user) return null;
  const total = user.total_classes || 0;
  let level = LEVELS[0];
  for (const l of LEVELS) {
    if (total >= l.min) level = l;
  }
  // 升级检测：等级提升 → 发能量币 + 更新 level_lv
  const oldLv = user.level_lv || 1;
  if (level.lv > oldLv) {
    const times = level.lv - oldLv;
    const coins = (ENERGY_CONFIG.earnRules.levelUp || 0) * times;
    if (coins > 0) addCoins(openid, coins, `会员升级（${level.name}）`, `LV-${level.lv}`);
    db.prepare('UPDATE users SET level_lv = ? WHERE openid = ?').run(level.lv, openid);
  } else if (level.lv < oldLv) {
    // 等级只升不降（配置调整场景兜底）
    db.prepare('UPDATE users SET level_lv = ? WHERE openid = ?').run(level.lv, openid);
  }
  const idx = LEVELS.indexOf(level);
  const next = LEVELS[idx + 1] || null;
  // 等级图标（奖牌表达，从配置读取：青铜🥉 白银🥈 黄金🥇 钻石💎）
  const style = MEMBER_CONFIG.levelStyles.find(s => s.name === level.name);
  return {
    openid,
    totalClasses: total,
    levelName: level.name,
    levelLv: level.lv,
    levelIcon: style ? style.icon : '🏅',
    discount: level.discount,
    levelMin: level.min,
    next: next ? { name: next.name, min: next.min, discount: next.discount } : null,
    progress: next ? Math.min(100, Math.round((total - level.min) / (next.min - level.min) * 100)) : 100,
    created_at: user.created_at || '',
    memberDays: user.created_at ? Math.max(0, Math.floor((Date.now() - new Date(String(user.created_at).replace(' ', 'T')).getTime()) / 864e5)) : 0,
    balanceFen: user.balance_fen || 0,
    coinBalance: user.coin_balance || 0
  };
}

/** 余额流水（写 balance_logs + 更新余额） */
function addBalance(openid, changeFen, reason, refId) {
  const user = findUserByOpenid(openid);
  if (!user) return null;
  const balanceAfter = (user.balance_fen || 0) + changeFen;
  db.prepare('UPDATE users SET balance_fen = ? WHERE openid = ?').run(balanceAfter, openid);
  db.prepare(`INSERT INTO balance_logs (user_openid, change_fen, balance_after, reason, ref_id, read_flag)
              VALUES (?, ?, ?, ?, ?, 0)`)
    .run(openid, changeFen, balanceAfter, reason, refId || '');
  return balanceAfter;
}

/**
 * 订单退款：把实付金额退回用户
 * - 余额支付 → 退回储值余额（写流水）
 * - 微信支付 → 原路退回（当前为模拟支付，仅标记退款状态，不改余额）
 * @param {number} orderId 必须是已 refunded 的订单
 */
function refundOrderMoney(orderId) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'refunded'").get(orderId);
  if (!o) return;
  if (o.pay_method === 'balance' && (o.amount_fen || 0) > 0) {
    addBalance(o.user_openid, o.amount_fen, '订课退款', o.order_no);
  }
}

// ===== 能量币系统（获取/流水/兑换）=====
// 配置从 energy-config.js 读取（唯一数据源）

/** 今日已获取能量币（防刷上限） */

/** 判断用户是否已充值过该档位（金额相同即视为同档） */
function hasRechargedPlan(openid, amountFen) {
  const row = db.prepare("SELECT id FROM member_recharges WHERE user_openid = ? AND amount_fen = ?").get(openid, amountFen);
  return !!row;
}

/** 计算充值赠送：每档首充 firstBonusRate / 复充 repeatBonusRate */
function calcRechargeBonus(openid, amountFen) {
  const plan = RECHARGE_PLANS.find(p => p.amount === amountFen);
  if (!plan) return { plan: null, bonus: 0, isFirst: false };
  const isFirst = !hasRechargedPlan(openid, amountFen);
  const rate = isFirst ? plan.firstBonusRate : plan.repeatBonusRate;
  return { plan, bonus: Math.round(amountFen * rate), isFirst };
}

/** 充值（订单支付后调用） */
function applyRecharge({ user_openid, order_id, amount_fen, bonus_fen }) {
  const rechargeNo = 'RC' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  db.prepare(`INSERT INTO member_recharges (recharge_no, user_openid, order_id, amount_fen, bonus_fen, status)
              VALUES (?, ?, ?, ?, ?, 'paid')`)
    .run(rechargeNo, user_openid, order_id, amount_fen, bonus_fen);
  addBalance(user_openid, amount_fen + bonus_fen, '充值', rechargeNo);
  // 能量币：每充 ¥100 → 50 币（按充值金额折算，不送的部分不计）
  const coinRate = ENERGY_CONFIG.earnRules.recharge || 0;   // 每 100 元
  if (coinRate > 0 && amount_fen >= 10000) {
    const coins = Math.floor(amount_fen / 10000) * coinRate;
    addCoins(user_openid, coins, '充值奖励', rechargeNo);
  }
  return { rechargeNo, total: amount_fen + bonus_fen };
}

/** 查询充值记录（分页：offset/limit，附带每条是否该档首充） */
function listRecharges(openid, offset = 0, limit = 10) {
  const list = db.prepare(`
    SELECT id, recharge_no, amount_fen, bonus_fen, status, created_at
    FROM member_recharges WHERE user_openid = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(openid, limit, offset);
  return list.map(r => {
    // 同档（金额相同）更早的记录数 = 0 → 首充
    const earlier = db.prepare('SELECT COUNT(*) c FROM member_recharges WHERE user_openid = ? AND amount_fen = ? AND id < ?')
      .get(openid, r.amount_fen, r.id).c;
    return { ...r, is_first: earlier === 0 };
  });
}

/** 邀请明细：某邀请人带动的所有被邀请人（含昵称/状态/时间） */
function listUnreadBalanceLogs(openid) {
  return db.prepare(`
    SELECT id, change_fen, balance_after, reason, ref_id, created_at
    FROM balance_logs WHERE user_openid = ? AND read_flag = 0 AND change_fen > 0
    ORDER BY created_at DESC
  `).all(openid);
}

/** 标记奖励已读 */
function markBalanceLogsRead(openid) {
  db.prepare("UPDATE balance_logs SET read_flag = 1 WHERE user_openid = ? AND read_flag = 0").run(openid);
}

/**
 * 查询用户总数（统计用）
 */

/** 教练列表（下拉选项用） */
// ===== 导出 =====
module.exports = { getMemberLevel, addBalance, refundOrderMoney, hasRechargedPlan, calcRechargeBonus, applyRecharge, listRecharges, listUnreadBalanceLogs, markBalanceLogsRead, LEVELS, RECHARGE_PLANS, INVITE_REWARDS };
