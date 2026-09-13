# Velox —— 多上游测速平台（CLI + Web 控制台）
# 多阶段构建：编译后端 + 构建前端 → 单独安装生产依赖（不含 playwright/vitest 等开发依赖）→ 精简非 root 运行时。

# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app

# pnpm 版本由 package.json 的 packageManager 字段锁定
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

# 先拷贝依赖清单，利用 Docker 层缓存加速
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY web/package.json web/package.json

# 安装依赖（esbuild 等可能需要构建工具）
RUN apk add --no-cache python3 make g++ \
  && pnpm install --frozen-lockfile

# 拷贝源码
COPY src ./src
COPY web ./web
COPY assets ./assets
COPY scripts ./scripts

# 编译后端 + 构建前端
RUN pnpm build && pnpm web:build

# ---------- 生产依赖阶段（只装 runtime 依赖，镜像不含 devDependencies） ----------
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---------- 运行时阶段 ----------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8818
ENV HOST=0.0.0.0

RUN addgroup -S velox && adduser -S velox -G velox

# 只拷贝构建产物与运行所需资源
COPY --from=build --chown=velox:velox /app/dist ./dist
COPY --from=build --chown=velox:velox /app/web/dist ./web/dist
COPY --from=build --chown=velox:velox /app/assets ./assets
COPY --from=build --chown=velox:velox /app/package.json ./package.json
COPY --from=prod-deps --chown=velox:velox /app/node_modules ./node_modules

# 数据缓存挂载点（节点表 / 历史 / 上游缓存），非 root 用户可写
RUN mkdir -p /home/velox/.cache/itdog-cli && chown -R velox:velox /home/velox/.cache
USER velox

EXPOSE 8818

# 健康检查：探 /api/health
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8818}/api/health" || exit 1

# 端口/地址读环境变量（与 HEALTHCHECK 一致）；容器内默认对外监听
CMD ["sh", "-c", "node dist/cli.js serve --port ${PORT:-8818} --host ${HOST:-0.0.0.0}"]
