/**
 * 签到凭证码解析（DESIGN #D1：凭证码为纯数字，兼容历史 GYM- 前缀）
 * 教练端扫码/手动核销共用，与后端 getCheckinInfo 的 bookingId 对应
 */

/**
 * 解析签到码 → bookingId
 * @param {string} code 纯数字（如 0001）或历史 GYM-0001
 * @returns {number} bookingId，无法识别返回 0
 */
function parseCode(code) {
  const text = String(code || '').trim();
  const m = text.match(/^(\d{1,10})$/) || text.match(/GYM-(\d+)/i);
  return m ? Number(m[1]) : 0;
}

module.exports = { parseCode };
