/**
 * 教练分成配置（唯一数据源，存于 coach_config 表，DESIGN #D1 任务2）
 * ============================================================
 * 表里只有一行（id=1），数值可改库调整；表不存在/为空时回退默认值。
 * 后端各结算模块统一通过 getCoachConfig() 读取，禁止各模块自设常量。
 * ============================================================
 */
const { db } = require('./db-core');

// 兜底默认值（与建表 DEFAULT 一致）
const DEFAULTS = {
  course_fee_fen: 10000,      // 课时单价（分，¥100）
  checkin_reward_fen: 500     // 签到奖励单价（分，¥5）
};

/**
 * 读取分成配置
 * @returns {{course_fee_fen:number, checkin_reward_fen:number}}
 */
function getCoachConfig() {
  const row = db.prepare('SELECT course_fee_fen, checkin_reward_fen FROM coach_config WHERE id = 1').get();
  return row || { ...DEFAULTS };
}

module.exports = { getCoachConfig };
