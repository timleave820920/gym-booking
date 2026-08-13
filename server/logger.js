/**
 * 关键操作日志（可追溯性）：支付/充值/退款/兑换/签到 等涉及钱与状态的
 * 关键操作，写入 server/logs/ops.log，供问题回溯定位。
 * 格式：时间 | openid | 操作 | 详情(JSON) | 结果 | 单号
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'ops.log');

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 记录关键操作
 * @param {string} openid 用户标识
 * @param {string} action 操作名（pay/recharge/refund/exchange/checkin/...）
 * @param {object} detail 详情（订单号/金额/场次等）
 * @param {string} result ok | fail
 * @param {string} [refNo] 单号（订单号/充值单号）
 */
function logOp(openid, action, detail, result, refNo) {
  try {
    ensureDir();
    const ts = new Date().toISOString();
    const line = `${ts} | ${openid || '-'} | ${action} | ${JSON.stringify(detail || {})} | ${result} | ${refNo || '-'}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (e) {
    // 日志失败不影响主流程
    console.error('[logger]', e.message);
  }
}

module.exports = { logOp, LOG_FILE };
