/**
 * 数据库层 - SQLite (node:sqlite)
 * 综合训练馆订课系统
 * 存储已注册用户，支持注册/登录判定
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, 'data');
// 数据库文件路径：默认 server/data/gym.db，可用 DB_PATH 环境变量覆盖（测试干净库模式）
const DB_FILE = process.env.DB_PATH || path.join(DATA_DIR, 'gym.db');
// 确保数据目录存在
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

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
// 候补自动取消节点（start=开课时 / 1h / 2h）
try { db.exec("ALTER TABLE waitlist ADD COLUMN expire_mode TEXT DEFAULT 'start'"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN expire_mode TEXT DEFAULT 'start'"); } catch (e) {}
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

// 站内信消息表（消息中心）
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_openid TEXT NOT NULL,
    type        TEXT NOT NULL,          -- booking/waitlist/order/member/system/promo/remind
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    biz_type    TEXT DEFAULT '',
    biz_id      INTEGER DEFAULT 0,
    jump_url    TEXT DEFAULT '',
    dedup_key   TEXT DEFAULT '',        -- 去重键（如 class_remind:7），防重复推送
    is_read     INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_openid, created_at DESC);
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
    session_id   INTEGER,                -- 充值订单无场次，允许 NULL（CI 干净环境验证发现；负向验证已确认干净库模式可本地拦截）
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

// 供各域模块复用
module.exports = { db, courseCols };
