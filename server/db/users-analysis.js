/**
 * 用户分析（DESIGN #D4-3，2026-08-18）
 *
 * RMF 分层（经典三因子）：
 *  - R 近度：最近一次订课/签到距今天数（无行为 = null）
 *  - F 频次：近 30 天订课次数
 *  - M 金额：累计实付（paid 订课/候补订单金额，退款不计）
 * 五档打分（1-5，阈值固定便于跨日稳定，前端可画 5×5×5 网格）：
 *  - R: <=3天=5  <=7=4  <=14=3  <=30=2  更久/无=1
 *  - F: >=10次=5  >=5=4  >=2=3  >=1=2  0=1
 *  - M: >=¥500=5  >=¥200=4  >=¥50=3  >=¥10=2  其余=1
 * 沉睡双档：R>=30 → '30'（重沉睡）；R>=14 → '14'（预警）；否则 '0'
 */
const time = require('../time.js');
const { driver } = require('../db-core');
const { sendMessage } = require('./messages');

const dayMs = 864e5;
const rLevel = (r) => (r === null ? 1 : r <= 3 ? 5 : r <= 7 ? 4 : r <= 14 ? 3 : r <= 30 ? 2 : 1);
const fLevel = (f) => (f >= 10 ? 5 : f >= 5 ? 4 : f >= 2 ? 3 : f >= 1 ? 2 : 1);
const mLevel = (m) => (m >= 50000 ? 5 : m >= 20000 ? 4 : m >= 5000 ? 3 : m >= 1000 ? 2 : 1);
const dormantOf = (r) => (r !== null && r >= 30 ? '30' : r !== null && r >= 14 ? '14' : '0');

/**
 * RMF 聚合查询（一次 SQL 扫全用户 + 3 相关子查询，无 N+1）
 * 返回原始行（不分页），筛选/排序/打分在内存做（用户量级 < 万，足够）
 */
async function baseRows() {
  const since30 = time.nowDateTimeStr(new Date(Date.now() - 30 * dayMs));
  return driver.all(`
    SELECT u.openid, u.nickname, u.avatar, u.phone, u.role, u.level_lv, u.balance_fen,
           u.created_at, u.last_login_at, u.login_count, u.total_classes, u.total_calories,
      (SELECT MAX(b.created_at) FROM bookings b WHERE b.user_openid = u.openid AND b.status = 'booked') AS last_book_at,
      (SELECT MAX(b.checkin_at) FROM bookings b WHERE b.user_openid = u.openid AND b.checkin_at IS NOT NULL) AS last_checkin_at,
      (SELECT COUNT(*) FROM bookings b WHERE b.user_openid = u.openid AND b.status = 'booked' AND b.created_at >= ?) AS f30,
      (SELECT COALESCE(SUM(o.amount_fen),0) FROM orders o WHERE o.user_openid = u.openid AND o.status = 'paid' AND o.order_type IN ('book','waitlist')) AS m_total
    FROM users u WHERE u.role != 'admin'`, [since30]);
}

/** 行 → 展示对象（打分/沉睡/近度） */
function decorate(row) {
  const lastAct = row.last_checkin_at && (!row.last_book_at || row.last_checkin_at > row.last_book_at)
    ? row.last_checkin_at : row.last_book_at;
  const r = lastAct ? Math.max(0, Math.floor((Date.now() - time.parseBeijing(lastAct).getTime()) / dayMs)) : null;
  const f = Number(row.f30 || 0);
  const m = Number(row.m_total || 0);
  return {
    openid: row.openid,
    nickname: row.nickname || '',
    avatar: row.avatar || '',
    phone: row.phone || '',
    role: row.role,
    level_lv: row.level_lv,
    balance_fen: row.balance_fen,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    login_count: row.login_count,
    total_classes: row.total_classes,
    total_calories: row.total_calories,
    last_active_at: lastAct,
    r, f, m,
    r_level: rLevel(r), f_level: fLevel(f), m_level: mLevel(m),
    dormant: dormantOf(r),
    last_book_at: row.last_book_at
  };
}

/**
 * 筛选 + 排序 + 分页
 * filters: { q, role, dormant, r_max, f_min, m_min, order, page, page_size }
 * order: monetary(默认)/recency/frequency/last_active
 */
async function queryUsersAnalysis(filters = {}) {
  const q = (filters.q || '').trim();
  const role = filters.role || 'student';
  const dormant = filters.dormant !== undefined && filters.dormant !== '' ? String(filters.dormant) : null;
  const rMax = filters.r_max !== undefined && filters.r_max !== '' ? Number(filters.r_max) : null;
  const fMin = filters.f_min !== undefined && filters.f_min !== '' ? Number(filters.f_min) : null;
  const mMin = filters.m_min !== undefined && filters.m_min !== '' ? Number(filters.m_min) : null;
  const order = filters.order || 'monetary';
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filters.page_size) || 20));

  let rows = (await baseRows()).map(decorate);
  // 角色：默认只看学员（运营对象）；coach/all 可选
  if (role === 'student') rows = rows.filter(u => u.role === 'student');
  else if (role === 'coach') rows = rows.filter(u => u.role === 'coach');
  // 搜索（昵称/手机号/openid 模糊）
  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter(u => u.nickname.toLowerCase().includes(ql) || u.phone.includes(q) || u.openid.toLowerCase().includes(ql));
  }
  // 沉睡档位
  if (dormant !== null && ['0', '14', '30'].includes(dormant)) {
    rows = rows.filter(u => u.dormant === dormant);
  }
  // 数值门槛
  if (rMax !== null) rows = rows.filter(u => u.r !== null && u.r <= rMax);
  if (fMin !== null) rows = rows.filter(u => u.f >= fMin);
  if (mMin !== null) rows = rows.filter(u => u.m >= mMin);

  const total = rows.length;
  // 排序
  const cmp = {
    monetary: (a, b) => b.m - a.m,
    recency: (a, b) => (a.r === null ? 1e9 : a.r) - (b.r === null ? 1e9 : b.r),
    frequency: (a, b) => b.f - a.f,
    last_active: (a, b) => String(b.last_login_at || '').localeCompare(String(a.last_login_at || ''))
  }[order];
  rows.sort(cmp);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const stats = {
    total_users: total,
    active_30d: rows.filter(u => u.r !== null && u.r <= 30).length,
    dormant_14: rows.filter(u => u.dormant === '14').length,
    dormant_30: rows.filter(u => u.dormant === '30').length,
    avg_m_fen: total ? Math.round(rows.reduce((a, u) => a + u.m, 0) / total) : 0,
    avg_f: total ? +(rows.reduce((a, u) => a + u.f, 0) / total).toFixed(1) : 0
  };
  return { total, page, page_size: pageSize, pages, stats, users: rows.slice(start, start + pageSize) };
}

/** 行为时间线（个体钻取）：订课/签到/退订/支付/退款/充值/余额/能量币/消息，倒序 50 条 */
async function getTimeline(openid) {
  const rows = await driver.all(`
    SELECT 'book' AS type, b.created_at AS t, b.status AS st, b.amount_fen, b.checkin_at FROM bookings b WHERE b.user_openid = ?
    UNION ALL SELECT 'order', o.created_at, o.status, o.amount_fen, o.paid_at FROM orders o WHERE o.user_openid = ?
    UNION ALL SELECT 'recharge', r.created_at, r.status, r.amount_fen, NULL FROM member_recharges r WHERE r.user_openid = ?
    UNION ALL SELECT 'balance', bl.created_at, bl.reason, bl.change_fen, NULL FROM balance_logs bl WHERE bl.user_openid = ?
    UNION ALL SELECT 'coin', cl.created_at, cl.reason, cl.change, NULL FROM coin_logs cl WHERE cl.user_openid = ?
    UNION ALL SELECT 'msg', m.created_at, m.title, m.is_read, NULL FROM messages m WHERE m.user_openid = ?
    ORDER BY t DESC LIMIT 50`, [openid, openid, openid, openid, openid, openid]);
  return rows.map(r => {
    const desc = {
      book: r.st === 'cancelled' ? '退订' : (r.checkin_at ? '签到' : '订课'),
      order: r.st === 'paid' ? '支付' : (r.st === 'refunded' ? '退款' : '订单' + r.st),
      recharge: '充值到账',
      balance: '余额' + (r.amount_fen > 0 ? '增加' : '扣减'),
      coin: '能量币' + (r.amount_fen > 0 ? '获得' : '消耗'),
      msg: '收到消息'
    }[r.type] || r.type;
    return {
      type: r.type,
      t: r.t,
      desc: desc + (r.type === 'msg' ? '：' + r.st : ''),
      amount_fen: r.type === 'coin' ? r.amount_fen * 100 : r.amount_fen
    };
  });
}

/** 群组触达（站内信，promo 类型；dedup 防重复推送，返回实际发送数） */
async function groupMessage(openids, title, content) {
  if (!Array.isArray(openids) || openids.length === 0 || openids.length > 200) {
    throw new Error('openids 需为 1-200 个用户');
  }
  if (!title || !String(title).trim()) throw new Error('消息标题必填');
  let sent = 0;
  for (const oid of openids) {
    const id = await sendMessage({
      user_openid: oid, type: 'promo', title: String(title).trim(),
      content: String(content || '').trim(),
      dedup_key: `campaign:${title.trim()}:${oid}`
    });
    if (id) sent++;
  }
  return { sent, skipped: openids.length - sent };
}

module.exports = { queryUsersAnalysis, getTimeline, groupMessage };
