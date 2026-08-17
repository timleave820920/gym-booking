# 综合训练馆订课系统 - 后端镜像（微信云托管）
# 默认 SQLite（node:sqlite 内置）；DB_DRIVER=mysql 时用 mysql2（唯一第三方依赖，DESIGN #D2 S5）
FROM node:22-alpine

# 时区固定为北京时间（BUG-LEDGER #28）：alpine 默认 UTC，Node getHours() 判定
# 签到窗口/统计/过期任务全部差 8 小时（本地测试跑在 Windows 北京时间，发现不了）。
# 需装 tzdata（musl 无 zoneinfo）并设 TZ，SQLite datetime('now','localtime') 同步生效。
RUN apk add --no-cache tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone
ENV TZ=Asia/Shanghai

WORKDIR /app

# 安装 mysql2（DESIGN #D2 S5：MySQL 生产路径唯一第三方依赖；本地/CI 测试不安装，
# 代码内惰性 require 保持零依赖可跑）
COPY package.json ./
RUN npm install --omit=dev

# 复制后端代码
COPY server/ ./server/

# 管理后台网页（web/courses.html：课程设定/排表管理/邀请看板/营收统计，
# BUGS-INBOX #8：此前漏打包导致云托管访问 / 404）
COPY web/ ./web/

# 创建前端目录（server/index.js 启动时会尝试写 net-config.json，
# 容器里没有 miniprogram 目录，需要先建好避免 ENOENT 异常）
RUN mkdir -p /app/miniprogram/utils

# 数据持久化目录（2026-08-16，BUG-LEDGER #25）：
# 云托管容器文件系统不持久化——闲置/重建/缩容后 SQLite 数据全部丢失，
# 用户每次登录都会变"新的号"（注册成功而非欢迎回来）。
# 修复：云托管控制台将 CFS 文件存储挂载到 /data + 环境变量 DB_PATH=/data/gym.db，
# 用户数据即可跨容器重建保留（db-core.js 按 DB_PATH 自动建目录并打开该库）。
RUN mkdir -p /data

WORKDIR /app/server

# 云托管端口（控制台配置为 3000）
EXPOSE 3000

# 启动：先跑 seed 初始化基础数据（幂等：课程/场次/配置），再启动后端
# 数据库文件不入 git（.gitignore 排除 server/data/*.db），容器首次启动时
# 由 seed.js 自动建库并填充种子数据；用户数据（bookings/orders等）为空
# 如需带真实数据，用数据迁移方案（见上云迁移指南.md A2 阶段）
CMD ["sh", "-c", "node seed.js && node index.js"]
