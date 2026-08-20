/**
 * 数据库驱动抽象层（DESIGN #D2 MySQL 持久化迁移，S1）
 * 统一接口 get/all/run/exec/tx（全 async），业务代码不感知底层数据库。
 *  - SQLite 驱动：node:sqlite 同步底层包 async 接口 → 本地/测试/CI（零依赖）
 *  - MySQL 驱动：mysql2 连接池 → 生产（DB_DRIVER=mysql；惰性 require，本地未装不炸）
 * 方言差异（建表/时间函数）收敛在 db-core.js，业务 SQL 写双方言兼容语法。
 * 契约：
 *  - get(sql, params) → 首行对象 | undefined
 *  - all(sql, params) → 行数组
 *  - run(sql, params) → { changes, lastInsertRowid }
 *  - exec(sql)       → 多条语句（建表/seed 专用）
 *  - tx(async fn)    → 事务内 fn(this) 复用同一连接，成功 COMMIT 失败 ROLLBACK 重抛
 */
'use strict';

// ===== SQLite 驱动（node:sqlite 同步底层包 async 接口）=====
class SqliteDriver {
  constructor(db) {
    this._db = db;
    this.isMysql = false;
    this.ready = Promise.resolve(); // SQLite 同步建表（db-core 加载时已建），无需门闩
  }

  async get(sql, params) {
    return this._db.prepare(sql).get(...(params || []));
  }

  async all(sql, params) {
    return this._db.prepare(sql).all(...(params || []));
  }

  async run(sql, params) {
    const r = this._db.prepare(sql).run(...(params || []));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  async exec(sql) { this._db.exec(sql); }

  // 加锁事务开始（并发防重用，BUG-LEDGER #57b）：BEGIN IMMEDIATE 立即持 RESERVED 写锁，
  // 事务内所有读都是当前读——多个并发 createOrder 串行化，第二个事务阻塞到第一个提交后才读到最新行
  async beginExclusive() { this._db.exec('BEGIN IMMEDIATE'); }

  // 加锁读：BEGIN IMMEDIATE 已持写锁，普通读即当前读，无需额外语法
  async getExclusive(sql, params) { return this.get(sql, params); }

  async tx(fn) {
    this._db.exec('BEGIN');
    try {
      const result = await fn(this);
      this._db.exec('COMMIT');
      return result;
    } catch (e) {
      this._db.exec('ROLLBACK');
      throw e;
    }
  }
}

// ===== MySQL 驱动（S5 落地生产路径；mysql2 惰性 require 保持本地零依赖）=====
class MysqlDriver {
  // conn：mysql2 连接池 或 事务内单连接（接口一致）
  // _txConn：事务专用连接——exec('BEGIN') 从池取单连接并开启事务，期间 get/all/run/exec
  // 全部复用该连接（同一事务所有语句同连接），COMMIT/ROLLBACK 后释放归还池。
  // 之前的缺陷（BUG-LEDGER #60 根因）：BEGIN/语句/COMMIT 全走 pool.query/execute 随机连接，
  // 事务被拆散成独立自动提交语句，COMMIT 落在无事务连接上（no-op），事务连接悬空污染池。
  constructor(conn) {
    this._conn = conn;
    this._txConn = null;
    this.isMysql = true;
  }

  // 执行目标：事务进行中 → 事务连接，否则普通连接
  _target() { return this._txConn || this._conn; }

  async get(sql, params) {
    const [rows] = await this._target().execute(sql, params || []);
    return rows[0];
  }

  async all(sql, params) {
    const [rows] = await this._target().execute(sql, params || []);
    return rows;
  }

  async run(sql, params) {
    const [r] = await this._target().execute(sql, params || []);
    return { changes: r.affectedRows, lastInsertRowid: r.insertId };
  }

  // 加锁事务开始（并发防重用，BUG-LEDGER #57b）：MySQL 事务延迟锁，BEGIN 即可，
  // 真正的锁在 getExclusive 的 FOR UPDATE 上（行锁/间隙锁，第二个事务等待第一个提交后读到最新行）
  async beginExclusive() { await this._beginTx(); }

  // 加锁读：FOR UPDATE 锁定读（当前读，看到最新已提交数据；无匹配行时持间隙锁防并发插入）
  async getExclusive(sql, params) { return this.get(sql + ' FOR UPDATE', params); }

  // 拆多条语句逐条执行（建表/seed 用；无过程体，按 ; 切分足够）。
  // BEGIN/COMMIT/ROLLBACK 由本方法管理专用事务连接（单条语句时精确匹配，不带参数）。
  async exec(sql) {
    const head = sql.trim();
    if (/^BEGIN\b/i.test(head)) { await this._beginTx(); return; }
    if (/^COMMIT\b/i.test(head)) { await this._commitTx(); return; }
    if (/^ROLLBACK\b/i.test(head)) { await this._rollbackTx(); return; }
    for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
      await this._target().query(stmt);
    }
  }

  async _beginTx() {
    if (this._txConn) return; // 幂等：重复 BEGIN 不重复取连接
    if (typeof this._conn.getConnection !== 'function') return; // 单连接包装（tx() 内）：事务已由外层 beginTransaction 管理
    const conn = await this._conn.getConnection();
    try {
      await conn.beginTransaction();
    } catch (e) {
      conn.release();
      throw e;
    }
    this._txConn = conn;
  }

  async _commitTx() {
    const conn = this._txConn;
    if (!conn) return;
    this._txConn = null;
    await conn.commit();
    conn.release();
  }

  async _rollbackTx() {
    const conn = this._txConn;
    if (!conn) return;
    this._txConn = null;
    await conn.rollback();
    conn.release();
  }

  async tx(fn) {
    // tx 需要连接池（池有 getConnection，单连接没有）；事务内 fn 用单连接包装，不嵌套取池
    if (typeof this._conn.getConnection !== 'function') throw new Error('MysqlDriver.tx: 需在连接池实例上调用');
    const conn = await this._conn.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(new MysqlDriver(conn));
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
}

// ===== 工厂：按 DB_DRIVER 选择驱动 =====
// MYSQL_ADDRESS 格式 "IP:PORT"（云托管内置 MySQL 内网地址），库名默认 gym
function createMysqlPool() {
  const mysql2 = require('mysql2/promise'); // 惰性 require：本地零依赖下不执行到
  const [host, port] = (process.env.MYSQL_ADDRESS || '127.0.0.1:3306').split(':');
  const pool = mysql2.createPool({
    host,
    port: Number(port) || 3306,
    user: process.env.MYSQL_USERNAME || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DB || 'gym',
    // 连接池大小：默认 50（5000 并发路径——5 个连接下事务全部串行排队，是吞吐第一闸门）；
    // 小规模部署用 MYSQL_POOL_SIZE 环境变量收紧（如 10）。注意 MySQL max_connections 默认 151，
    // 池 + 其他连接（云托管管理连接等）需留余量。
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 50,
    waitForConnections: true,
    // 池耗尽防挂死（2026-08-18 CI test-mysql 首次跑全量即无限挂起：mysql2 默认 queueLimit=0
    // 无限排队 + acquireTimeout 无限等待——池满时请求永远排队，进程永不退出）。
    // 有限排队 + 获取超时：池满 10s 后快速报错（测试红/请求 500），而非无限挂起。
    queueLimit: 200,
    acquireTimeout: 10000,
    timezone: '+08:00', // 让 MySQL 返回的 DATETIME/时间计算按北京时间（BUG-LEDGER #28 防回归）
    dateStrings: true,  // DATETIME 以 'YYYY-MM-DD HH:MM:SS' 字符串返回，与应用层字符串契约一致（BUG-LEDGER #31：建表已改 DATETIME 类型）
    decimalNumbers: true // SUM/ROUND 等聚合返回 DECIMAL——mysql2 默认转字符串，SQLite 返回 number，业务 `typeof === 'number'` 断言在 MySQL 全炸（BUG-LEDGER #60：DASH-07）。金额/计数均 INT 聚合，2^53 内精度安全
  });
  // 每连接初始化：会话时区 +08:00 —— DEFAULT (CURRENT_TIMESTAMP) 的默认时间列按北京落库。
  // ⚠️ 必须用 callback 风格：connection 事件转发的是 callback 版连接（inheritEvents 原样转发 corePool
  // 参数），无回调 query 返回 Query 命令对象——它同时有 then() 和 catch()（Query.prototype.catch = then），
  // 对结果 .catch() 会触发 mysql2 防误用警告 + throw（BUG-LEDGER #29：建表永久挂起、容器 CrashLoop）。
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+08:00'", () => {});
  });
  return pool;
}

// MySQL 老库幂等补列清单（CREATE TABLE IF NOT EXISTS 不会给已存在表加列）
// ⚠️ 新增列三处同步：mysql-schema.js（新库 DDL）+ db-core.js（SQLite ALTER）+ 本清单（MySQL 老库补列）。
// 类型/默认值须与 mysql-schema.js 一一对应（BUG-LEDGER #48：昨晚新增 12 列只进新库 DDL 与 SQLite 侧，
// MySQL 补列仅 checkin_code 一处——生产老表缺列则订课/候补/场次详情全 500）。
// 唯一性靠业务层生成查重（SQLite 不支持 ADD COLUMN 带 UNIQUE 约束，双方言统一不用列级 UNIQUE）
const MYSQL_ENSURE_COLUMNS = {
  coaches: [
    ['life_photo', "VARCHAR(500) DEFAULT ''"],  // 教练生活照（2026-08-19 后台可上传）
  ],
  courses: [
    ['tags', "VARCHAR(255) DEFAULT ''"],
    ['images', "VARCHAR(2000) DEFAULT '[]'"],   // 轮播图（服务器端路径数组 JSON）
    ['summary', "VARCHAR(255) DEFAULT ''"],     // 简要标题
    ['address', "VARCHAR(255) DEFAULT ''"],     // 上课地址
    ['lat', 'DOUBLE DEFAULT 0'],                // 纬度
    ['lng', 'DOUBLE DEFAULT 0'],                // 经度
  ],
  users: [
    ['balance_fen', 'INT DEFAULT 0'],
    ['coin_balance', 'INT DEFAULT 0'],
    ['level_lv', 'INT DEFAULT 1'],
    ['gender', 'TINYINT DEFAULT 0'],                    // 社交画像（DESIGN #D5）
    ['birthday', "VARCHAR(10) DEFAULT ''"],
    ['profile_bonus_claimed', 'TINYINT DEFAULT 0'],
    ['source', "VARCHAR(10) DEFAULT ''"],               // 客户来源（DESIGN #D7）
    ['last_channel', "VARCHAR(10) DEFAULT ''"],
    ['last_channel_at', 'VARCHAR(19)'],
    ['channel_batch', "VARCHAR(50) DEFAULT ''"],
  ],
  bookings: [
    ['checkin_code', 'VARCHAR(5)'],             // 随机 5 位签到码（BUGS-INBOX #11）
    ['pay_source', "VARCHAR(16) DEFAULT 'wxpay'"],  // 支付来源（pass/wxpay/balance）
    ['pass_id', 'INT DEFAULT 0'],               // 次卡 ID（pay_source=pass 时溯源）
  ],
  waitlist: [
    ['expire_mode', "VARCHAR(16) DEFAULT 'start'"],  // 候补自动取消节点
    ['pay_source', "VARCHAR(16) DEFAULT 'wxpay'"],
    ['pass_id', 'INT DEFAULT 0'],
  ],
  orders: [
    ['pay_source', "VARCHAR(16) DEFAULT 'balance'"],
    ['expire_mode', "VARCHAR(16) DEFAULT 'start'"],
    ['reward_triggered', 'INT DEFAULT 0'],
    ['channel_id', "VARCHAR(10) DEFAULT ''"],           // 客户来源促单归因快照（DESIGN #D7）
  ],
};

function createDriver({ sqliteDb } = {}) {
  if (process.env.DB_DRIVER === 'mysql') {
    // 建表由驱动初始化时执行（MySQL 版 DDL 一次建齐，见 mysql-schema.js）；
    // ready 门闩：index.js 启动 `await driver.ready` 后再 listen，保证请求前表已就绪
    const drv = new MysqlDriver(createMysqlPool());
    const { MYSQL_SCHEMA } = require('./mysql-schema');
    drv.ready = (async () => {
      await drv.exec(MYSQL_SCHEMA);
      await drv.exec("INSERT IGNORE INTO coach_config (id) VALUES (1)");
      // 幂等补列：逐表查 information_schema，缺列则 ALTER（表名/列名来自内部常量，非用户输入）
      for (const [table, cols] of Object.entries(MYSQL_ENSURE_COLUMNS)) {
        for (const [colName, colType] of cols) {
          const row = await drv.get(
            'SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
            [table, colName]);
          if (row && row.c === 0) {
            await drv.run(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType}`);
            console.log(`[mysql] 迁移: ${table} 表补 ${colName} 列`);
          }
        }
      }
      console.log('[mysql] 建表完成（' + (MYSQL_SCHEMA.match(/CREATE TABLE/g) || []).length + ' 表）');
    })();
    return drv;
  }
  if (!sqliteDb) throw new Error('createDriver: SQLite 模式需传入 sqliteDb 实例');
  return new SqliteDriver(sqliteDb);
}

module.exports = { SqliteDriver, MysqlDriver, createDriver };
