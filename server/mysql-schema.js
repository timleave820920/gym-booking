/**
 * MySQL 版建表 DDL（DESIGN #D2 S5）
 * 与 server/db-core.js 的 SQLite 版一一对应，约定：
 *  - 20 张表一次建齐，无 ALTER 兼容段（新库直接全量结构）
 *  - 时间列：带 CURRENT_TIMESTAMP 默认值的列用 DATETIME（MySQL 只允许 TIMESTAMP/DATETIME 列
 *    用时间默认值，VARCHAR+DEFAULT (CURRENT_TIMESTAMP) 是 SQLite 方言写法会建表报错，BUG-LEDGER #31）；
 *    无默认值的可空时间列（checkin_at/paid_at 等）仍 VARCHAR(19)。驱动 dateStrings: true 让
 *    DATETIME 以 'YYYY-MM-DD HH:MM:SS' 字符串返回，应用层契约与 SQLite 一致（time.js 解析）。
 *    CURRENT_TIMESTAMP 落库时区由连接级 SET time_zone='+08:00' 保证北京时区，
 *    与容器 TZ=Asia/Shanghai 的 SQLite localtime 语义一致，防 BUG-LEDGER #28 重演）
 *  - 索引内联在 CREATE TABLE（KEY ...），无独立 CREATE INDEX（MySQL 不支持 IF NOT EXISTS）
 *  - `desc`/`change`/`date`/`role` 是 MySQL 保留字，列名须带反引号（SQLite 无需；反引号双方言兼容）——
 *    新增列前先对照 MySQL 8.0 保留字清单（BUG-LEDGER #32：裸保留字 → 生产建表 ER_PARSE_ERROR）
 *  - coach_config 单行表用 INSERT IGNORE 种子
 */
'use strict';

const MYSQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  openid          VARCHAR(64) NOT NULL UNIQUE,
  nickname        VARCHAR(128) DEFAULT '',
  avatar          VARCHAR(500) DEFAULT '',
  phone           VARCHAR(32) DEFAULT '',
  \`role\`        VARCHAR(16) DEFAULT 'student',
  total_classes   INT DEFAULT 0,
  total_hours     VARCHAR(16) DEFAULT '0h',
  total_calories  VARCHAR(16) DEFAULT '0',
  streak          INT DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  login_count     INT DEFAULT 0,
  balance_fen     INT DEFAULT 0,
  coin_balance    INT DEFAULT 0,
  level_lv        INT DEFAULT 1,
  gender          TINYINT DEFAULT 0,       -- 社交画像（DESIGN #D5）：0未填/1男/2女
  birthday        VARCHAR(10) DEFAULT '',  -- YYYY-MM-DD（存生日不存年龄）
  profile_bonus_claimed TINYINT DEFAULT 0, -- 填单奖励已领（防重复）
  \`source\`       VARCHAR(10) DEFAULT '',  -- 客户来源渠道短码（DESIGN #D7，first-touch 拉新归因）
  last_channel    VARCHAR(10) DEFAULT '',  -- last-touch 促单归因（30 天保护期）
  last_channel_at VARCHAR(19),             -- last-touch 时间戳（保护期判据）
  channel_batch   VARCHAR(50) DEFAULT ''   -- 首次归因的投放批次
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS class_packages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(64) NOT NULL UNIQUE,
  total_count INT NOT NULL,
  valid_days  INT NOT NULL,
  price_fen   INT NOT NULL,
  \`desc\`      VARCHAR(500) DEFAULT '',
  active      INT DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_passes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64) NOT NULL,
  order_id    INT NOT NULL,
  total_count INT NOT NULL,
  remaining   INT NOT NULL,
  expires_at  VARCHAR(19) NOT NULL,
  status      VARCHAR(16) DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_passes_user (user_openid, status),
  CONSTRAINT fk_passes_user FOREIGN KEY (user_openid) REFERENCES users(openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_achievements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64) NOT NULL,
  ach_key     VARCHAR(64) NOT NULL,
  coin_reward INT DEFAULT 50,
  unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_openid, ach_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS member_recharges (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  recharge_no VARCHAR(32) NOT NULL UNIQUE,
  user_openid VARCHAR(64) NOT NULL,
  order_id    INT,
  amount_fen  INT DEFAULT 0,
  bonus_fen   INT DEFAULT 0,
  status      VARCHAR(16) DEFAULT 'paid',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recharges_user FOREIGN KEY (user_openid) REFERENCES users(openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS balance_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_openid   VARCHAR(64) NOT NULL,
  change_fen    INT NOT NULL,
  balance_after INT DEFAULT 0,
  reason        VARCHAR(128) DEFAULT '',
  ref_id        VARCHAR(64) DEFAULT '',
  read_flag     INT DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_balance_logs_unread (user_openid, read_flag),
  CONSTRAINT fk_balance_user FOREIGN KEY (user_openid) REFERENCES users(openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invitations (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  inviter     VARCHAR(64) NOT NULL,
  invitee     VARCHAR(64) NOT NULL,
  status      VARCHAR(16) DEFAULT 'registered',
  reward_fen  INT DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (invitee)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coin_logs (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_openid    VARCHAR(64) NOT NULL,
  \`change\`     INT NOT NULL,
  balance_after  INT DEFAULT 0,
  reason         VARCHAR(128) DEFAULT '',
  ref_id         VARCHAR(64) DEFAULT '',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_coin_logs_user (user_openid, created_at),
  CONSTRAINT fk_coin_user FOREIGN KEY (user_openid) REFERENCES users(openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coin_exchanges (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64) NOT NULL,
  item_id     VARCHAR(64) NOT NULL,
  item_name   VARCHAR(128) NOT NULL,
  cost        INT NOT NULL,
  code        VARCHAR(64),
  status      VARCHAR(16) DEFAULT 'pending',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exchanges_user FOREIGN KEY (user_openid) REFERENCES users(openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coaches (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64),
  name        VARCHAR(64) NOT NULL,
  avatar      VARCHAR(500) DEFAULT '',
  skills      VARCHAR(255) DEFAULT '',
  rating      DOUBLE DEFAULT 5.0,
  status      VARCHAR(16) DEFAULT 'active',
  bio         VARCHAR(1000) DEFAULT '',
  life_photo  VARCHAR(500) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS venues (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(64) NOT NULL,
  location VARCHAR(255) DEFAULT '',
  capacity INT DEFAULT 20,
  status   VARCHAR(16) DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS courses (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(128) NOT NULL,
  category      VARCHAR(64) NOT NULL,
  level         INT DEFAULT 3,
  duration_min  INT DEFAULT 60,
  price_fen     INT DEFAULT 6800,
  cover         VARCHAR(500) DEFAULT '',
  description   VARCHAR(500) DEFAULT '',
  tags          VARCHAR(255) DEFAULT '',
  status        VARCHAR(16) DEFAULT 'published',
  images        VARCHAR(2000) DEFAULT '[]',
  summary       VARCHAR(255) DEFAULT '',
  address       VARCHAR(255) DEFAULT '',
  lat           DOUBLE DEFAULT 0,
  lng           DOUBLE DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS schedule_templates (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  course_id  INT NOT NULL,
  weekday    INT NOT NULL,
  start_time VARCHAR(8) NOT NULL,
  end_time   VARCHAR(8) NOT NULL,
  venue_id   INT NOT NULL,
  coach_id   INT NOT NULL,
  capacity   INT DEFAULT 20,
  CONSTRAINT fk_tpl_course FOREIGN KEY (course_id) REFERENCES courses(id),
  CONSTRAINT fk_tpl_venue  FOREIGN KEY (venue_id)  REFERENCES venues(id),
  CONSTRAINT fk_tpl_coach  FOREIGN KEY (coach_id)  REFERENCES coaches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS course_sessions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  course_id    INT NOT NULL,
  coach_id     INT NOT NULL,
  venue_id     INT NOT NULL,
  \`date\`     VARCHAR(10) NOT NULL,
  start_time   VARCHAR(8) NOT NULL,
  end_time     VARCHAR(8) NOT NULL,
  capacity     INT DEFAULT 20,
  booked_count INT DEFAULT 0,
  status       VARCHAR(16) DEFAULT 'published',
  source       VARCHAR(16) DEFAULT 'manual',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sessions_date ( \`date\`, status),
  KEY idx_sessions_course (course_id, \`date\`),
  CONSTRAINT fk_sess_course FOREIGN KEY (course_id) REFERENCES courses(id),
  CONSTRAINT fk_sess_coach  FOREIGN KEY (coach_id)  REFERENCES coaches(id),
  CONSTRAINT fk_sess_venue  FOREIGN KEY (venue_id)  REFERENCES venues(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64) NOT NULL,
  type        VARCHAR(16) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  content     VARCHAR(2000) NOT NULL DEFAULT '',
  biz_type    VARCHAR(32) DEFAULT '',
  biz_id      INT DEFAULT 0,
  jump_url    VARCHAR(500) DEFAULT '',
  dedup_key   VARCHAR(128) DEFAULT '',
  is_read     INT DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_messages_user (user_openid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bookings (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  booking_no    VARCHAR(32) NOT NULL UNIQUE,
  user_openid   VARCHAR(64) NOT NULL,
  session_id    INT NOT NULL,
  amount_fen    INT DEFAULT 0,
  status        VARCHAR(16) DEFAULT 'booked',
  pay_status    VARCHAR(16) DEFAULT 'unpaid',
  checkin_at    VARCHAR(19),
  checkin_code  VARCHAR(5),
  cancel_reason VARCHAR(255) DEFAULT '',
  pay_source    VARCHAR(16) DEFAULT 'wxpay',
  pass_id       INT DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_openid, session_id),
  CONSTRAINT fk_book_user FOREIGN KEY (user_openid) REFERENCES users(openid),
  CONSTRAINT fk_book_sess FOREIGN KEY (session_id)  REFERENCES course_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS waitlist (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  wait_no       VARCHAR(32) NOT NULL UNIQUE,
  user_openid   VARCHAR(64) NOT NULL,
  session_id    INT NOT NULL,
  amount_fen    INT DEFAULT 0,
  status        VARCHAR(16) DEFAULT 'waiting',
  expire_mode   VARCHAR(16) DEFAULT 'start',
  pay_source    VARCHAR(16) DEFAULT 'wxpay',
  pass_id       INT DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  promoted_at   VARCHAR(19),
  refunded_at   VARCHAR(19),
  cancel_reason VARCHAR(255) DEFAULT '',
  UNIQUE (user_openid, session_id),
  KEY idx_waitlist_status (status, created_at),
  CONSTRAINT fk_wait_user FOREIGN KEY (user_openid) REFERENCES users(openid),
  CONSTRAINT fk_wait_sess FOREIGN KEY (session_id)  REFERENCES course_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  order_no         VARCHAR(32) NOT NULL UNIQUE,
  user_openid      VARCHAR(64) NOT NULL,
  session_id       INT,
  booking_id       INT,
  wait_id          INT,
  order_type       VARCHAR(16) DEFAULT 'book',
  amount_fen       INT DEFAULT 0,
  status           VARCHAR(16) DEFAULT 'pending',
  pay_method       VARCHAR(16) DEFAULT 'balance',
  pay_source       VARCHAR(16) DEFAULT 'balance',
  expire_mode      VARCHAR(16) DEFAULT 'start',
  paid_at          VARCHAR(19),
  refunded_at      VARCHAR(19),
  cancel_reason    VARCHAR(255) DEFAULT '',
  reward_triggered INT DEFAULT 0,
  channel_id       VARCHAR(10) DEFAULT '',  -- 客户来源促单归因快照（DESIGN #D7，下单时读 last_channel）
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_orders_user (user_openid, status),
  KEY idx_orders_status (status, created_at),
  CONSTRAINT fk_order_user FOREIGN KEY (user_openid) REFERENCES users(openid),
  CONSTRAINT fk_order_sess FOREIGN KEY (session_id)  REFERENCES course_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coach_config (
  id                 INT PRIMARY KEY,
  course_fee_fen     INT NOT NULL DEFAULT 10000,
  checkin_reward_fen INT NOT NULL DEFAULT 500,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_single CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coach_notes (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  coach_openid   VARCHAR(64) NOT NULL,
  student_openid VARCHAR(64) NOT NULL,
  content        VARCHAR(2000) DEFAULT '',
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (coach_openid, student_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_logs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  action     VARCHAR(32) NOT NULL,
  detail     VARCHAR(2000) DEFAULT '',
  operator   VARCHAR(64) DEFAULT 'admin',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 浏览埋点（DESIGN #D5）
CREATE TABLE IF NOT EXISTS course_events (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  openid      VARCHAR(64) NOT NULL,
  event_type  VARCHAR(32) NOT NULL,
  target_id   INT DEFAULT 0,
  keyword     VARCHAR(64) DEFAULT '',
  source      VARCHAR(32) DEFAULT '',
  page        VARCHAR(64) DEFAULT '',
  session_id  VARCHAR(64) DEFAULT '',
  duration_ms INT DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_events_openid (openid, event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 运营日报（DESIGN #D6）：当日主键幂等
CREATE TABLE IF NOT EXISTS daily_reports (
  \`date\`      VARCHAR(10) PRIMARY KEY,
  summary     VARCHAR(500) DEFAULT '',
  metrics     TEXT DEFAULT NULL,
  trends      TEXT DEFAULT NULL,
  actions     TEXT DEFAULT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 吐槽反馈（DESIGN #D9）：学员实名留言，后台收件箱逐条回复
CREATE TABLE IF NOT EXISTS feedbacks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64) NOT NULL,
  nickname    VARCHAR(128) DEFAULT '',
  avatar      VARCHAR(500) DEFAULT '',
  content     VARCHAR(500) NOT NULL,
  status      VARCHAR(16) DEFAULT 'open',
  reply       VARCHAR(2000) DEFAULT '',
  replied_at  VARCHAR(19),
  reply_by    VARCHAR(64) DEFAULT '',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_feedbacks_status (status, created_at),
  CONSTRAINT fk_fb_user FOREIGN KEY (user_openid) REFERENCES users(openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 季卡/年卡（DESIGN #D14）：有效期内无限次订课 0 元，同一时间只能订一堂课
CREATE TABLE IF NOT EXISTS unlimited_plans (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  \`type\`     VARCHAR(16) NOT NULL,
  name       VARCHAR(32) NOT NULL,
  months     INT NOT NULL,
  price_fen  INT NOT NULL,
  active     INT DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS unlimited_passes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64) NOT NULL,
  \`type\`      VARCHAR(16) NOT NULL,
  order_id    INT DEFAULT 0,
  start_at    VARCHAR(19) NOT NULL,
  expires_at  VARCHAR(19) NOT NULL,
  status      VARCHAR(16) DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_unl_pass_user (user_openid, status),
  CONSTRAINT fk_unl_user FOREIGN KEY (user_openid) REFERENCES users(openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

module.exports = { MYSQL_SCHEMA };
