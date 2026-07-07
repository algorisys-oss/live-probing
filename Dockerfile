# syntax=docker/dockerfile:1

FROM node:22-slim AS ui-build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
RUN npm ci

COPY packages/core packages/core
COPY packages/ui packages/ui
RUN npm run build -w @liveprobe/ui

FROM node:22-slim AS runtime
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/collector/package.json packages/collector/
RUN npm ci && npm install tsx

COPY packages/core packages/core
COPY packages/server packages/server
COPY packages/collector packages/collector
COPY --from=ui-build /app/packages/ui/dist packages/server/public

ENV PORT=4319
ENV DB_PATH=/data/liveprobe.db
ENV NODE_ENV=production

EXPOSE 4319

VOLUME /data

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4319)+'/api/topology').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "packages/server/src/index.ts"]
