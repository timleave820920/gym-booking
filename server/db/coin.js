/**
 * 能量币域（coin）：获取规则、流水、商店兑换、奖励发放
 */
const { db } = require('../db-core');
const { findUserByOpenid } = require('./users');
const ENERGY_CONFIG = require('../energy-config.js');
const SHOP_ITEMS = require('../shop-items.js');

function todayCoinsEarned(openid) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(change), 0) s FROM coin_logs
    WHERE user_openid = ? AND change > 0
      AND date(created_at) = date('now','localtime')
  `).get(openid);
  return row.s;
}

/**
 * 发放能量币（含每日上限校验）
 * @returns {number|null} 变动后余额；超限返回 null
 */
function addCoins(openid, change, reason, refId) {
  const user = findUserByOpenid(openid);
  if (!user) return null;
  if (change <= 0) return user.coin_balance || 0;
  const limit = ENERGY_CONFIG.dailyLimit || 0;
  if (limit > 0 && todayCoinsEarned(openid) + change > limit) {
    // 超每日上限：按剩余额度发放
    const remain = limit - todayCoinsEarned(openid);
    if (remain <= 0) return null;
    change = remain;
  }
  const after = (user.coin_balance || 0) + change;
  db.prepare('UPDATE users SET coin_balance = ? WHERE openid = ?').run(after, openid);
  db.prepare(`INSERT INTO coin_logs (user_openid, change, balance_after, reason, ref_id)
              VALUES (?, ?, ?, ?, ?)`)
    .run(openid, change, after, reason, refId || '');
  return after;
}

/** 查询能量币余额 + 今日获取 */
function getCoinInfo(openid) {
  const user = findUserByOpenid(openid);
  if (!user) return null;
  return {
    openid,
    balance: user.coin_balance || 0,
    todayEarned: todayCoinsEarned(openid),
    dailyLimit: ENERGY_CONFIG.dailyLimit || 0
  };
}

/** 能量币流水 */
function listCoinLogs(openid, limit = 50) {
  return db.prepare(`
    SELECT id, change, balance_after, reason, ref_id, created_at
    FROM coin_logs WHERE user_openid = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(openid, limit);
}

/** 商店奖品列表（含库存与已兑换数） */
function listShopItems(openid) {
  return SHOP_ITEMS.map(item => {
    const exchanged = db.prepare('SELECT COUNT(*) c FROM coin_exchanges WHERE item_id = ?').get(item.id).c;
    const stockLeft = item.stock < 0 ? -1 : Math.max(item.stock - exchanged, 0);
    return {
      ...item,
      stockLeft,
      soldOut: item.stock >= 0 && stockLeft <= 0
    };
  });
}

/**
 * 兑换奖品
 * @param {object} p { openid, itemId }
 * @returns {{ok:true, exchange:object}|{ok:false, error:string}}
 */
function exchangeCoinItem({ openid, itemId }) {
  const user = findUserByOpenid(openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return { ok: false, error: '奖品不存在' };

  // 库存校验
  const exchanged = db.prepare('SELECT COUNT(*) c FROM coin_exchanges WHERE item_id = ?').get(item.id).c;
  if (item.stock >= 0 && exchanged >= item.stock) return { ok: false, error: '奖品已兑完' };

  // 余额校验
  const balance = user.coin_balance || 0;
  if (balance < item.cost) return { ok: false, error: `能量币不足，还需 ${item.cost - balance} 币` };

  db.exec('BEGIN');
  try {
    const after = balance - item.cost;
    db.prepare('UPDATE users SET coin_balance = ? WHERE openid = ?').run(after, openid);
    db.prepare(`INSERT INTO coin_logs (user_openid, change, balance_after, reason, ref_id)
                VALUES (?, ?, ?, '兑换奖品', ?)`)
      .run(openid, -item.cost, after, item.id);
    // 虚拟奖品生成兑换码
    let code = null;
    if (item.type === 'virtual') {
      code = 'CD' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    }
    const r = db.prepare(`INSERT INTO coin_exchanges (user_openid, item_id, item_name, cost, code, status)
                          VALUES (?, ?, ?, ?, ?, 'pending')`)
      .run(openid, item.id, item.name, item.cost, code);
    const exchange = db.prepare('SELECT * FROM coin_exchanges WHERE id = last_insert_rowid()').get();
    db.exec('COMMIT');
    return { ok: true, exchange };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 我的兑换记录 */
function listMyExchanges(openid) {
  return db.prepare(`
    SELECT id, item_id, item_name, cost, code, status, created_at
    FROM coin_exchanges WHERE user_openid = ? ORDER BY created_at DESC, id DESC
  `).all(openid);
}

/** 升级检测：返回本次升级奖励（登录/查询时对比 oldLv/newLv） */
function checkLevelUpReward(openid, oldLevel) {
  const cur = getMemberLevel(openid);
  if (!cur || !oldLevel) return null;
  if (cur.levelLv > oldLevel) {
    // 每升一级发一次（多级连升按级数发）
    const times = cur.levelLv - oldLevel;
    const total = ENERGY_CONFIG.earnRules.levelUp * times;
    addCoins(openid, total, `会员升级（${cur.levelName}）`, `LV-${cur.levelLv}`);
    return { level: cur.levelName, coins: total };
  }
  return null;
}

/** 邀请奖励（发储值的同时发能量币） */
function rewardInviterCoins(invitee) {
  const inv = db.prepare("SELECT * FROM invitations WHERE invitee = ? AND status = 'ordered'").get(invitee);
  if (!inv) return null;
  const cnt = db.prepare("SELECT COUNT(*) c FROM invitations WHERE inviter = ? AND status = 'ordered'").get(inv.inviter).c;
  addCoins(inv.inviter, ENERGY_CONFIG.earnRules.invite, `邀请奖励（第${cnt}人）`, `INV-${inv.id}`);
  return { inviter: inv.inviter, coins: ENERGY_CONFIG.earnRules.invite };
}
// ===== 导出 =====
module.exports = { todayCoinsEarned, addCoins, getCoinInfo, listCoinLogs, listShopItems, exchangeCoinItem, listMyExchanges, checkLevelUpReward, rewardInviterCoins };
