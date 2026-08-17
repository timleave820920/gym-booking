/**
 * 教练分成配置（唯一数据源，存于 coach_config 表，DESIGN #D1 任务2）
 * ============================================================
 * 表里只有一行（id=1），数值可改库调整；表不存在/为空时回退默认值。
 * 后端各结算模块统一通过 getCoachConfig() 读取，禁止各模块自设常量。
 * ============================================================
 */
const { driver } = require('./db-core');

// 兜底默认值（与建表 DEFAULT 一致）
const DEFAULTS = {
  course_fee_fen: 10000,      // 课时单价（分，¥100）
  checkin_reward_fen: 500     // 签到奖励单价（分，¥5）
};

/**
 * 读取分成配置（DESIGN #D2：同步 db.prepare → 驱动抽象层 driver.get，MySQL 生产路径生效）
 * @returns {Promise<{course_fee_fen:number, checkin_reward_fen:number}>}
 */
async function getCoachConfig() {
  const row = await driver.get('SELECT course_fee_fen, checkin_reward_fen FROM coach_config WHERE id = 1');
  return row || { ...DEFAULTS };
}

module.exports = { getCoachConfig };
