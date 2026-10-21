# syntax=docker/dockerfile:1

# ---------- Stage 1: сборка фронтенда ----------
FROM node:20-alpine AS web-build
WORKDIR /app
ENV CI=true

COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root || npm install

COPY web ./web
RUN npm -w web run build

# ---------- Stage 2: сборка бэкенда ----------
FROM node:20-alpine AS api-build
WORKDIR /app
ENV CI=true

COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root || npm install

COPY backend ./backend
RUN npm -w backend run build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# postgresql16-client — pg_dump для бэкапа базы в S3. Версия 16 совпадает
# с сервером (postgres:16-alpine), поэтому дамп восстанавливается без
# лишних предупреждений.
RUN apk add --no-cache tini postgresql16-client && addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --omit=dev --workspaces --include-workspace-root || npm install --omit=dev --workspaces --include-workspace-root
RUN npm cache clean --force

COPY --from=api-build /app/backend/dist ./backend/dist
COPY --from=web-build /app/web/dist ./web/dist

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/dist/server.js"]
