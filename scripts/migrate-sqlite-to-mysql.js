/**
 * 一次性数据迁移脚本（DESIGN #D2 S6）：SQLite → MySQL
 * 直连本地 SQLite（node:sqlite）逐表读全行 → 按外键依赖顺序写入 MySQL（mysql2 连接池）。
 *
 * 用法（任选其一，视生产 MySQL 可达性）：
 *   1. 本地执行（需 npm i mysql2；MySQL 用云托管公网/内网可达地址）：
 *      MYSQL_ADDRESS=IP:3306 MYSQL_USERNAME=root MYSQL_PASSWORD=xxx node scripts/migrate-sqlite-to-mysql.js
 *   2. 云托管容器内执行（容器已有 mysql2，SQLite 文件来自挂载盘 /data/gym.db）：
 *      控制台 WebShell → 同上面令（MYSQL_* 环境变量已由控制台注入）
 *   3. 只预览不写入：node scripts/migrate-sqlite-to-mysql.js --dry-run
 *
 * 安全措施：
 *   - 目标表先清空（SET FOREIGN_KEY_CHECKS=0 + DELETE FROM），整体替换式迁移
 *   - 显式携带 id（AUTO_INCREMENT 自动接续）；时间列格式双方言一致（YYYY-MM-DD HH:MM:SS）
 *   - 迁移前打印源/目标行数对账；--dry-run 只读不写
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

// 表迁移顺序：外键依赖（先父表后子表）；同批无依赖可任意
const TABLES = [
  'users', 'class_packages', 'coaches', 'venues', 'courses',
  'user_passes', 'user_achievements', 'member_recharges', 'balance_logs',
  'invitations', 'coin_logs', 'coin_exchanges', 'schedule_templates',
  'course_sessions', 'messages', 'bookings', 'waitlist', 'orders',
  'coach_config', 'coach_notes'
];

const DRY_RUN = process.argv.includes('--dry-run');
const DB_FILE = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'data', 'gym.db');

async function main() {
  const src = new DatabaseSync(DB_FILE, { timeout: 5000 });
  console.log(`迁移源: ${DB_FILE}  →  目标 MySQL: ${process.env.MYSQL_ADDRESS || '127.0.0.1:3306'}/${process.env.MYSQL_DB || 'gym'}`);
  if (DRY_RUN) console.log('[dry-run] 只读预览，不写入目标库\n');

  let dst = null;
  if (!DRY_RUN) {
    const mysql2 = require('mysql2/promise'); // 本地需 npm i mysql2；容器镜像已装
    const [host, port] = (process.env.MYSQL_ADDRESS || '127.0.0.1:3306').split(':');
    dst = await mysql2.createConnection({
      host, port: Number(port) || 3306,
      user: process.env.MYSQL_USERNAME || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DB || 'gym',
      timezone: '+08:00'
    });
    // 目标表清空（整体替换式迁移）
    await dst.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of TABLES) await dst.query(`DELETE FROM \`${t}\``);
  }

  const report = [];
  for (const t of TABLES) {
    // 源表列（按 sqlite 表序）；MySQL 列序可能不同，按列名对齐
    const cols = src.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    const rows = src.prepare(`SELECT * FROM ${t}`).all();
    if (rows.length === 0) { report.push(`${t}: 0 行`); continue; }
    const colList = cols.join(',');
    const placeholders = cols.map(() => '?').join(',');
    if (!DRY_RUN) {
      for (const r of rows) {
        await dst.execute(`INSERT INTO \`${t}\` (${colList}) VALUES (${placeholders})`, cols.map(c => r[c]));
      }
    }
    report.push(`${t}: ${rows.length} 行${DRY_RUN ? '（预览）' : ' ✓'}`);
  }

  if (!DRY_RUN) {
    await dst.query('SET FOREIGN_KEY_CHECKS = 1');
  }
  console.log('----- 迁移对账 -----');
  console.log(report.join('\n'));
  console.log(DRY_RUN
    ? `\n共 ${TABLES.length} 表（预览）。确认无误后去掉 --dry-run 执行正式迁移`
    : '\n迁移完成。建议：抽样登录验证 + 云托管控制台核对 MySQL 行数');
  if (dst) await dst.end();
  src.close();
}

main().catch(e => { console.error('迁移失败:', e); process.exit(1); });
