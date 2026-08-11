/**
 * 数据库层 - SQLite (node:sqlite)
 * 综合训练馆订课系统
 * 存储已注册用户，支持注册/登录判定
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'gym.db');
// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 打开数据库（WAL 模式，允许并发读写）
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// 初始化用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    openid        TEXT UNIQUE NOT NULL,          -- 微信 openid（唯一身份标识）
    nickname      TEXT DEFAULT '',               -- 微信昵称
    avatar        TEXT DEFAULT '',               -- 头像 URL
    phone         TEXT DEFAULT '',               -- 手机号（可选）
    role          TEXT DEFAULT 'student',        -- 角色：student/coach/admin
    total_classes INTEGER DEFAULT 0,             -- 累计上课次数
    total_hours   TEXT DEFAULT '0h',             -- 累计时长
    total_calories TEXT DEFAULT '0',             -- 累计卡路里
    streak        INTEGER DEFAULT 0,             -- 连续打卡
    created_at    TEXT DEFAULT (datetime('now','localtime')),  -- 注册时间
    last_login_at TEXT DEFAULT (datetime('now','localtime')),  -- 最后登录时间
    login_count   INTEGER DEFAULT 0,             -- 登录次数
    balance_fen   INTEGER DEFAULT 0,             -- 储值余额（单位：分）
    coin_balance  INTEGER DEFAULT 0,             -- 能量币余额
    level_lv      INTEGER DEFAULT 1              -- 当前会员等级（升级检测用）
  );
`);
// 兼容旧库：确保 balance_fen / coin_balance / level_lv 列存在
try { db.exec('ALTER TABLE users ADD COLUMN balance_fen INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN coin_balance INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN level_lv INTEGER DEFAULT 1'); } catch (e) {}

// ===== 会员体系表 =====

// 充值记录表
db.exec(`
  CREATE TABLE IF NOT EXISTS member_recharges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recharge_no TEXT UNIQUE NOT NULL,
    user_openid TEXT NOT NULL,
    order_id    INTEGER,                          -- 关联订单
    amount_fen  INTEGER DEFAULT 0,                -- 充值金额（分）
    bonus_fen   INTEGER DEFAULT 0,                -- 赠送金额（分）
    status      TEXT DEFAULT 'paid',              -- paid 成功
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_openid) REFERENCES users(openid)
  );
`);

// 储值变动流水（充值/奖励/消费/退款）
db.exec(`
  CREATE TABLE IF NOT EXISTS balance_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_openid TEXT NOT NULL,
    change_fen  INTEGER NOT NULL,                 -- 变动额（正=增加 负=减少）
    balance_after INTEGER DEFAULT 0,              -- 变动后余额
    reason      TEXT DEFAULT '',                  -- 充值/邀请奖励/订课消费/退款
    ref_id      TEXT DEFAULT '',                  -- 关联单号（订单号/邀请单号）
    read_flag   INTEGER DEFAULT 0,                -- 0 未读（登录庆祝弹框用） 1 已读
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_openid) REFERENCES users(openid)
  );
  CREATE INDEX IF NOT EXISTS idx_balance_logs_unread ON balance_logs(user_openid, read_flag);
`);

// 邀请关系表
db.exec(`
  CREATE TABLE IF NOT EXISTS invitations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter     TEXT NOT NULL,                    -- 邀请人 openid
    invitee     TEXT NOT NULL,                    -- 被邀请人 openid
    status      TEXT DEFAULT 'registered',        -- registered 已注册 / ordered 已完成首订
    reward_fen  INTEGER DEFAULT 0,                -- 已发奖励（分）
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE (invitee)
  );
`);

// 能量币流水表
db.exec(`
  CREATE TABLE IF NOT EXISTS coin_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_openid TEXT NOT NULL,
    change      INTEGER NOT NULL,               -- 变动（正=获得 负=兑换）
    balance_after INTEGER DEFAULT 0,
    reason      TEXT DEFAULT '',
    ref_id      TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_openid) REFERENCES users(openid)
  );
  CREATE INDEX IF NOT EXISTS idx_coin_logs_user ON coin_logs(user_openid, created_at);
`);

// 能量商店兑换记录表
db.exec(`
  CREATE TABLE IF NOT EXISTS coin_exchanges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_openid TEXT NOT NULL,
    item_id     TEXT NOT NULL,
    item_name   TEXT NOT NULL,
    cost        INTEGER NOT NULL,
    code        TEXT,                            -- 虚拟奖品兑换码
    status      TEXT DEFAULT 'pending',          -- pending 待领取 / claimed 已领取
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_openid) REFERENCES users(openid)
  );
`);

// ===== 课程相关表（结构见 DATA-MODEL.md）=====

// 教练资料表
db.exec(`
  CREATE TABLE IF NOT EXISTS coaches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_openid TEXT,
    name        TEXT NOT NULL,
    avatar      TEXT DEFAULT '',
    skills      TEXT DEFAULT '',
    rating      REAL DEFAULT 5.0,
    status      TEXT DEFAULT 'active'
  );
`);

// 场地表
db.exec(`
  CREATE TABLE IF NOT EXISTS venues (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    location TEXT DEFAULT '',
    capacity INTEGER DEFAULT 20,
    status   TEXT DEFAULT 'active'
  );
`);

// 课程模板表（价格存"分"）
db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL,
    level        INTEGER DEFAULT 3,
    duration_min INTEGER DEFAULT 60,
    price_fen    INTEGER DEFAULT 6800,
    cover        TEXT DEFAULT '',
    description  TEXT DEFAULT '',
    tags         TEXT DEFAULT '',          -- 卖点标签（逗号分隔，如 "高效燃脂,新手友好"）
    status       TEXT DEFAULT 'published',
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// 旧库迁移：为已存在的 courses 表补 tags 列（幂等）
const courseCols = db.prepare("PRAGMA table_info(courses)").all().map(c => c.name);
if (!courseCols.includes('tags')) {
  db.exec("ALTER TABLE courses ADD COLUMN tags TEXT DEFAULT ''");
  console.log('[db] courses 表已迁移：新增 tags 列');
}

// 每周重复排课规则表
db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id  INTEGER NOT NULL,
    weekday    INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time   TEXT NOT NULL,
    venue_id   INTEGER NOT NULL,
    coach_id   INTEGER NOT NULL,
    capacity   INTEGER DEFAULT 20,
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (venue_id)  REFERENCES venues(id),
    FOREIGN KEY (coach_id)  REFERENCES coaches(id)
  );
`);

// 课程场次表（排课实例，余位 = capacity - booked_count）
db.exec(`
  CREATE TABLE IF NOT EXISTS course_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL,
    coach_id     INTEGER NOT NULL,
    venue_id     INTEGER NOT NULL,
    date         TEXT NOT NULL,
    start_time   TEXT NOT NULL,
    end_time     TEXT NOT NULL,
    capacity     INTEGER DEFAULT 20,
    booked_count INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'published',
    source       TEXT DEFAULT 'manual',
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (coach_id)  REFERENCES coaches(id),
    FOREIGN KEY (venue_id)  REFERENCES venues(id)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON course_sessions(date, status);
  CREATE INDEX IF NOT EXISTS idx_sessions_course ON course_sessions(course_id, date);
`);

// 预约/订单表
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_no    TEXT UNIQUE NOT NULL,
    user_openid   TEXT NOT NULL,
    session_id    INTEGER NOT NULL,
    amount_fen    INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'booked',
    pay_status    TEXT DEFAULT 'unpaid',
    checkin_at    TEXT,
    cancel_reason TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_openid) REFERENCES users(openid),
    FOREIGN KEY (session_id)  REFERENCES course_sessions(id),
    UNIQUE (user_openid, session_id)
  );
`);

// 候补排位表（满员课付费排位，有人退订自动转正）
db.exec(`
  CREATE TABLE IF NOT EXISTS waitlist (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    wait_no       TEXT UNIQUE NOT NULL,
    user_openid   TEXT NOT NULL,
    session_id    INTEGER NOT NULL,
    amount_fen    INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'waiting',    -- waiting 排位中 / promoted 已转正 / refunded 已退款 / cancelled 主动退出
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    promoted_at   TEXT,
    refunded_at   TEXT,
    cancel_reason TEXT DEFAULT '',
    FOREIGN KEY (user_openid) REFERENCES users(openid),
    FOREIGN KEY (session_id)  REFERENCES course_sessions(id),
    UNIQUE (user_openid, session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status, created_at);
`);

// 订单表（每笔钱的记账：订课/候补排位/退款都挂订单号）
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no     TEXT UNIQUE NOT NULL,
    user_openid  TEXT NOT NULL,
    session_id   INTEGER NOT NULL,
    booking_id   INTEGER,                -- 关联订课记录（支付后生成）
    wait_id      INTEGER,                -- 关联候补记录（排位支付后生成）
    order_type   TEXT DEFAULT 'book',    -- book 订课 / waitlist 候补排位
    amount_fen   INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'pending', -- pending 待支付 / paid 已支付 / cancelled 已取消 / refunded 已退款
    pay_method   TEXT DEFAULT 'balance', -- wxpay 微信支付 / balance 余额
    paid_at      TEXT,
    refunded_at  TEXT,
    cancel_reason TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    reward_triggered INTEGER DEFAULT 0,           -- 邀请奖励已触发
    FOREIGN KEY (user_openid) REFERENCES users(openid),
    FOREIGN KEY (session_id)  REFERENCES course_sessions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_openid, status);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
`);
try { db.exec('ALTER TABLE orders ADD COLUMN reward_triggered INTEGER DEFAULT 0'); } catch (e) {}

/**
 * 根据 openid 查找用户
 */
function findUserByOpenid(openid) {
  return db.prepare('SELECT * FROM users WHERE openid = ?').get(openid) || null;
}

/**
 * 注册新用户
 */
function createUser({ openid, nickname = '', avatar = '', phone = '', role = 'student' }) {
  const result = db.prepare(`
    INSERT INTO users (openid, nickname, avatar, phone, role, login_count)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(openid, nickname, avatar, phone, role);
  return findUserByOpenid(openid);
}

/**
 * 更新登录信息（登录次数 +1，更新最后登录时间）
 */
function touchLogin(openid) {
  db.prepare(`
    UPDATE users
    SET last_login_at = datetime('now','localtime'), login_count = login_count + 1
    WHERE openid = ?
  `).run(openid);
  return findUserByOpenid(openid);
}

/**
 * 更新用户资料（昵称/头像）
 */
function updateProfile(openid, { nickname, avatar }) {
  db.prepare('UPDATE users SET nickname = ?, avatar = ? WHERE openid = ?')
    .run(nickname || '', avatar || '', openid);
  return findUserByOpenid(openid);
}

// ===== 会员体系（等级/储值/奖励/邀请）=====
// 数值统一从 member-config.js 读取（唯一数据源，改配置即全局生效）

const MEMBER_CONFIG = require('./member-config.js');
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
  return {
    openid,
    totalClasses: total,
    levelName: level.name,
    levelLv: level.lv,
    discount: level.discount,
    levelMin: level.min,
    next: next ? { name: next.name, min: next.min, discount: next.discount } : null,
    progress: next ? Math.min(100, Math.round((total - level.min) / (next.min - level.min) * 100)) : 100,
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

// ===== 能量币系统（获取/流水/兑换）=====
// 配置从 energy-config.js 读取（唯一数据源）

const ENERGY_CONFIG = require('./energy-config.js');
const SHOP_ITEMS = require('./shop-items.js');

/** 今日已获取能量币（防刷上限） */
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

/** 查询充值记录 */
function listRecharges(openid) {
  return db.prepare(`
    SELECT id, recharge_no, amount_fen, bonus_fen, status, created_at
    FROM member_recharges WHERE user_openid = ? ORDER BY created_at DESC
  `).all(openid);
}

/** 绑定邀请关系（被邀请人注册时调用） */
function bindInvitation({ inviter, invitee }) {
  if (inviter === invitee) return { ok: false, error: '不能邀请自己' };
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
function countUsers() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

/**
 * 列出所有用户（后台用）
 */
function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

/**
 * 删除指定用户（按 id）
 * @returns {boolean} 是否删除成功
 */
function deleteUserById(id) {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * 删除指定用户（按 openid）
 * @returns {boolean} 是否删除成功
 */
function deleteUserByOpenid(openid) {
  const result = db.prepare('DELETE FROM users WHERE openid = ?').run(openid);
  return result.changes > 0;
}

/**
 * 清空所有用户
 * @returns {number} 删除的用户数
 */
function clearUsers() {
  const count = countUsers();
  db.exec('DELETE FROM users;');
  // 重置自增 ID，让新注册从 1 开始
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'users';");
  return count;
}

// ===== 课程相关（结构见 DATA-MODEL.md）=====

/** 教练列表（下拉选项用） */
function listCoaches() {
  return db.prepare("SELECT id, name, skills, status FROM coaches WHERE status='active' OR 1=1 ORDER BY id").all();
}

/** 场地列表（下拉选项用） */
function listVenues() {
  return db.prepare('SELECT id, name, capacity, status FROM venues ORDER BY id').all();
}

/** 课程列表（含排课规则） */
function listCourses() {
  const courses = db.prepare('SELECT * FROM courses ORDER BY id').all();
  const rules = db.prepare('SELECT * FROM schedule_templates ORDER BY id').all();
  const byCourse = {};
  for (const r of rules) {
    (byCourse[r.course_id] = byCourse[r.course_id] || []).push({
      weekday: r.weekday,
      start_time: r.start_time,
      end_time: r.end_time,
      coach_id: r.coach_id,
      venue_id: r.venue_id,
      capacity: r.capacity
    });
  }
  return courses.map(c => ({ ...c, rules: byCourse[c.id] || [] }));
}

/** 课程规则列表 */
function getRules(courseId) {
  return db.prepare('SELECT * FROM schedule_templates WHERE course_id = ? ORDER BY weekday, start_time').all(courseId);
}

/** 替换课程规则（先删后插，事务内） */
function replaceRules(courseId, rules) {
  db.prepare('DELETE FROM schedule_templates WHERE course_id = ?').run(courseId);
  const ins = db.prepare(`INSERT INTO schedule_templates (course_id, weekday, start_time, end_time, venue_id, coach_id, capacity)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rules || []) {
    ins.run(courseId, r.weekday, r.start_time, r.end_time, r.venue_id, r.coach_id, r.capacity);
  }
}

/** 新增课程（含规则） @returns 新课程对象 */
function createCourse(data) {
  const res = db.prepare(`INSERT INTO courses (name, category, level, duration_min, price_fen, cover, description, tags, status)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.name, data.category, data.level, data.duration_min, data.price_fen, data.cover || '', data.description || '', data.tags || '', data.status || 'published');
  const id = res.lastInsertRowid;
  replaceRules(id, data.rules || []);
  return { id, ...data };
}

/** 更新课程（含规则） @returns 是否成功 */
function updateCourse(id, data) {
  const res = db.prepare(`UPDATE courses SET name=?, category=?, level=?, duration_min=?, price_fen=?, cover=?, description=?, tags=?, status=?, updated_at=datetime('now','localtime')
                          WHERE id = ?`)
    .run(data.name, data.category, data.level, data.duration_min, data.price_fen, data.cover || '', data.description || '', data.tags || '', data.status || 'published', id);
  if (res.changes === 0) return false;
  replaceRules(id, data.rules || []);
  return true;
}

/**
 * 删除课程（级联删规则与场次；场次有订单则拒绝）
 * @returns {{ok:boolean, bookings?:number}}
 */
function deleteCourse(id) {
  const b = db.prepare('SELECT COUNT(*) c FROM bookings b JOIN course_sessions s ON s.id = b.session_id WHERE s.course_id = ?').get(id).c;
  if (b > 0) return { ok: false, bookings: b };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM schedule_templates WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_sessions WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    db.exec('COMMIT');
    return { ok: true };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * 发布课程：按排课规则在日期范围内生成场次（幂等，已存在的跳过）
 * @returns {{created:number, skipped:number}}
 */
function publishSessions(courseId, startDate, endDate) {
  const rules = getRules(courseId);
  if (rules.length === 0) return { created: 0, skipped: 0, reason: 'no_rules' };

  const exists = new Set(db.prepare("SELECT date || '_' || start_time || '_' || venue_id k FROM course_sessions WHERE course_id = ?")
    .all(courseId).map(r => r.k));

  const ins = db.prepare(`INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source)
                          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'published', 'manual')`);
  let created = 0, skipped = 0;

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const weekday = d.getDay() === 0 ? 7 : d.getDay(); // 周日=7
    for (const r of rules) {
      if (r.weekday !== weekday) continue;
      const key = `${iso}_${r.start_time}_${r.venue_id}`;
      if (exists.has(key)) { skipped++; continue; }
      ins.run(courseId, r.coach_id, r.venue_id, iso, r.start_time, r.end_time, r.capacity);
      exists.add(key);
      created++;
    }
  }
  return { created, skipped };
}

// 场次查询的公共 JOIN
const SESSION_SELECT = `
  SELECT s.id, s.date, s.start_time, s.end_time, s.capacity, s.booked_count, s.status,
         (s.capacity - s.booked_count) AS remaining,
         c.id AS course_id, c.name AS course_name, c.category, c.level, c.duration_min, c.price_fen, c.cover,
         c.description AS course_desc, c.tags AS course_tags, co.name AS coach_name, co.avatar AS coach_avatar, v.name AS venue_name
  FROM course_sessions s
  JOIN courses c ON c.id = s.course_id
  JOIN coaches co ON co.id = s.coach_id
  JOIN venues v ON v.id = s.venue_id`;

/** 按日期查已发布场次（学员端课程列表） */
function listSessionsByDate(date) {
  return db.prepare(`${SESSION_SELECT} WHERE s.date = ? AND s.status = 'published' ORDER BY s.start_time`).all(date);
}

/** 按日期 + 教练查已发布场次（教练端今日课表） */
function listSessionsByCoach(date, coachId) {
  return db.prepare(`${SESSION_SELECT} WHERE s.date = ? AND s.coach_id = ? AND s.status = 'published' ORDER BY s.start_time`)
    .all(date, coachId);
}

/** 按日期范围 + 课程查场次（排表管理页，含全部状态） */
function listSessionsByRange(from, to, courseId) {
  let sql = `${SESSION_SELECT} WHERE s.date >= ? AND s.date <= ?`;
  const params = [from, to];
  if (courseId) {
    sql += ' AND s.course_id = ?';
    params.push(courseId);
  }
  sql += ' ORDER BY s.date, s.start_time';
  return db.prepare(sql).all(...params);
}

/**
 * 取消场次：仅允许无人预约的场次（booked_count=0 且无订单记录）
 * @returns {{ok:boolean, error?:string}}
 */
function cancelSession(id) {
  const s = db.prepare('SELECT id, booked_count, status FROM course_sessions WHERE id = ?').get(id);
  if (!s) return { ok: false, error: '场次不存在' };
  if (s.status === 'cancelled') return { ok: false, error: '该场次已取消' };
  const orders = db.prepare('SELECT COUNT(*) c FROM bookings WHERE session_id = ? AND status = \'booked\'').get(id).c;
  const total = s.booked_count || 0;
  if (orders > 0 || total > 0) return { ok: false, error: `该场次已有 ${Math.max(orders, total)} 名学员预约，无法取消` };
  db.prepare("UPDATE course_sessions SET status = 'cancelled' WHERE id = ?").run(id);
  return { ok: true };
}

/**
 * 调整场次容量：新容量不能小于已约数
 * @returns {{ok:boolean, error?:string}}
 */
function updateSessionCapacity(id, capacity) {
  const cap = Number(capacity);
  if (!Number.isFinite(cap) || cap <= 0) return { ok: false, error: '容量必须为正整数' };
  const s = db.prepare('SELECT id, booked_count, status FROM course_sessions WHERE id = ?').get(id);
  if (!s) return { ok: false, error: '场次不存在' };
  if (s.status !== 'published') return { ok: false, error: '该场次已取消，无法调整' };
  if (cap < (s.booked_count || 0)) return { ok: false, error: `容量不能小于已预约人数（${s.booked_count}）` };
  db.prepare('UPDATE course_sessions SET capacity = ? WHERE id = ?').run(cap, id);
  return { ok: true };
}

/** 按日期查场次，并标记当前用户是否已预订/已排位（openid 可选） */
function listSessionsByDateForUser(date, openid) {
  const sessions = listSessionsByDate(date);
  if (!openid) return sessions;
  // 查该用户已预订的场次 id 集合（仅 booked 状态）
  const bookedRows = db.prepare("SELECT session_id FROM bookings WHERE user_openid = ? AND status = 'booked'").all(openid);
  const bookedSet = new Set(bookedRows.map(r => r.session_id));
  // 查该用户候补排位中的场次 id 集合（仅 waiting 状态）
  const waitRows = db.prepare("SELECT session_id FROM waitlist WHERE user_openid = ? AND status = 'waiting'").all(openid);
  const waitSet = new Set(waitRows.map(r => r.session_id));
  return sessions.map(s => ({ ...s, booked_by_me: bookedSet.has(s.id), waitlisted_by_me: waitSet.has(s.id) }));
}

/** 场次详情（学员端课程详情） */
function getSessionById(id) {
  return db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) || null;
}

// ===== 订课（bookings）=====

/**
 * 学员订课：创建订单 + 扣减场次余位（事务，防超卖）
 * @param {object} p { user_openid, session_id, amount_fen, pay_status }
 * @returns {{ok:true, booking:object}|{ok:false, error:string}}
 */
function createBooking({ user_openid, session_id, amount_fen = 0, pay_status = 'paid' }) {
  // 校验用户存在
  const user = findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  // 校验场次存在且可订
  const session = getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };
  if (session.remaining <= 0) return { ok: false, error: '该课程已满员' };

  // 检查是否已订（UNIQUE 约束兜底）
  const exists = db.prepare('SELECT id, status FROM bookings WHERE user_openid = ? AND session_id = ?').get(user_openid, session_id);
  if (exists && exists.status === 'booked') return { ok: false, error: '您已预订该课程，请勿重复预订' };

  const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();

  db.exec('BEGIN');
  try {
    if (exists) {
      // 曾退订 → 重新激活原订单（保留历史 booking_no）
      db.prepare("UPDATE bookings SET status = 'booked', pay_status = ?, cancel_reason = '', checkin_at = NULL WHERE id = ?")
        .run(pay_status, exists.id);
    } else {
      // 1. 创建订单
      db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
                  VALUES (?, ?, ?, ?, 'booked', ?)`)
        .run(bookingNo, user_openid, session_id, amount_fen, pay_status);
    }
    // 2. 扣减余位
    db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(session_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    if (e.message.includes('UNIQUE')) return { ok: false, error: '您已预订该课程，请勿重复预订' };
    throw e;
  }

  const booking = db.prepare(`
    SELECT b.id, b.booking_no, b.session_id, b.amount_fen, b.status, b.pay_status, b.checkin_at, b.created_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.id = last_insert_rowid()
  `).get();
  return { ok: true, booking };
}

/**
 * 查询某学员的全部订课（我的课程）
 * @param {string} openid
 * @param {string} [status] 可选筛选：booked/cancelled
 */
function listBookingsByUser(openid, status) {
  const where = status ? 'WHERE b.user_openid = ? AND b.status = ?' : 'WHERE b.user_openid = ?';
  const params = status ? [openid, status] : [openid];
  return db.prepare(`
    SELECT b.id, b.booking_no, b.session_id, b.amount_fen, b.status, b.pay_status, b.checkin_at, b.created_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.id AS course_id, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    ${where}
    ORDER BY s.date DESC, s.start_time DESC
  `).all(...params);
}

/**
 * 签到凭证信息：按订课 ID 查询（学员二维码页展示用）
 * @returns {object|null} 课程/时间/场地/签到状态
 */
function getCheckinInfo(bookingId) {
  return db.prepare(`
    SELECT b.id, b.session_id, b.status, b.checkin_at, b.user_openid,
           s.date, s.start_time, s.end_time,
           c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.id = ?
  `).get(bookingId) || null;
}

/**
 * 按场次查订课名单（教练端学员名单，含学员昵称与签到状态）
 */
function listBookingsBySession(sessionId) {
  return db.prepare(`
    SELECT b.id, b.session_id, b.status, b.checkin_at, b.user_openid,
           u.nickname AS student_name, u.avatar AS student_avatar,
           s.date, s.start_time, s.end_time,
           c.name AS course_name, v.name AS venue_name
    FROM bookings b
    JOIN users u ON u.openid = b.user_openid
    JOIN course_sessions s ON s.id = b.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN venues v ON v.id = s.venue_id
    WHERE b.session_id = ? AND b.status = 'booked'
    ORDER BY b.checkin_at IS NULL, b.created_at
  `).all(sessionId);
}

/**
 * 教练核销签到（扫码后调用）
 * @param {object} p { bookingId, coachOpenid }
 * @returns {{ok:true, booking:object}|{ok:false, error:string}}
 */
function checkinBooking({ bookingId, coachOpenid }) {
  // 校验教练身份（coaches 表或 users.role='coach'）
  const coach = db.prepare("SELECT * FROM users WHERE openid = ? AND role = 'coach'").get(coachOpenid)
    || db.prepare('SELECT * FROM coaches WHERE user_openid = ?').get(coachOpenid);
  if (!coach) return { ok: false, error: '无教练权限' };

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return { ok: false, error: '订课记录不存在' };
  if (booking.status !== 'booked') return { ok: false, error: '该订课已失效' };
  if (booking.checkin_at) return { ok: false, error: '该学员已签到，请勿重复签到' };

  const session = db.prepare('SELECT * FROM course_sessions WHERE id = ?').get(booking.session_id);
  if (!session) return { ok: false, error: '场次不存在' };

  // 时间校验：只允许当天签到（开课前 30 分钟至课程结束后 2 小时）
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (session.date !== todayStr) {
    return { ok: false, error: `仅支持当天签到（场次日期 ${session.date}）` };
  }

  db.prepare("UPDATE bookings SET checkin_at = datetime('now','localtime') WHERE id = ?").run(bookingId);
  // 同步用户累计次数（total_classes +1）
  db.prepare('UPDATE users SET total_classes = total_classes + 1 WHERE openid = ?').run(booking.user_openid);
  // 能量币：签到 + 上课
  const checkinCoins = ENERGY_CONFIG.earnRules.checkin || 0;
  const attendCoins = ENERGY_CONFIG.earnRules.attendClass || 0;
  if (checkinCoins > 0) addCoins(booking.user_openid, checkinCoins, '签到奖励', `CK-${bookingId}`);
  if (attendCoins > 0) addCoins(booking.user_openid, attendCoins, '完成课程奖励', `CK-${bookingId}`);

  return { ok: true, booking: getCheckinInfo(bookingId) };
}

/**
 * 退订：取消订单 + 恢复场次余位（事务）
 */
function cancelBooking(openid, bookingId) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_openid = ?').get(bookingId, openid);
  if (!booking) return { ok: false, error: '订单不存在' };
  if (booking.status === 'cancelled') return { ok: false, error: '该订单已退订' };

  db.exec('BEGIN');
  let promoted = null;
  try {
    db.prepare("UPDATE bookings SET status = 'cancelled', cancel_reason = '用户退订' WHERE id = ?").run(bookingId);
    // 关联订单标记退款（仅已支付的订单）
    db.prepare(`UPDATE orders SET status = 'refunded', refunded_at = datetime('now','localtime'), cancel_reason = '用户退订'
                WHERE booking_id = ? AND status = 'paid'`).run(bookingId);
    // 仅未签到订单恢复余位
    if (!booking.checkin_at) {
      db.prepare('UPDATE course_sessions SET booked_count = MAX(booked_count - 1, 0) WHERE id = ?').run(booking.session_id);
      // 有候补者 → 最早排位者自动转正（候补队列先进先出）
      promoted = promoteFromWaitlist(booking.session_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, promoted };
}

// ===== 订单（orders）=====

const ORDER_SELECT = `
  SELECT o.id, o.order_no, o.user_openid, o.session_id, o.booking_id, o.wait_id, o.order_type,
         o.amount_fen, o.status, o.pay_method, o.paid_at, o.refunded_at, o.cancel_reason, o.created_at,
         COALESCE(s.date, '') AS date, COALESCE(s.start_time, '') AS start_time, COALESCE(s.end_time, '') AS end_time,
         COALESCE(c.name, '储值充值') AS course_name, COALESCE(c.level, 0) AS level, COALESCE(c.duration_min, 0) AS duration_min,
         COALESCE(co.name, '') AS coach_name, COALESCE(v.name, '') AS venue_name
  FROM orders o
  LEFT JOIN course_sessions s ON s.id = o.session_id
  LEFT JOIN courses c ON c.id = s.course_id
  LEFT JOIN coaches co ON co.id = s.coach_id
  LEFT JOIN venues v ON v.id = s.venue_id`;

/** 生成订单号 */
function genOrderNo() {
  return 'ORD' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/**
 * 下单（创建待支付订单）
 * @param {object} p { user_openid, session_id, amount_fen, order_type }
 * @returns {{ok:true, order:object}|{ok:false, error:string}}
 */
function createOrder({ user_openid, session_id, amount_fen = 0, order_type = 'book' }) {
  const user = findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  // 储值充值：无场次依赖，校验套餐金额
  if (order_type === 'recharge') {
    const plan = RECHARGE_PLANS.find(p => p.amount === amount_fen);
    if (!plan) return { ok: false, error: '无效的充值套餐' };
    const orderNo = genOrderNo();
    db.prepare(`INSERT INTO orders (order_no, user_openid, session_id, order_type, amount_fen, status)
                VALUES (?, ?, NULL, ?, ?, 'pending')`)
      .run(orderNo, user_openid, order_type, amount_fen);
    const order = db.prepare(`${ORDER_SELECT} WHERE o.id = last_insert_rowid()`).get();
    return { ok: true, order };
  }

  const session = getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };

  // 已订过 → 拒绝下单
  const existing = db.prepare("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'").get(user_openid, session_id);
  if (existing) return { ok: false, error: '您已预订该课程，请勿重复下单' };

  if (order_type === 'book') {
    if (session.remaining <= 0) return { ok: false, error: '该课程已满员，请选择候补排位' };
  } else if (order_type === 'waitlist') {
    if (session.remaining > 0) return { ok: false, error: '该课程仍有余位，请直接预订' };
    const queued = db.prepare("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ? AND status = 'waiting'").get(user_openid, session_id);
    if (queued) return { ok: false, error: '您已在候补队列中' };
  } else {
    return { ok: false, error: '未知订单类型' };
  }

  const orderNo = genOrderNo();
  db.prepare(`INSERT INTO orders (order_no, user_openid, session_id, order_type, amount_fen, status)
              VALUES (?, ?, ?, ?, ?, 'pending')`)
    .run(orderNo, user_openid, session_id, order_type, amount_fen);

  const order = db.prepare(`${ORDER_SELECT} WHERE o.id = last_insert_rowid()`).get();
  return { ok: true, order };
}

/**
 * 支付回写（模拟支付成功后调用；幂等：已支付订单重复调用直接返回成功）
 * 事务：订单 pending→paid + 生成 booking（扣余位）或 waitlist 记录
 * @param {object} p { openid, orderId, pay_method }
 * @returns {{ok:true, order:object, booking?:object, wait?:object}|{ok:false, error:string}}
 */
function payOrder({ openid, orderId, pay_method = 'balance' }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_openid = ?').get(orderId, openid);
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.status === 'paid') {
    return { ok: true, order: db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(orderId), already: true };
  }
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return { ok: false, error: '订单已失效，无法支付' };
  }

  // 会员价预校验：储值支付需余额充足（不足直接拒绝，避免事务回滚）
  if (order.order_type === 'book' && pay_method === 'balance'
      && MEMBER_CONFIG.memberPrice && MEMBER_CONFIG.memberPrice.enabled) {
    const lv = getMemberLevel(order.user_openid);
    const payFen = lv ? Math.round(order.amount_fen * lv.discount) : order.amount_fen;
    const user = findUserByOpenid(order.user_openid);
    if ((user.balance_fen || 0) < payFen) {
      return { ok: false, error: '储值余额不足，请先充值或改用微信支付' };
    }
  }

  let booking = null, wait = null, recharge = null;
  db.exec('BEGIN');
  try {
    // 1. 订单标记已支付
    db.prepare("UPDATE orders SET status = 'paid', pay_method = ?, paid_at = datetime('now','localtime') WHERE id = ?")
      .run(pay_method, orderId);

    if (order.order_type === 'recharge') {
      // 储值充值：发放储值 + 写充值记录（套餐按金额匹配赠送）
      const plan = RECHARGE_PLANS.find(p => p.amount === order.amount_fen) || { bonus: 0 };
      recharge = applyRecharge({ user_openid: order.user_openid, order_id: orderId, amount_fen: order.amount_fen, bonus_fen: plan.bonus });
    } else if (order.order_type === 'waitlist') {
      // 候补排位：写 waitlist
      const waitNo = 'WL' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
      db.prepare(`INSERT INTO waitlist (wait_no, user_openid, session_id, amount_fen, status)
                  VALUES (?, ?, ?, ?, 'waiting')`)
        .run(waitNo, order.user_openid, order.session_id, order.amount_fen);
      const waitId = db.prepare('SELECT id FROM waitlist WHERE wait_no = ?').get(waitNo).id;
      db.prepare('UPDATE orders SET wait_id = ? WHERE id = ?').run(waitId, orderId);
      wait = db.prepare(`
        SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.created_at,
               s.date, s.start_time, s.end_time, c.name AS course_name
        FROM waitlist w
        JOIN course_sessions s ON s.id = w.session_id
        JOIN courses c ON c.id = s.course_id
        WHERE w.id = ?
      `).get(waitId);
    } else {
      // 订课：复用订课逻辑（事务内调用，不再嵌套 BEGIN）
      // 会员价：仅储值支付享受等级折扣（member-config.js 配置）
      let payFen = order.amount_fen;
      if (pay_method === 'balance' && MEMBER_CONFIG.memberPrice && MEMBER_CONFIG.memberPrice.enabled) {
        const lv = getMemberLevel(order.user_openid);
        if (lv) {
          payFen = Math.round(order.amount_fen * lv.discount);
          // 扣减余额 + 消费流水（余额不足时 addBalance 会让余额为负，事务回滚兜底）
          addBalance(order.user_openid, -payFen, '订课消费', order.order_no);
        }
      }
      const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
      const exists = db.prepare("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ?").get(order.user_openid, order.session_id);
      if (exists) {
        db.prepare("UPDATE bookings SET status = 'booked', pay_status = 'paid', cancel_reason = '', checkin_at = NULL WHERE id = ?").run(exists.id);
        db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(order.session_id);
        booking = db.prepare(`SELECT id, booking_no FROM bookings WHERE id = ?`).get(exists.id);
      } else {
        db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
                    VALUES (?, ?, ?, ?, 'booked', 'paid')`)
          .run(bookingNo, order.user_openid, order.session_id, payFen);
        booking = db.prepare('SELECT id, booking_no FROM bookings WHERE id = last_insert_rowid()').get();
        db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(order.session_id);
      }
      db.prepare('UPDATE orders SET booking_id = ? WHERE id = ?').run(booking.id, orderId);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // 订课成功 → 触发邀请奖励（好友完成首订，邀请人得储值；事务外执行）
  let reward = null;
  if (order.order_type === 'book' && !order.reward_triggered) {
    reward = rewardInviter(order.user_openid);
    if (reward) {
      db.prepare("UPDATE orders SET reward_triggered = 1 WHERE id = ?").run(orderId);
    }
  }

  const finalOrder = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(orderId);
  return { ok: true, order: finalOrder, booking, wait, recharge, reward };
}

/**
 * 查询某学员的全部订单
 */
function listOrdersByUser(openid, status) {
  const where = status ? 'WHERE o.user_openid = ? AND o.status = ?' : 'WHERE o.user_openid = ?';
  const params = status ? [openid, status] : [openid];
  return db.prepare(`${ORDER_SELECT} ${where} ORDER BY o.created_at DESC, o.id DESC`).all(...params);
}

/** 按订单号查订单（支付回调/对账用） */
function getOrderByNo(orderNo) {
  return db.prepare(`${ORDER_SELECT} WHERE o.order_no = ?`).get(orderNo) || null;
}

/**
 * 营收统计（管理后台营收页，基于真实订单）
 * @returns {object} { stats, monthly, sources }
 */
function getRevenueStats() {
  const fen = (n) => Number(n || 0);

  // 本月营收（已支付订单，按支付时间当月）
  const thisMonth = db.prepare(`
    SELECT COALESCE(SUM(amount_fen), 0) revenue, COUNT(*) cnt
    FROM orders WHERE status = 'paid'
      AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now', 'localtime')
  `).get();
  // 总营收 + 总订单数 + 退款总额
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_fen ELSE 0 END), 0) paid_revenue,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_fen ELSE 0 END), 0) refund_revenue,
      COUNT(*) total_orders
    FROM orders
  `).get();
  // 客单价（已支付订单）
  const paidCnt = db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'paid'").get().c;
  const avgPrice = paidCnt > 0 ? totals.paid_revenue / paidCnt : 0;

  // 近 8 个月月度营收
  const monthlyRows = db.prepare(`
    SELECT strftime('%Y-%m', paid_at) ym, COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL
    GROUP BY ym ORDER BY ym DESC LIMIT 8
  `).all();
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const monthly = monthlyRows.reverse().map(r => {
    const m = Number(r.ym.split('-')[1]);
    return { month: monthNames[m - 1], value: Number((r.revenue / 10000).toFixed(1)) };
  });

  // 收入来源（按订单类型 book/waitlist 分组占比）
  const srcRows = db.prepare(`
    SELECT order_type, COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid'
    GROUP BY order_type
  `).all();
  const srcTotal = srcRows.reduce((s, r) => s + fen(r.revenue), 0);
  const srcMeta = {
    book: { name: '单次课程', color: '#5B57EB' },
    waitlist: { name: '候补排位', color: '#B9FF66' }
  };
  const sources = srcRows.map(r => {
    const meta = srcMeta[r.order_type] || { name: r.order_type, color: '#F8D044' };
    const pct = srcTotal > 0 ? (fen(r.revenue) / srcTotal * 100).toFixed(1) : '0';
    return { name: meta.name, pct: pct + '%', color: meta.color };
  });

  // 上月营收（算环比）
  const lastMonth = db.prepare(`
    SELECT COALESCE(SUM(amount_fen), 0) revenue
    FROM orders WHERE status = 'paid'
      AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now', 'localtime', '-1 month')
  `).get().revenue;

  const thisRev = fen(thisMonth.revenue);
  const lastRev = fen(lastMonth);
  const trendPct = lastRev > 0 ? ((thisRev - lastRev) / lastRev * 100).toFixed(1) : 0;

  return {
    stats: [
      { label: '本月营收', value: '¥ ' + (thisRev / 100).toLocaleString(), trend: (trendPct >= 0 ? '↑ ' : '↓ ') + Math.abs(trendPct) + '% 较上月', dark: true },
      { label: '本月订单', value: String(thisMonth.cnt), trend: '已支付订单' },
      { label: '累计营收', value: '¥ ' + (fen(totals.paid_revenue) / 100).toLocaleString(), trend: '累计 ' + totals.total_orders + ' 笔' },
      { label: '退款总额', value: '¥ ' + (fen(totals.refund_revenue) / 100).toLocaleString(), trend: '客单价 ¥' + (avgPrice / 100).toFixed(1) }
    ],
    monthly,
    sources
  };
}

/**
 * 候补转正：把某场次最早的 waiting 排位者转正为正式订课（需在事务内调用）
 * @returns {object|null} 转正的排位记录（含用户/场次信息）
 */
function promoteFromWaitlist(sessionId) {
  const waiting = db.prepare("SELECT * FROM waitlist WHERE session_id = ? AND status = 'waiting' ORDER BY created_at, id LIMIT 1").get(sessionId);
  if (!waiting) return null;

  // 生成订课单号并创建 booking
  const bookingNo = 'BK' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare(`INSERT INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status)
              VALUES (?, ?, ?, ?, 'booked', 'paid')`)
    .run(bookingNo, waiting.user_openid, waiting.session_id, waiting.amount_fen);
  const bookingId = db.prepare('SELECT id FROM bookings WHERE booking_no = ?').get(bookingNo).id;
  // 扣减余位（退订时已 +1，这里 -1 抵消，保持满员状态）
  db.prepare('UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ?').run(sessionId);
  // 更新排位记录为已转正
  db.prepare("UPDATE waitlist SET status = 'promoted', promoted_at = datetime('now','localtime') WHERE id = ?").run(waiting.id);
  // 订单联动：原排位订单关联到新 booking（订单保持 paid，即排位费转为订课费）
  db.prepare("UPDATE orders SET booking_id = ?, wait_id = ?, order_type = 'book' WHERE wait_id = ? AND status = 'paid'")
    .run(bookingId, waiting.id, waiting.id);

  return {
    id: waiting.id,
    wait_no: waiting.wait_no,
    user_openid: waiting.user_openid,
    session_id: waiting.session_id,
    amount_fen: waiting.amount_fen
  };
}

/**
 * 满员付费排位
 * @param {object} p { user_openid, session_id, amount_fen }
 * @returns {{ok:true, wait:{}}|{ok:false, error:string}}
 */
function joinWaitlist({ user_openid, session_id, amount_fen = 0 }) {
  const user = findUserByOpenid(user_openid);
  if (!user) return { ok: false, error: '用户不存在，请先登录' };

  const session = getSessionById(session_id);
  if (!session) return { ok: false, error: '课程场次不存在' };
  if (session.status !== 'published') return { ok: false, error: '课程已下线' };

  // 已订过 → 无需排位
  const existing = db.prepare("SELECT id FROM bookings WHERE user_openid = ? AND session_id = ? AND status = 'booked'").get(user_openid, session_id);
  if (existing) return { ok: false, error: '您已预订该课程' };

  // 已在排位 → 防重复
  const queued = db.prepare("SELECT id FROM waitlist WHERE user_openid = ? AND session_id = ? AND status = 'waiting'").get(user_openid, session_id);
  if (queued) return { ok: false, error: '您已在候补队列中' };

  // 有余位 → 直接订课更合适（前端应引导，这里兜底拒绝排位）
  if (session.remaining > 0) {
    return { ok: false, error: '该课程仍有余位，请直接预订' };
  }

  const waitNo = 'WL' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  db.prepare(`INSERT INTO waitlist (wait_no, user_openid, session_id, amount_fen, status)
              VALUES (?, ?, ?, ?, 'waiting')`)
    .run(waitNo, user_openid, session_id, amount_fen);
  const wait = db.prepare(`
    SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.created_at,
           s.date, s.start_time, s.end_time, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE w.id = last_insert_rowid()
  `).get();
  return { ok: true, wait };
}

/**
 * 主动退出候补（退款）
 */
function cancelWaitlist(openid, waitId) {
  const wait = db.prepare('SELECT * FROM waitlist WHERE id = ? AND user_openid = ?').get(waitId, openid);
  if (!wait) return { ok: false, error: '排位记录不存在' };
  if (wait.status !== 'waiting') return { ok: false, error: '该排位已不在队列中' };
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE waitlist SET status = 'cancelled', cancel_reason = '用户退出候补', refunded_at = datetime('now','localtime') WHERE id = ?").run(waitId);
    // 关联订单标记退款
    db.prepare(`UPDATE orders SET status = 'refunded', refunded_at = datetime('now','localtime'), cancel_reason = '用户退出候补'
                WHERE wait_id = ? AND status = 'paid'`).run(waitId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

/**
 * 查询某学员的全部候补记录
 */
function listWaitlistByUser(openid) {
  return db.prepare(`
    SELECT w.id, w.wait_no, w.session_id, w.amount_fen, w.status, w.created_at, w.promoted_at, w.refunded_at,
           s.date, s.start_time, s.end_time, s.capacity, s.booked_count,
           c.id AS course_id, c.name AS course_name, c.level, c.duration_min,
           co.name AS coach_name, v.name AS venue_name
    FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    JOIN courses c ON c.id = s.course_id
    JOIN coaches co ON co.id = s.coach_id
    JOIN venues v ON v.id = s.venue_id
    WHERE w.user_openid = ?
    ORDER BY w.created_at DESC
  `).all(openid);
}

/**
 * 过期退款任务：课程已开始仍未排到 → 自动退款（标记 refunded）
 * @returns {number} 退款的条数
 */
function refundExpiredWaitlist() {
  const expired = db.prepare(`
    SELECT w.id FROM waitlist w
    JOIN course_sessions s ON s.id = w.session_id
    WHERE w.status = 'waiting'
      AND (s.date < date('now','localtime')
           OR (s.date = date('now','localtime') AND s.start_time < time('now','localtime')))
  `).all();
  for (const row of expired) {
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE waitlist SET status = 'refunded', cancel_reason = '课程开始未排到，自动退款', refunded_at = datetime('now','localtime') WHERE id = ?").run(row.id);
      db.prepare(`UPDATE orders SET status = 'refunded', refunded_at = datetime('now','localtime'), cancel_reason = '课程开始未排到，自动退款'
                  WHERE wait_id = ? AND status = 'paid'`).run(row.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return expired.length;
}

/**
 * 统计某学员订课数量
 */
function countBookingsByUser(openid) {
  return db.prepare("SELECT COUNT(*) c FROM bookings WHERE user_openid = ? AND status = 'booked'").get(openid).c;
}

/**
 * 统计已完成的锻炼次数 = 已订（booked）且场次已结束的总数
 * 场次已结束：日期早于今天，或日期=今天且结束时间早于当前时间
 */
function countFinishedWorkouts(openid) {
  const row = db.prepare(`
    SELECT COUNT(*) c
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE b.user_openid = ? AND b.status = 'booked'
      AND (s.date < date('now','localtime')
           OR (s.date = date('now','localtime') AND s.end_time < time('now','localtime')))
  `).get(openid);
  return row.c;
}

/**
 * 统计当前未开始的已订课（待上课）
 */
function countUpcomingBookings(openid) {
  const row = db.prepare(`
    SELECT COUNT(*) c
    FROM bookings b
    JOIN course_sessions s ON s.id = b.session_id
    WHERE b.user_openid = ? AND b.status = 'booked'
      AND (s.date > date('now','localtime')
           OR (s.date = date('now','localtime') AND s.start_time >= time('now','localtime')))
  `).get(openid);
  return row.c;
}

module.exports = {
  db,
  findUserByOpenid,
  createUser,
  touchLogin,
  updateProfile,
  countUsers,
  listUsers,
  deleteUserById,
  deleteUserByOpenid,
  clearUsers,
  // 课程相关
  listCoaches,
  listVenues,
  listCourses,
  getRules,
  replaceRules,
  createCourse,
  updateCourse,
  deleteCourse,
  publishSessions,
  // 场次查询
  listSessionsByDate,
  listSessionsByDateForUser,
  listSessionsByCoach,
  listSessionsByRange,
  cancelSession,
  updateSessionCapacity,
  getSessionById,
  // 订课
  createBooking,
  listBookingsByUser,
  cancelBooking,
  countBookingsByUser,
  countFinishedWorkouts,
  countUpcomingBookings,
  // 签到
  getCheckinInfo,
  checkinBooking,
  listBookingsBySession,
  // 候补排位
  joinWaitlist,
  cancelWaitlist,
  listWaitlistByUser,
  refundExpiredWaitlist,
  // 订单
  createOrder,
  payOrder,
  listOrdersByUser,
  getOrderByNo,
  // 营收统计
  getRevenueStats,
  // 会员体系
  getMemberLevel,
  addBalance,
  applyRecharge,
  RECHARGE_PLANS,
  listRecharges,
  bindInvitation,
  rewardInviter,
  getInviteStats,
  listUnreadBalanceLogs,
  markBalanceLogsRead,
  // 能量币
  addCoins,
  getCoinInfo,
  listCoinLogs,
  listShopItems,
  exchangeCoinItem,
  listMyExchanges,
  checkLevelUpReward,
  rewardInviterCoins,
  ENERGY_CONFIG
};
