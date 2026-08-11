/**
 * 初始数据种子脚本 - 综合训练馆订课系统
 * 运行：node server/seed.js
 * 幂等：已有数据则跳过，可安全重复执行
 */
const { db } = require('./db');

function count(table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// ===== 1. 教练 =====
if (count('coaches') === 0) {
  const ins = db.prepare('INSERT INTO coaches (name, avatar, skills, rating, status) VALUES (?, ?, ?, ?, ?)');
  ins.run('喻馥雅', '/images/2_1468.png', 'Hybrid综合体能,引体向上,产后康复', 5.0, 'active');
  ins.run('马春艳', '/images/2_1474.png', '减脂', 5.0, 'active');
  console.log('[coaches] 已插入 2 名教练');
} else {
  console.log('[coaches] 已有数据，跳过');
}

// ===== 2. 场地 =====
if (count('venues') === 0) {
  db.prepare('INSERT INTO venues (name, location, capacity, status) VALUES (?, ?, ?, ?)')
    .run('成华好事馆', '', 20, 'active');
  console.log('[venues] 已插入 1 个场地');
} else {
  console.log('[venues] 已有数据，跳过');
}

// ===== 3. 课程模板 =====
if (count('courses') === 0) {
  const ins = db.prepare('INSERT INTO courses (name, category, level, duration_min, price_fen, cover, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const r1 = ins.run('Hyrox冲冲冲', 'Hybrid综合训练', 3, 60, 8000, '', '', 'published');
  const r2 = ins.run('Hyrox新手', 'Hybrid综合训练', 1, 60, 9000, '', '', 'published');
  console.log(`[courses] 已插入 2 门课程（id=${r1.lastInsertRowid}, ${r2.lastInsertRowid}）`);
} else {
  console.log('[courses] 已有数据，跳过');
}

// ===== 4. 每周排课规则（周一~周日 × 6 时段）=====
const SLOTS = [
  { start: '10:00', end: '11:00', courseIdx: 0 },
  { start: '11:00', end: '12:00', courseIdx: 1 },
  { start: '15:00', end: '16:00', courseIdx: 0 },
  { start: '16:00', end: '17:00', courseIdx: 1 },
  { start: '20:00', end: '21:00', courseIdx: 0 },
  { start: '21:00', end: '22:00', courseIdx: 1 }
];

if (count('schedule_templates') === 0) {
  const course = db.prepare('SELECT id FROM courses ORDER BY id').all(); // [Hyrox冲冲冲, Hyrox新手]
  const coachId = db.prepare("SELECT id FROM coaches WHERE name = '喻馥雅'").get().id;
  const venueId = db.prepare("SELECT id FROM venues WHERE name = '成华好事馆'").get().id;
  const ins = db.prepare('INSERT INTO schedule_templates (course_id, weekday, start_time, end_time, venue_id, coach_id, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (const s of SLOTS) {
      ins.run(course[s.courseIdx].id, weekday, s.start, s.end, venueId, coachId, 20);
    }
  }
  console.log('[schedule_templates] 已插入 42 条周规则');
} else {
  console.log('[schedule_templates] 已有数据，跳过');
}

// ===== 5. 课程场次（2026-08-10 ~ 2026-08-30，每天 6 堂，规律一致）=====
if (count('course_sessions') === 0) {
  const course = db.prepare('SELECT id FROM courses ORDER BY id').all();
  const coachId = db.prepare("SELECT id FROM coaches WHERE name = '喻馥雅'").get().id;
  const venueId = db.prepare("SELECT id FROM venues WHERE name = '成华好事馆'").get().id;
  const ins = db.prepare(`INSERT INTO course_sessions (course_id, coach_id, venue_id, date, start_time, end_time, capacity, booked_count, status, source)
                          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'published', 'manual')`);

  const start = new Date(2026, 7, 10); // 8月10日
  const end = new Date(2026, 7, 30);   // 8月30日
  let inserted = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    for (const s of SLOTS) {
      ins.run(course[s.courseIdx].id, coachId, venueId, fmtDate(d), s.start, s.end, 20);
      inserted++;
    }
  }
  console.log(`[course_sessions] 已插入 ${inserted} 个场次（8/10~8/30 每天 6 堂）`);
} else {
  console.log('[course_sessions] 已有数据，跳过');
}

// ===== 汇总 =====
console.log('----- 数据汇总 -----');
for (const t of ['coaches', 'venues', 'courses', 'schedule_templates', 'course_sessions', 'bookings']) {
  console.log(`${t}: ${count(t)} 条`);
}
