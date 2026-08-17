/**
 * 测试假用户填充脚本（可重复执行：先清旧假数据再重建）
 * ⚠️ 仅本地/测试造数用（node:sqlite 同步 API 直连 DB_FILE）；生产 MySQL 模式勿执行——
 *    MySQL 下 db 为本地 SQLite 连接，本脚本只会读写本地库（DESIGN #D2）
 * 用法：node server/seed-fake-users.js
 * 行为：
 *  1. 清理旧 fake_ 前缀用户及其订课记录（幂等）
 *  2. 随机创建 3-5 名假用户（昵称/头像随机）
 *  3. 假用户预订 demo_user(田立) 所有已订场次 → 详情页预约墙可见
 * 同堂次数：由后端对 fake_ 用户返回确定性伪随机 0-5（见 server/db/courses.js fakeCoCount）
 * 备注：bookings 有 UNIQUE(user,session)，用 INSERT OR IGNORE 防重
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'data', 'gym.db');
const db = new DatabaseSync(DB_FILE, { timeout: 8000 });
db.exec('PRAGMA foreign_keys = ON;');

const VIEWER = 'demo_user'; // 以谁的场次为准
const NICK_POOL = ['王一诺', '李子墨', '赵思远', '钱朵朵', '孙一凡', '周嘉怡', '吴雨桐', '郑凯文', '陈语嫣', '黄子豪'];
const IMG_DIR = path.join(__dirname, '..', 'miniprogram', 'images');
const AVATARS = fs.readdirSync(IMG_DIR)
  .filter(f => /\.(png|jpe?g)$/i.test(f))
  .map(f => '/images/' + f);

// 1. 清理旧假数据（先删 bookings 再删 users，遵守外键顺序）
const oldUsers = db.prepare("SELECT openid FROM users WHERE openid LIKE 'fake\\_%' ESCAPE '\\'").all();
const delB = db.prepare("DELETE FROM bookings WHERE user_openid LIKE 'fake\\_%' ESCAPE '\\'").run().changes;
const delU = db.prepare("DELETE FROM users WHERE openid LIKE 'fake\\_%' ESCAPE '\\'").run().changes;
console.log(`[清理] 假用户 ${oldUsers.length} 人，bookings ${delB} 条`);

// 2. 随机 3-5 名假用户
const count = 3 + Math.floor(Math.random() * 3); // 3 | 4 | 5
const nicks = [...NICK_POOL].sort(() => Math.random() - 0.5).slice(0, count);
const insU = db.prepare('INSERT INTO users (openid, nickname, avatar, role) VALUES (?,?,?,?)');
const fakes = [];
for (let i = 0; i < count; i++) {
  const oid = `fake_${i + 1}`;
  const nick = nicks[i];
  const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  insU.run(oid, nick, avatar, 'student');
  fakes.push({ oid, nick, avatar });
}

// 3. 假用户预订 VIEWER 的所有已订场次
const sessions = db
  .prepare("SELECT DISTINCT session_id FROM bookings WHERE user_openid = ? AND status = 'booked'")
  .all(VIEWER)
  .map(r => r.session_id);
const insB = db.prepare(
  "INSERT OR IGNORE INTO bookings (booking_no, user_openid, session_id, amount_fen, status, pay_status) VALUES (?,?,?,0,'booked','paid')"
);
let n = 0;
for (const f of fakes) {
  for (const sid of sessions) {
    const no = `BK${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    insB.run(no, f.oid, sid);
    n++;
  }
}

console.log(`[完成] 假用户 ${count} 名：${fakes.map(f => f.nick).join('、')}`);
console.log(`[完成] 预订场次 ${sessions.length} 个 × ${count} 人 = ${n} 条 booking`);
console.log(`[提示] 同堂次数由后端对 fake_ 用户确定性伪随机 0-5；重新编译小程序后进详情页可见`);
db.close();
