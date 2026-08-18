/**
 * 图片存储方言（COS 迁移，2026-08-18 用户拍板方案 A）
 *
 * 背景：云托管容器文件系统不持久化（BUG-LEDGER #25 教训）——上传/头像转存写容器盘
 * /images/，容器重建/缩容即丢图（裂图）。且多实例下 A 实例传的图 B 实例读不到。
 *
 * 模式：
 *  - 本地/CI（无 COS_* 环境变量）：写磁盘（server/uploads 或 miniprogram/images），
 *    返回相对路径——零依赖、测试全绿，行为与迁移前完全一致
 *  - 生产（配置 COS_BUCKET + COS_REGION + COS_SECRET_ID/KEY）：写 COS，接口返回完整
 *    COS URL（前端 toFullUrl 对完整 URL 原样返回，前端零改动）
 *
 * 依赖：cos-nodejs-sdk-v5 惰性 require（仅生产镜像 npm install 安装，本地零依赖不执行到）
 */
const fs = require('fs');
const path = require('path');

const IS_COS = !!(process.env.COS_BUCKET && process.env.COS_REGION);
let cosClient = null;

function getCos() {
  if (!IS_COS) return null;
  if (!cosClient) {
    const COS = require('cos-nodejs-sdk-v5'); // 惰性 require
    cosClient = new COS({
      SecretId: process.env.COS_SECRET_ID,
      SecretKey: process.env.COS_SECRET_KEY,
    });
  }
  return cosClient;
}

/** COS 模式是否启用 */
function isCos() {
  return IS_COS;
}

/**
 * 保存图片（字节缓冲）：COS 模式 → 对象存储 images/ 目录；否则写本地磁盘
 * @param {string} relPath 相对路径（如 images/xxx.jpg 或 uploads/xxx.jpg）
 * @param {Buffer} buf 图片字节
 */
async function saveImage(relPath, buf) {
  const clean = relPath.replace(/^\/+/, '');
  if (IS_COS) {
    const client = getCos();
    await new Promise((resolve, reject) => {
      client.putObject({
        Bucket: process.env.COS_BUCKET,
        Key: clean,
        Body: buf,
        ContentType: 'image/' + (path.extname(clean).slice(1) === 'jpg' ? 'jpeg' : path.extname(clean).slice(1))
      }, (err, data) => (err ? reject(err) : resolve(data)));
    });
    return null; // 已存 COS，无需写盘
  }
  const imgDir = clean.startsWith('uploads/')
    ? path.join(__dirname, 'uploads')
    : path.join(__dirname, '..', 'miniprogram', 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, clean.replace(/^uploads\//, '').replace(/^images\//, '')), buf);
  return null;
}

/**
 * 路径 → 可展示 URL：完整 URL 原样；COS 模式拼 COS 域名；本地原样返回（toFullUrl 处理）
 * @param {string} p 存储路径（/images/x.jpg 或 /uploads/x.jpg 或完整 URL）
 */
function toImageUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//.test(p)) return p;
  if (IS_COS) return `https://${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com${p.startsWith('/') ? p : '/' + p}`;
  return p;
}

/** 批量转换（轮播图数组等） */
function toImageUrls(list) {
  return (list || []).map(toImageUrl);
}

module.exports = { isCos, saveImage, toImageUrl, toImageUrls };
