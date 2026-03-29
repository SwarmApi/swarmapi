FROM node:20-alpine

LABEL maintainer="SwarmApi"
LABEL description="Swarm API Proxy with OpenCode"

# 安装系统工具
RUN apk add --no-cache \
    git \
    curl \
    bash \
    jq

# 安装OpenCode
RUN npm install -g opencode

# 克隆最新swarmapi
WORKDIR /app
RUN git clone https://github.com/SwarmApi/swarmapi.git . || git -C . pull

# 创建非root用户
RUN addgroup -g 1000 appgroup && \
    adduser -u 1000 -G appgroup -s /bin/sh -D appuser

USER appuser

ENV PORT=44444
ENV GITHUB_REPO=SwarmApi/swarmapi
ENV NODE_ENV=production

EXPOSE 44444

# 每小时自动更新
CMD ["sh", "-c", "while true; do git -C /app pull; sleep 3600; done & node /app/proxy.js"]
