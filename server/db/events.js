/**
 * 浏览埋点域（DESIGN #D5）：用户行为事件采集与浏览分析
 * 目的：捕捉「看了没订」的意图——浏览行为是比订课行为更实时、更接近购买的兴趣信号。
 * 事件类型白名单：page_view / course_view / course_list_view / search
 * （banner_click / waitlist_view 预留扩展，前端未埋点前不采集）
 */
const { driver } = require('../db-core');

const EVENT_TYPES = ['page_view', 'course_view', 'course_list_view', 'search', 'waitlist_view', 'banner_click', 'channel_open'];

/**
 * 批量落埋点事件（前端 track.js 攒批上报）
 * @param {string} openid
 * @param {Array} events [{ event_type, target_id, keyword, source, page, session_id, duration_ms }]
 * @returns {number} 实际落库条数（白名单外事件静默丢弃）
 */
async function batchTrack(openid, events) {
  if (!openid || !Array.isArray(events) || events.length === 0) return 0;
  let accepted = 0;
  const valid = events.filter(e => e && EVENT_TYPES.includes(e.event_type)).slice(0, 50);
  if (valid.length === 0) return 0;
  await driver.exec('BEGIN');
  try {
    for (const e of valid) {
      const targetId = Number(e.target_id) || 0;
      const keyword = String(e.keyword || '').slice(0, 64);
      const source = String(e.source || '').slice(0, 32);
      const page = String(e.page || '').slice(0, 64);
      const sessionId = String(e.session_id || '').slice(0, 64);
      const durationMs = Number(e.duration_ms) || 0;
      await driver.run(
        `INSERT INTO course_events (openid, event_type, target_id, keyword, source, page, session_id, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [openid, e.event_type, targetId, keyword, source, page, sessionId, durationMs]);
      accepted++;
    }
    await driver.exec('COMMIT');
  } catch (err) {
    await driver.exec('ROLLBACK').catch(() => {});
    throw err;
  }
  return accepted;
}

/**
 * 浏览分析聚合（运营侧看板）
 * @param {string} day YYYY-MM-DD
 * @returns {object} 漏斗 / 意图人群 / 搜索词 / 热度对比
 */
async function eventsAnalysis(day) {
  const since = `${day} 00:00:00`;
  const since7 = `${subDays(day, 7)} 00:00:00`;

  // 1. 浏览→订课漏斗（当日）：曝光（首页 page_view）→ 详情浏览（course_view 去重人课）→ 下单（paid book 订单）→ 签到
  const funnel = {
    expose: (await countRow(`SELECT COUNT(*) c FROM course_events WHERE event_type = 'page_view' AND created_at >= ?`, [since])).c,
    detail: (await countRow(`SELECT COUNT(*) c FROM (SELECT DISTINCT openid, target_id FROM course_events WHERE event_type = 'course_view' AND target_id > 0 AND created_at >= ?) t`, [since])).c,
    booked: (await countRow(`SELECT COUNT(*) c FROM bookings b JOIN course_sessions s ON s.id = b.session_id WHERE b.status = 'booked' AND s.date = ?`, [day])).c,
    checkin: (await countRow(`SELECT COUNT(*) c FROM bookings b JOIN course_sessions s ON s.id = b.session_id WHERE b.status = 'booked' AND b.checkin_at IS NOT NULL AND s.date = ?`, [day])).c
  };

  // 2. 意图人群：近 7 天浏览同一课程 ≥2 次但从未订过该课程 = 高意向
  const intent = await driver.all(`
    SELECT e.openid, e.target_id, c.name AS course_name, COUNT(*) view_count,
           MAX(e.created_at) last_view
    FROM course_events e LEFT JOIN courses c ON c.id = e.target_id
    WHERE e.event_type = 'course_view' AND e.target_id > 0 AND e.created_at >= ?
    GROUP BY e.openid, e.target_id HAVING COUNT(*) >= 2
      AND NOT EXISTS (
        SELECT 1 FROM bookings b JOIN course_sessions s ON s.id = b.session_id
        WHERE b.user_openid = e.openid AND s.course_id = e.target_id AND b.status = 'booked'
      )`, [since7]);

  // 3. 搜索词：TOP（近 7 天）+ 无结果词（搜索后 7 天内未发生该课浏览/下单——简化：无对应课程名的词）
  const searchTop = await driver.all(`
    SELECT keyword, COUNT(*) c, COUNT(DISTINCT openid) users
    FROM course_events WHERE event_type = 'search' AND keyword <> '' AND created_at >= ?
    GROUP BY keyword ORDER BY c DESC LIMIT 20`, [since7]);

  // 4. 热度对比：浏览热度 vs 订课热度（近 7 天浏览 top 课程，对照订课量）
  const hotByView = await driver.all(`
    SELECT e.target_id, c.name, COUNT(*) views,
      (SELECT COUNT(*) FROM bookings b JOIN course_sessions s ON s.id = b.session_id
        WHERE s.course_id = e.target_id AND b.status = 'booked') booked
    FROM course_events e LEFT JOIN courses c ON c.id = e.target_id
    WHERE e.event_type = 'course_view' AND e.target_id > 0 AND e.created_at >= ?
    GROUP BY e.target_id ORDER BY views DESC LIMIT 10`, [since7]);

  return { date: day, funnel, intent, search: { top: searchTop }, hot_by_view: hotByView };
}

async function countRow(sql, params) {
  const r = await driver.get(sql, params);
  return r || { c: 0 };
}

// 日期减 N 天（YYYY-MM-DD，与 time.js 口径一致）
function subDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d - n);
  const pad = x => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

module.exports = { batchTrack, eventsAnalysis, EVENT_TYPES };
