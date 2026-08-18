/**
 * 微信支付（v3 JSAPI）配置单源（B2 支付预研，2026-08-18）
 *
 * 未启用（isWxpayEnabled()=false）：
 *   - GET /api/wxpay/status → { enabled:false }，前端禁用微信支付选项
 *   - POST /api/wxpay/create  /  /api/wxpay/notify → 400 明确报错
 *   - payOrder('wxpay') 无回调凭证一律拒绝（钱闭环闸门，见 db/orders.js）
 * 生产绝不伪造支付成功——发布前必须关的洞（历史：前端调 payOrder 即标 paid）。
 *
 * 两种启用方式（互斥，任一即 enabled）：
 *   ① 商户号（公司号阶段，业务代码零改动）：
 *     WXPAY_MCH_ID          商户号（微信支付商户平台）
 *     WXPAY_SERIAL_NO       商户证书序列号
 *     WXPAY_API_V3_KEY       APIv3 密钥（32 位，回调解密）
 *     WXPAY_PRIVATE_KEY_B64 商户私钥 PEM 的 base64（用于请求签名）
 *     WXPAY_NOTIFY_URL      支付回调公网地址（默认 TCB_BASE_URL + /api/wxpay/notify）
 *   ② 测试支付模式（PAY_MOCK=1，2026-08-18 用户要求「测试支付必定成功」）：
 *     仅本地/测试环境配置（server/.env，gitignore 不入库；生产云托管不配即关闭）。
 *     行为：status.enabled=true + mock=true；create 返回 mock 标记不调微信；
 *     POST /api/wxpay/mock-notify 把 pending 订单落 paid（与真实回调同一
 *     payOrder(wxpayVerified=true) 钱闭环路径，logOp 留痕）。生产不配置则
 *     mock-notify 直接 400——不存在可绕过的测试后门。
 */
function isWxpayMock() {
  return process.env.PAY_MOCK === '1';
}

function isWxpayEnabled() {
  return isWxpayMock() || !!(process.env.WXPAY_MCH_ID && process.env.WXPAY_SERIAL_NO
    && process.env.WXPAY_API_V3_KEY && process.env.WXPAY_PRIVATE_KEY_B64);
}

/** 回调公网地址：环境变量优先，回退拼 TCB_BASE_URL（仅作占位，启用时必配） */
function getNotifyUrl() {
  if (process.env.WXPAY_NOTIFY_URL) return process.env.WXPAY_NOTIFY_URL;
  return (process.env.TCB_BASE_URL || 'https://example.com') + '/api/wxpay/notify';
}

module.exports = { isWxpayEnabled, isWxpayMock, getNotifyUrl };
