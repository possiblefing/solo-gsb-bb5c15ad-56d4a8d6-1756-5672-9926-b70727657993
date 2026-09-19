FROM node:20-alpine

WORKDIR /app

# 仅拷贝依赖清单，利用构建缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# 拷贝应用代码
COPY server ./server
COPY public ./public

# 数据持久化目录（首次启动自动创建 stories.json 并写入示例剧情）
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

# 容器启动即完成：依赖安装（镜像构建期）+ 示例数据初始化（首次运行 ensureStorage）
CMD ["node", "server/index.js"]
