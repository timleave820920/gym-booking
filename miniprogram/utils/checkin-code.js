/**
 * 签到凭证码工具（BUGS-INBOX #11：随机 5 位纯数字签到码）
 * 教练端扫码/手动核销共用。码 = 后端随机生成的 5 位纯数字（10000-99999），
 * 与 bookingId 无推导关系——核销走 /api/checkin/by-code 按码反查。
 * （历史 GYM-0001 / bookingId 补零格式已废弃）
 */

/**
 * 校验签到码格式（5 位纯数字）
 * @param {string} code
 * @returns {boolean}
 */
function isValidCode(code) {
  return /^\d{5}$/.test(String(code || '').trim());
}

/** 归一化：去空白后原样返回（不再解析为 bookingId） */
function normalizeCode(code) {
  return String(code || '').trim();
}

module.exports = { isValidCode, normalizeCode };
