/**
 * 浏览埋点采集（DESIGN #D5）：攒批上报 POST /api/track/batch
 * 事件白名单：page_view / course_view / course_list_view / search（banner_click / waitlist_view 预留扩展）
 * 设计决策（2026-08-18 确认）：
 *  - 前端攒批（满 20 条或 5s 定时兜底）→ 批量上报；失败静默丢弃（埋点不阻塞业务、不拖性能）
 *  - 未登录（无 openid）不采集；服务端同样按 openid 落库
 *  - page_view：首页 onShow 时发（切后台回来算一次浏览）
 *  - course_view：详情页 onHide/onUnload 时发，带停留时长 duration_ms（onShow 记开始时间）
 *  - search：搜索输入防抖 1s（连续输入不刷屏），与上一次相同关键词不重发
 */
const api = require('./api.js');

const EVENT_TYPES = ['page_view', 'course_view', 'course_list_view', 'search', 'waitlist_view', 'banner_click'];
const BATCH_MAX = 20;
const FLUSH_MS = 5000;
const SEARCH_DEBOUNCE_MS = 1000;

let queue = [];
let timer = null;
let flushing = false;
let searchTimer = null;
let lastSearch = '';

// 会话标识：小程序启动一次一个会话（Date.now 近似即可，仅用于浏览序列分析）
let sessionId = '';
function getSessionId() {
  if (!sessionId) sessionId = String(Date.now());
  return sessionId;
}

function currentOpenid() {
  const app = getApp();
  const u = app && app.globalData && app.globalData.userInfo;
  return (u && u.openid) || wx.getStorageSync('openid') || '';
}

function track(event_type, data = {}) {
  if (!EVENT_TYPES.includes(event_type)) return;
  const openid = currentOpenid();
  if (!openid) return; // 未登录不采集
  queue.push({
    event_type,
    target_id: Number(data.target_id) || 0,
    keyword: String(data.keyword || '').slice(0, 64),
    source: String(data.source || '').slice(0, 32),
    page: String(data.page || '').slice(0, 64),
    session_id: data.session_id || getSessionId(),
    duration_ms: Number(data.duration_ms) || 0
  });
  if (queue.length >= BATCH_MAX) flush();
  else schedule();
}

// 页面浏览（首页 onShow）
function pageView(page) { track('page_view', { page }); }

// 课程详情浏览（详情页 onHide/onUnload 时调用，带停留毫秒）
function courseView(targetId, durationMs, source) {
  track('course_view', { target_id: targetId, duration_ms: durationMs, source });
}

// 搜索关键词（防抖 1s；空词/同词不重发）
function search(keyword) {
  const kw = (keyword || '').trim();
  if (!kw) return;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    if (kw === lastSearch) return;
    lastSearch = kw;
    track('search', { keyword: kw });
  }, SEARCH_DEBOUNCE_MS);
}

function schedule() {
  if (timer || flushing) return;
  timer = setTimeout(flush, FLUSH_MS);
}

async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (flushing || queue.length === 0) return;
  flushing = true;
  const events = queue.splice(0, BATCH_MAX);
  try {
    await api.trackBatch({ openid: currentOpenid(), events });
  } catch (e) {
    /* 埋点失败静默丢弃（不重试，避免失败风暴） */
  }
  flushing = false;
  if (queue.length > 0) schedule();
}

// 页面隐藏/退出时强制上报（防最后一批滞留）
function flushNow() { if (queue.length > 0) flush(); }

module.exports = { track, pageView, courseView, search, flushNow };
