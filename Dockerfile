# 综合训练馆订课系统 - 后端镜像（微信云托管）
# 零第三方依赖：node:sqlite 内置，无需 npm install
FROM node:22-alpine

WORKDIR /app

# 复制后端代码
COPY server/ ./server/

# 创建前端目录（server/index.js 启动时会尝试写 net-config.json，
# 容器里没有 miniprogram 目录，需要先建好避免 ENOENT 异常）
RUN mkdir -p /app/miniprogram/utils

WORKDIR /app/server

# 云托管端口（控制台配置为 3000）
EXPOSE 3000

# 启动：先跑 seed 初始化基础数据（幂等：课程/场次/配置），再启动后端
# 数据库文件不入 git（.gitignore 排除 server/data/*.db），容器首次启动时
# 由 seed.js 自动建库并填充种子数据；用户数据（bookings/orders等）为空
# 如需带真实数据，用数据迁移方案（见上云迁移指南.md A2 阶段）
CMD ["sh", "-c", "node seed.js && node index.js"]
