/**
 * 场次列表秒开缓存（性能优化 2026-08-14）
 * 用途：预约页/活动页进页时先渲染本地缓存（秒开），再后台拉新数据刷新替换
 * 策略：按日期存原始 sessions，TTL 10 分钟；过期后进页走 loading+骨架屏（无缓存路径）
 * 注意：缓存的是后端原始场次数据，渲染时页面仍会重新 decorate（状态/席位实时计算）
 */
const PREFIX = 'sess_cache_';
const TTL = 10 * 60 * 1000; // 10 分钟

function get(date) {
  try {
    const raw = wx.getStorageSync(PREFIX + date);
    if (!raw || !raw.list || !raw.ts) return null;
    if (Date.now() - raw.ts > TTL) return null; // 过期视为无缓存
    return raw.list;
  } catch (e) {
    return null;
  }
}

function set(date, list) {
  try {
    wx.setStorageSync(PREFIX + date, { list, ts: Date.now() });
  } catch (e) {
    /* 存储满等异常，忽略（不影响功能） */
  }
}

module.exports = { get, set };
