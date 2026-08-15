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

# 启动（PORT 由云托管环境变量注入，默认 3000）
CMD ["node", "index.js"]
