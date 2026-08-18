/**
 * 运营日报（DESIGN #D6，2026-08-18）
 *
 * 规则引擎（确定性、无 LLM）：读 #D4 dashboard 聚合 → 一句话总结 + 关键数据 + 趋势 + 行动建议。
 * 12 条规则表（设计文档「运营小助理设计方案.md」第三节，全量输出不截断——用户拍板）：
 *   1  新用户环比下滑 ≥20%           → 拉新：触达沉睡 + 邀请有礼        （用户/高）
 *   2  订课率 <60%                   → 排查冷门课程，调整排期/宣传位     （排课/中）
 *   3  热门课预约率 ≥90% 或候补转正率 ≥50% → 加场次/扩容                 （排课/低）
 *   4  冷门课空置率 >60% 连续 ≥3 天   → 调整时段/教练或下线               （排课/中）
 *   5  退订率 >20%                   → 检查退订原因（时间/价格冲突）     （排课/中）
 *   6  签到率 <70%                   → 课前 3 小时提醒未签到学员         （用户/中）
 *   7  14 天沉睡环比增加             → 定向触达沉睡 14 天档用户           （用户/中）
 *   8  未确认收入占比 >30%           → 收入未锁定预警，促确认             （收入/高）
 *   9  退款环比上升 ≥50%             → 退款异常预警，核查原因             （收入/高）
 *   10 新客首订转化 <30%             → 新客激活：首次订课激励             （用户/高）
 *   11 7 日留存 <15%                 → 留存预警，优化新手体验             （用户/高）
 *   12 全指标正常                    → 「一切正常，无行动项」             （—/低）
 *
 * 惰性生成：每日首访带 date 生成落库（同日幂等）+ regenerate 手动覆盖；
 * 无数据日（无场次且无新用户且无充值）返回占位不落库。
 * 趋势解读：7 天序列连续 ≥3 天同向 → ⚠️/📈/📉 标记。
 */
const time = require('../time.js');
const { driver } = require('../db-core');
const { getDashboard } = require('./dashboard');

const fen = (n) => Number(n || 0);
const pct = (a, b) => (b > 0 ? Number(a) / Number(b) * 100 : 0);
const fmtFen = (n) => '¥' + (fen(n) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 });

/** 环比百分比（分母 ≤0 无意义返回 null） */
function pctDelta(cur, prev) {
  if (!prev || Number(prev) <= 0) return null;
  return (Number(cur) - Number(prev)) / Number(prev) * 100;
}

/** 7 天序列连续同向检测（含最后一天；持平中断）→ { direction: up/down/flat, streak: 连续天数 } */
function streakOf(arr) {
  const n = arr.length;
  if (n < 2) return { direction: 'flat', streak: 0 };
  let streak = 1, dir = 0;
  for (let i = n - 1; i > 0; i--) {
    const d = Number(arr[i]) - Number(arr[i - 1]);
    if (d === 0) break;
    const s = d > 0 ? 1 : -1;
    if (dir === 0) dir = s;
    else if (s !== dir) break;
    streak++;
  }
  return { direction: dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat', streak: dir === 0 ? 0 : streak };
}

const SEV = { high: 'high', medium: 'medium', low: 'low' };
const flagOf = (delta) => (delta === null ? 'flat' : delta >= 1 ? 'up' : delta <= -1 ? 'down' : 'flat');

/** 一句话总结：优先展示下降最严重的核心指标，全正常则报上升最猛/最好指标 */
function buildSummary(today, prev) {
  const cur = today.core, pv = prev.core;
  const cands = [
    { label: '新用户', text: String(cur.new_users), delta: pctDelta(cur.new_users, pv.new_users), pp: false },
    { label: '订课率', text: cur.booking_rate + '%', delta: cur.booking_rate - pv.booking_rate, pp: true },
    { label: '签到率', text: cur.checkin_rate + '%', delta: cur.checkin_rate - pv.checkin_rate, pp: true },
    { label: '确认收入', text: fmtFen(cur.confirmed_revenue_fen), delta: pctDelta(cur.confirmed_revenue_fen, pv.confirmed_revenue_fen), pp: false }
  ];
  const part = (c) => {
    const up = c.delta > 0;
    return `${c.label} ${c.text}（较昨日 ${up ? '▲' : '▼'}${Math.abs(c.delta).toFixed(0)}${c.pp ? 'pp' : '%'}）`;
  };
  const falling = cands.filter(c => c.delta !== null && c.delta <= -1).sort((a, b) => a.delta - b.delta);
  let head;
  if (falling.length) head = part(falling[0]);
  else {
    const best = cands.filter(c => c.delta !== null && c.delta >= 1).sort((a, b) => b.delta - a.delta)[0];
    head = best ? part(best) : `${cands[0].label} ${cands[0].text}（较昨日持平）`;
  }
  return `${head}｜订课率 ${cur.booking_rate}%｜新用户 ${cur.new_users}`;
}

/** 关键数据网格：7 指标 + 环比 + 连续标记（flag/consecutive 供前端画 ▲▼/⚠️） */
function buildMetrics(today, prev) {
  const cur = today.core, pv = prev.core;
  const t7 = today.trend.d7;
  const mk = (key, label, value, delta, series7) => ({
    key, label, value,
    delta_pct: delta === null ? null : +delta.toFixed(1),
    flag: flagOf(delta),
    consecutive: series7 ? (streakOf(series7).streak >= 3 ? streakOf(series7).direction : 'flat') : 'flat'
  });
  return [
    mk('new_users', '新用户', cur.new_users, pctDelta(cur.new_users, pv.new_users), t7.newUsers),
    mk('booking_rate', '订课率', cur.booking_rate + '%', cur.booking_rate - pv.booking_rate, t7.bookingRate),
    mk('checkin_rate', '签到率', cur.checkin_rate + '%', cur.checkin_rate - pv.checkin_rate, t7.checkinRate),
    mk('confirmed_revenue_fen', '确认收入', fmtFen(cur.confirmed_revenue_fen), pctDelta(cur.confirmed_revenue_fen, pv.confirmed_revenue_fen), t7.revenueFen),
    mk('unconfirmed_revenue_fen', '未确认收入', fmtFen(cur.unconfirmed_revenue_fen), null, null),
    mk('refund_fen', '退款', fmtFen(cur.refund_fen), pctDelta(cur.refund_fen, pv.refund_fen), null),
    mk('recharge_fen', '当日充值', fmtFen(cur.recharge.fen), pctDelta(cur.recharge.fen, pv.recharge.fen), null),
    mk('retention_d7', '7日留存', cur.retention.d7 === null ? null : cur.retention.d7 + '%', null, null)
  ];
}

/** 趋势解读：4 项核心指标 7 天序列 + 连续 ≥3 天方向标记 */
function buildTrends(today) {
  const t7 = today.trend.d7;
  const mkT = (key, label, arr) => {
    const s = streakOf(arr);
    return { key, label, series: arr, direction: s.streak >= 3 ? s.direction : 'flat', streak: s.streak >= 3 ? s.streak : 0 };
  };
  return [
    mkT('booking_rate', '订课率', t7.bookingRate),
    mkT('new_users', '新用户', t7.newUsers),
    mkT('revenue_fen', '收入', t7.revenueFen),
    mkT('checkin_rate', '签到率', t7.checkinRate)
  ];
}

/**
 * 行动建议规则引擎（12 条规则表，全量输出）
 * 规则 4 需 7 天窗口（连续空置判定）：当日存在空置 >60% 的冷门课时，回溯 6 天
 * 各读一次 dashboard 冷门榜（惰性生成一天一次，成本可接受；冷门课通常稳定在榜）
 */
async function buildActions(day, today, prev) {
  const actions = [];
  const cur = today.core, pv = prev.core;
  const curG = today.groups, pvG = prev.groups;
  const hasSessions = (curG.courses.top || []).length > 0;

  // 规则 1：新用户环比下滑 ≥20%
  const dNew = pctDelta(cur.new_users, pv.new_users);
  if (dNew !== null && dNew <= -20) {
    actions.push({ severity: SEV.high, scope: '用户', title: `新用户较昨日下降 ${Math.abs(dNew).toFixed(0)}%`,
      suggestion: '建议触达沉睡用户 + 发起邀请有礼活动', data: `新用户 ${cur.new_users}（昨日 ${pv.new_users}，▼${Math.abs(dNew).toFixed(0)}%）` });
  }

  // 规则 2：订课率 <60%（有场次才评——无场次日由占位逻辑兜底）
  if (hasSessions && cur.booking_rate < 60) {
    actions.push({ severity: SEV.medium, scope: '排课', title: `订课率 ${cur.booking_rate}% 低于 60%`,
      suggestion: '排查冷门课程，调整排期或加大宣传位', data: `订课率 ${cur.booking_rate}%（昨日 ${pv.booking_rate}%）` });
  }

  // 规则 3：热门课预约率 ≥90% 或候补转正率 ≥50% → 加场次/扩容
  const hot = (curG.courses.top || []).find(r => Number(r.rate) >= 90);
  const promote = curG.revenue.waitlist_promote_rate || 0;
  if (hot || promote >= 50) {
    actions.push({ severity: SEV.low, scope: '排课',
      title: hot ? `「${hot.name}」预约率 ${hot.rate}% 接近满员` : `候补转正率 ${promote.toFixed(0)}% 较高`,
      suggestion: '建议该课程加场次或扩容', data: hot ? `${hot.booked_count}/${hot.capacity} 席` : `候补转正率 ${promote.toFixed(0)}%` });
  }

  // 规则 4：冷门课空置率 >60% 且连续 ≥3 天（7 天窗口）
  // 同日多场次同名课 → 按课名去重（取第一场，空置率最差场次排在冷门榜前），只报一次
  const seenCold = new Set();
  const coldToday = [];
  for (const r of (curG.courses.cold || [])) {
    if (Number(r.rate) >= 40 || seenCold.has(r.name)) continue;
    seenCold.add(r.name);
    coldToday.push(r);
  }
  if (coldToday.length) {
    const coldMap = {};   // 课名 → 前 6 天命中日期数组（同日去重）
    for (let i = 6; i >= 1; i--) {
      const d = time.addDaysStr(day, -i);
      const dash = await getDashboard(d);
      for (const r of (dash.groups.courses.cold || [])) {
        if (Number(r.rate) >= 40) continue;
        (coldMap[r.name] = coldMap[r.name] || []);
        if (!coldMap[r.name].includes(d)) coldMap[r.name].push(d);
      }
    }
    for (const r of coldToday) {
      let cnt = 1;   // 今天算第一天
      for (let i = 1; i <= 6; i++) {
        if ((coldMap[r.name] || []).includes(time.addDaysStr(day, -i))) cnt++;
        else break;
      }
      if (cnt >= 3) {
        actions.push({ severity: SEV.medium, scope: '排课', title: `「${r.name}」连续 ${cnt} 天空置率 >60%`,
          suggestion: '建议调整时段或换教练（或考虑下线）', data: `空置率 ${(100 - Number(r.rate)).toFixed(0)}% · 连续 ${cnt} 天` });
      }
    }
  }

  // 规则 5：退订率 >20%
  if (curG.revenue.cancel_rate > 20) {
    actions.push({ severity: SEV.medium, scope: '排课', title: `退订率 ${curG.revenue.cancel_rate}% 高于 20%`,
      suggestion: '检查退订原因（时间/价格冲突），优化排期', data: `退订率 ${curG.revenue.cancel_rate}%（昨日 ${pvG.revenue.cancel_rate}%）` });
  }

  // 规则 6：签到率 <70%（有预约才评）
  if (hasSessions && cur.booking_rate > 0 && cur.checkin_rate < 70) {
    actions.push({ severity: SEV.medium, scope: '用户', title: `签到率 ${cur.checkin_rate}% 低于 70%`,
      suggestion: '课前 3 小时推送提醒未签到学员', data: `签到率 ${cur.checkin_rate}%（昨日 ${pv.checkin_rate}%）` });
  }

  // 规则 7：14 天沉睡环比增加
  if (curG.growth.dormant.d14 > pvG.growth.dormant.d14) {
    actions.push({ severity: SEV.medium, scope: '用户', title: `14 天沉睡用户增加（${curG.growth.dormant.d14} 人）`,
      suggestion: '定向触达沉睡 14 天档用户', data: `沉睡 14 天 ${curG.growth.dormant.d14} 人（昨日 ${pvG.growth.dormant.d14} 人）` });
  }

  // 规则 8：未确认收入占比 >30%
  const conf = fen(cur.confirmed_revenue_fen), unconf = fen(cur.unconfirmed_revenue_fen);
  const unconfRatio = pct(unconf, conf + unconf);
  if (conf + unconf > 0 && unconfRatio > 30) {
    actions.push({ severity: SEV.high, scope: '收入', title: `未确认收入占 ${unconfRatio.toFixed(0)}%`,
      suggestion: '多为可退订订单，推送「确认权益」提醒促锁定', data: `未确认 ${fmtFen(unconf)} / 合计 ${fmtFen(conf + unconf)}` });
  }

  // 规则 9：退款环比上升 ≥50%
  const dRefund = pctDelta(cur.refund_fen, pv.refund_fen);
  if (fen(cur.refund_fen) > 0 && dRefund !== null && dRefund >= 50) {
    actions.push({ severity: SEV.high, scope: '收入', title: `退款较昨日上升 ${dRefund.toFixed(0)}%`,
      suggestion: '退款异常预警，核查退款原因', data: `退款 ${fmtFen(cur.refund_fen)}（昨日 ${fmtFen(pv.refund_fen)}）` });
  }

  // 规则 10：新客首订转化 <30%
  const reg = curG.growth.funnel.registered, fb = curG.growth.funnel.first_booked;
  const conv = pct(fb, reg);
  if (reg > 0 && conv < 30) {
    actions.push({ severity: SEV.high, scope: '用户', title: `新客首订转化仅 ${conv.toFixed(0)}%`,
      suggestion: '新客激活：推送首次订课激励', data: `新注册 ${reg} 人 · 首订 ${fb} 人` });
  }

  // 规则 11：7 日留存 <15%
  if (cur.retention.d7 !== null && cur.retention.d7 < 15) {
    actions.push({ severity: SEV.high, scope: '用户', title: `7 日留存 ${cur.retention.d7}% 低于 15%`,
      suggestion: '留存预警，优化新手体验', data: `7 日留存 ${cur.retention.d7}%` });
  }

  // 规则 12：全指标正常
  if (actions.length === 0) {
    actions.push({ severity: SEV.low, scope: '—', title: '今日一切正常，无行动项',
      suggestion: '保持节奏，按计划推进下周排课', data: '核心指标均处于健康区间' });
  }

  const sevOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  return actions;
}

/** 落库（双方言等价：先 UPDATE 影响 0 行再 INSERT，与 coach.js upsert 同套路） */
async function saveReport(day, summary, metrics, trends, actions) {
  const now = time.nowDateTimeStr();
  const upd = await driver.run(
    'UPDATE daily_reports SET summary=?, metrics=?, trends=?, actions=?, generated_at=? WHERE `date`=?',
    [summary, JSON.stringify(metrics), JSON.stringify(trends), JSON.stringify(actions), now, day]);
  if (upd.changes === 0) {
    await driver.run(
      'INSERT INTO daily_reports (date, summary, metrics, trends, actions, generated_at) VALUES (?,?,?,?,?,?)',
      [day, summary, JSON.stringify(metrics), JSON.stringify(trends), JSON.stringify(actions), now]);
  }
}

function parseReport(row) {
  const j = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  return { code: 200, date: row.date, empty: false, summary: row.summary || '',
    metrics: j(row.metrics), trends: j(row.trends), actions: j(row.actions), generated_at: row.generated_at };
}

/**
 * 生成报告（核心）：读 dashboard → 组装 → 落库
 * 无数据日（无场次且无新用户且无充值）返回占位不落库
 */
async function generateReport(dateStr) {
  const day = dateStr || time.todayStr();
  const today = await getDashboard(day);
  const noSessions = (today.groups.courses.top || []).length === 0;
  if (noSessions && today.core.new_users === 0 && today.core.recharge.count === 0) {
    return { code: 200, date: day, empty: true, summary: '当日无运营数据', metrics: [], trends: [], actions: [] };
  }
  const prev = await getDashboard(time.prevDateStr(day));
  const summary = buildSummary(today, prev);
  const metrics = buildMetrics(today, prev);
  const trends = buildTrends(today);
  const actions = await buildActions(day, today, prev);
  await saveReport(day, summary, metrics, trends, actions);
  return { code: 200, date: day, empty: false, summary, metrics, trends, actions, generated_at: time.nowDateTimeStr() };
}

/** 惰性获取：有缓存直接返回（同日幂等），无则生成落库 */
async function getDailyReport(dateStr) {
  const day = dateStr || time.todayStr();
  // 反引号包 date（MySQL 保留字裸用报错；反引号双方言兼容，mysql-schema.js 注释确认）
  const row = await driver.get('SELECT * FROM daily_reports WHERE `date` = ?', [day]);
  if (row) return parseReport(row);
  return generateReport(day);
}

/** 手动重新生成（覆盖当天缓存；占位日无缓存可删） */
async function regenerateReport(dateStr) {
  const day = dateStr || time.todayStr();
  await driver.run('DELETE FROM daily_reports WHERE `date` = ?', [day]);
  return generateReport(day);
}

/** 最近 N 天报告列表（无 date 参数时用；只读已落库，不触发生成） */
async function listReports(limit = 7) {
  // LIMIT 文本拼接：mysql2 execute 把 number 编码成 DOUBLE 绑定，MySQL LIMIT 需整数 → ER_WRONG_ARGUMENTS（BUG-LEDGER #60）
  return driver.all(`SELECT date, summary, generated_at FROM daily_reports ORDER BY date DESC LIMIT ${Number(limit) || 7}`);
}

module.exports = { getDailyReport, regenerateReport, listReports, generateReport, streakOf, pctDelta };
