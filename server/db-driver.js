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
  constructor(db) { this._db = db; }

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
  constructor(conn) { this._conn = conn; }

  async get(sql, params) {
    const [rows] = await this._conn.execute(sql, params || []);
    return rows[0];
  }

  async all(sql, params) {
    const [rows] = await this._conn.execute(sql, params || []);
    return rows;
  }

  async run(sql, params) {
    const [r] = await this._conn.execute(sql, params || []);
    return { changes: r.affectedRows, lastInsertRowid: r.insertId };
  }

  // 拆多条语句逐条执行（建表/seed 用；无过程体，按 ; 切分足够）
  async exec(sql) {
    for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
      await this._conn.query(stmt);
    }
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
  return mysql2.createPool({
    host,
    port: Number(port) || 3306,
    user: process.env.MYSQL_USERNAME || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DB || 'gym',
    connectionLimit: 5,
    waitForConnections: true
  });
}

function createDriver({ sqliteDb } = {}) {
  if (process.env.DB_DRIVER === 'mysql') {
    return new MysqlDriver(createMysqlPool());
  }
  if (!sqliteDb) throw new Error('createDriver: SQLite 模式需传入 sqliteDb 实例');
  return new SqliteDriver(sqliteDb);
}

module.exports = { SqliteDriver, MysqlDriver, createDriver };
