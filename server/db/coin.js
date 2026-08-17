/**
 * 能量币域（coin）：获取规则、流水、商店兑换、奖励发放
 */
const { db, driver } = require('../db-core');
const { findUserByOpenid } = require('./users');
const time = require('../time.js'); // 所有「当前时间」取值唯一入口（北京时间，BUG-LEDGER #28）
const ENERGY_CONFIG = require('../energy-config.js');
const SHOP_ITEMS = require('../shop-items.js');

async function todayCoinsEarned(openid) {
  const row = await driver.get(`
    SELECT COALESCE(SUM(\`change\`), 0) s FROM coin_logs
    WHERE user_openid = ? AND \`change\` > 0
      AND date(created_at) = ?
  `, [openid, time.todayStr()]);
  return row.s;
}

/**
 * 发放能量币（含每日上限校验）
 * @returns {number|null} 变动后余额；超限返回 null
 */
async function addCoins(openid, change, reason, refId, bypassLimit) {
  const user = await findUserByOpenid(openid);
  if (!user) return null;
  if (change <= 0) return user.coin_balance || 0;
  const limit = ENERGY_CONFIG.dailyLimit || 0;
  // bypassLimit=true：不受每日上限限制（成就奖励等长期激励）
  if (!bypassLimit && limit > 0 && await todayCoinsEarned(openid) + change > limit) {
    // 超每日上限：按剩余额度发放
    const remain = limit - await todayCoinsEarned(openid);
    if (remain <= 0) return null;
    change = remain;
  }
  const after = (user.coin_balance || 0) + change;
  await driver.run('UPDATE users SET coin_balance = ? WHERE openid = ?', [after, openid]);
  await driver.run(`INSERT INTO coin_logs (user_openid, \`change\`, balance_after, reason, ref_id)
              VALUES (?, ?, ?, ?, ?)`, [openid, change, after, reason, refId || '']);
  return after;
}

/** 查询能量币余额 + 今日获取 */
async function getCoinInfo(openid) {
  const user = await findUserByOpenid(openid);
  if (!user) return null;
  return {
    openid,
    balance: user.coin_balance || 0,
    todayEarned: await todayCoinsEarned(openid),
    dailyLimit: ENERGY_CONFIG.dailyLimit || 0
  };
}

/** 能量币流水 */
async function listCoinLogs(openid, limit = 50) {
  return await driver.all(`
    SELECT id, \`change\`, balance_after, reason, ref_id, created_at
    FROM coin_logs WHERE user_openid = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `, [openid, limit]);
}

/** 商店奖品列表（含库存与已兑换数） */
async function listShopItems(openid) {
  // 批量查各奖品已兑换数（避免循环内逐条查询）
  const rows = await driver.all('SELECT item_id, COUNT(*) c FROM coin_exchanges GROUP BY item_id');
  const exchangeMap = new Map(rows.map(r => [r.item_id, r.c]));
  return SHOP_ITEMS.map(item => {
    const exchanged = exchangeMap.get(item.id) || 0;
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
async function exchangeCoinItem({ openid, itemId }) {
  const user = await findUserByOpenid(openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return { ok: false, error: '奖品不存在' };

  // 库存校验
  const exchanged = (await driver.get('SELECT COUNT(*) c FROM coin_exchanges WHERE item_id = ?', [item.id])).c;
  if (item.stock >= 0 && exchanged >= item.stock) return { ok: false, error: '奖品已兑完' };

  // 余额校验
  const balance = user.coin_balance || 0;
  if (balance < item.cost) return { ok: false, error: `能量币不足，还需 ${item.cost - balance} 币` };

  await driver.exec('BEGIN');
  try {
    const after = balance - item.cost;
    await driver.run('UPDATE users SET coin_balance = ? WHERE openid = ?', [after, openid]);
    await driver.run(`INSERT INTO coin_logs (user_openid, \`change\`, balance_after, reason, ref_id)
                VALUES (?, ?, ?, '兑换奖品', ?)`, [openid, -item.cost, after, item.id]);
    // 虚拟奖品生成兑换码
    let code = null;
    if (item.type === 'virtual') {
      code = 'CD' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    }
    const r = await driver.run(`INSERT INTO coin_exchanges (user_openid, item_id, item_name, cost, code, status)
                          VALUES (?, ?, ?, ?, ?, 'pending')`, [openid, item.id, item.name, item.cost, code]);
    const exchange = await driver.get('SELECT * FROM coin_exchanges WHERE id = ?', [r.lastInsertRowid]);
    await driver.exec('COMMIT');
    return { ok: true, exchange };
  } catch (e) {
    await driver.exec('ROLLBACK');
    throw e;
  }
}

/** 我的兑换记录 */
async function listMyExchanges(openid) {
  return await driver.all(`
    SELECT id, item_id, item_name, cost, code, status, created_at
    FROM coin_exchanges WHERE user_openid = ? ORDER BY created_at DESC, id DESC
  `, [openid]);
}

/** 升级检测：返回本次升级奖励（登录/查询时对比 oldLv/newLv） */
async function checkLevelUpReward(openid, oldLevel) {
  const cur = await getMemberLevel(openid);
  if (!cur || !oldLevel) return null;
  if (cur.levelLv > oldLevel) {
    // 每升一级发一次（多级连升按级数发）
    const times = cur.levelLv - oldLevel;
    const total = ENERGY_CONFIG.earnRules.levelUp * times;
    await addCoins(openid, total, `会员升级（${cur.levelName}）`, `LV-${cur.levelLv}`);
    return { level: cur.levelName, coins: total };
  }
  return null;
}

/** 邀请奖励（发储值的同时发能量币） */
async function rewardInviterCoins(invitee) {
  const inv = await driver.get("SELECT * FROM invitations WHERE invitee = ? AND status = 'ordered'", [invitee]);
  if (!inv) return null;
  const cnt = (await driver.get("SELECT COUNT(*) c FROM invitations WHERE inviter = ? AND status = 'ordered'", [inv.inviter])).c;
  await addCoins(inv.inviter, ENERGY_CONFIG.earnRules.invite, `邀请奖励（第${cnt}人）`, `INV-${inv.id}`);
  return { inviter: inv.inviter, coins: ENERGY_CONFIG.earnRules.invite };
}
// ===== 导出 =====
module.exports = { todayCoinsEarned, addCoins, getCoinInfo, listCoinLogs, listShopItems, exchangeCoinItem, listMyExchanges, checkLevelUpReward, rewardInviterCoins };
