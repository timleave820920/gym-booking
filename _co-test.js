const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE bookings (user_openid TEXT, session_id INTEGER, status TEXT)');
// 场景：A/B 同堂 S1,S2（2次）；A/C 同堂 S1,S2,S3（3次）；S4 只有 B；S5 只有 A
const data = [['A',1,'booked'],['B',1,'booked'],['C',1,'booked'],
              ['A',2,'booked'],['B',2,'booked'],['C',2,'booked'],
              ['A',3,'booked'],['C',3,'booked'],
              ['B',4,'booked'],['A',5,'booked']];
for (const r of data) db.prepare('INSERT INTO bookings VALUES (?,?,?)').run(...r);
const sql = `SELECT b2.user_openid AS peer, COUNT(DISTINCT b1.session_id) AS cnt
  FROM bookings b1 JOIN bookings b2 ON b1.session_id = b2.session_id
  WHERE b1.user_openid = ? AND b1.status = 'booked' AND b2.status = 'booked'
  GROUP BY b2.user_openid`;
function co(viewer) {
  const rows = db.prepare(sql).all(viewer);
  const m = {}; for (const r of rows) if (r.peer !== viewer) m[r.peer] = r.cnt;
  return m;
}
console.log('A视角:', JSON.stringify(co('A')), '(期望 B:2 C:3)');
console.log('B视角:', JSON.stringify(co('B')), '(期望 A:2)');
console.log('C视角:', JSON.stringify(co('C')), '(期望 A:3)');
console.log('D视角(无记录):', JSON.stringify(co('D')), '(期望 {})');
