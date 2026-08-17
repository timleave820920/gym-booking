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

# 前端静态资源（index.js 服务 /images/ 从 miniprogram/images 读取——教练头像/课程封面。
# 曾因 .dockerignore 排除整个 miniprogram/ 致容器内图片 404，注意保留此目录）
COPY miniprogram/images/ ./miniprogram/images/

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

# 启动：直接 node index.js。listen 先行（探针窗口内即监听 3000），建表就绪后进程内
# 幂等跑种子（server/seed.js run()）。旧架构 `seed.js && index.js` 曾因 seed 进程挂起
# 导致 index 永不启动、探针 refused、部署回滚（BUG-LEDGER #34），已废弃。
# 数据库文件不入 git（.gitignore 排除 server/data/*.db），容器首次启动时由种子自动
# 建库并填充基础数据；用户数据（bookings/orders等）为空，如需带真实数据见上云迁移指南 A2
CMD ["node", "index.js"]
