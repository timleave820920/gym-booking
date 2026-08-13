/**
 * 邀请域（invite）：绑定邀请、邀请奖励、排行榜
 */
const { db } = require('../db-core');
const { findUserByOpenid } = require('./users');
const { addCoins } = require('./coin');
const { addBalance } = require('./members');
const { INVITE_REWARDS } = require('./members');
const ENERGY_CONFIG = require('../energy-config.js');

function listInvitationDetails(inviterOpenid) {
  return db.prepare(`
    SELECT i.id, i.invitee, i.status, i.reward_fen, i.created_at,
           u.nickname AS invitee_name, u.avatar AS invitee_avatar
    FROM invitations i
    LEFT JOIN users u ON u.openid = i.invitee
    WHERE i.inviter = ?
    ORDER BY i.created_at DESC, i.id DESC
  `).all(inviterOpenid);
}

/** 邀请数据看板：总量/转化/奖励/排行/近14天趋势 */
function inviteBoardStats() {
  const total = db.prepare('SELECT COUNT(*) c FROM invitations').get().c;
  const ordered = db.prepare("SELECT COUNT(*) c FROM invitations WHERE status = 'ordered'").get().c;
  const reward = db.prepare('SELECT COALESCE(SUM(reward_fen), 0) s FROM invitations').get().s;
  const inviters = db.prepare('SELECT COUNT(DISTINCT inviter) c FROM invitations').get().c;
  const top = db.prepare(`
    SELECT i.inviter, u.nickname AS inviter_name, u.avatar AS inviter_avatar,
           COUNT(*) AS invited,
           COALESCE(SUM(CASE WHEN i.status = 'ordered' THEN 1 ELSE 0 END), 0) AS ordered_cnt
    FROM invitations i
    LEFT JOIN users u ON u.openid = i.inviter
    GROUP BY i.inviter
    ORDER BY ordered_cnt DESC, invited DESC
    LIMIT 10
  `).all();
  const daily = db.prepare(`
    SELECT date(created_at) AS d, COUNT(*) AS c
    FROM invitations
    WHERE created_at >= datetime('now', 'localtime', '-13 days')
    GROUP BY date(created_at)
    ORDER BY d
  `).all();
  return {
    total,
    ordered,
    conversion: total > 0 ? (ordered / total * 100).toFixed(1) : '0',
    rewardFen: reward,
    inviters,
    top,
    daily
  };
}

/** 绑定邀请关系（被邀请人注册时调用） */
function bindInvitation({ inviter, invitee }) {
  if (!inviter) return { ok: false, error: '邀请码不能为空' };
  if (inviter === invitee) return { ok: false, error: '不能邀请自己' };
  if (!findUserByOpenid(inviter)) return { ok: false, error: '邀请码无效' };
  const exists = db.prepare('SELECT id FROM invitations WHERE invitee = ?').get(invitee);
  if (exists) return { ok: false, error: '已存在邀请关系' };
  db.prepare('INSERT INTO invitations (inviter, invitee, status) VALUES (?, ?, \'registered\')').run(inviter, invitee);
  return { ok: true };
}

/** 好友完成首订 → 发放邀请奖励（阶梯：1人=1课=¥100 / 3人=5课=¥500 / 5人=10课=¥1000） */
function rewardInviter(invitee) {
  const inv = db.prepare("SELECT * FROM invitations WHERE invitee = ? AND status = 'registered'").get(invitee);
  if (!inv) return null;
  // 标记已完成首订
  db.prepare("UPDATE invitations SET status = 'ordered' WHERE id = ?").run(inv.id);
  // 统计邀请人当前有效邀请数（含本次）
  const cnt = db.prepare("SELECT COUNT(*) c FROM invitations WHERE inviter = ? AND status = 'ordered'").get(inv.inviter).c;
  // 阶梯奖励（从 member-config.js 读取）
  const reward = INVITE_REWARDS.find(r => r.at === cnt);
  if (!reward) return null;
  // 发放储值奖励（只发增量奖励，阶梯不重复累计）
  const already = db.prepare('SELECT COALESCE(SUM(reward_fen),0) s FROM invitations WHERE inviter = ?').get(inv.inviter).s;
  const needFen = reward.fen - already;
  if (needFen <= 0) return null;
  const bal = addBalance(inv.inviter, needFen, `邀请奖励（${cnt}人）`, `INV-${inv.id}`);
  // 能量币：每成功邀请 1 人 → 100 币（每次首订都发，不限阶梯）
  addCoins(inv.inviter, ENERGY_CONFIG.earnRules.invite || 0, `邀请奖励（第${cnt}人）`, `INV-${inv.id}`);
  return { inviter: inv.inviter, rewardFen: needFen, invitedCount: cnt, balance: bal };
}

/** 邀请战绩统计 */
function getInviteStats(openid) {
  const invited = db.prepare('SELECT COUNT(*) c FROM invitations WHERE inviter = ?').get(openid).c;
  const ordered = db.prepare("SELECT COUNT(*) c FROM invitations WHERE inviter = ? AND status = 'ordered'").get(openid).c;
  return {
    invited,
    ordered,
    rewards: INVITE_REWARDS.map(r => ({
      at: r.at,
      label: r.at + ' 人',
      rewardText: '¥' + (r.fen / 100),
      fen: r.fen,
      achieved: ordered >= r.at
    }))
  };
}

/** 未读储值奖励（登录庆祝用） */
// ===== 导出 =====
module.exports = { listInvitationDetails, inviteBoardStats, bindInvitation, rewardInviter, getInviteStats };
