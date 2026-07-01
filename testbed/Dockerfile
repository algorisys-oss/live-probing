FROM node:22-slim

WORKDIR /app

# Install dependencies against the full workspace so package symlinks resolve.
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/gateway/package.json packages/gateway/
COPY packages/catalog/package.json packages/catalog/
COPY packages/auth/package.json packages/auth/
COPY packages/cart/package.json packages/cart/
COPY packages/order/package.json packages/order/
COPY packages/payment-worker/package.json packages/payment-worker/
COPY packages/inventory-worker/package.json packages/inventory-worker/
COPY packages/notification-worker/package.json packages/notification-worker/
COPY packages/loadgen/package.json packages/loadgen/
RUN npm install

COPY . .

# Each service overrides `command` in docker-compose. OTel auto-instrumentation is
# loaded via NODE_OPTIONS (set per service in compose), before any app module.
CMD ["npx", "tsx", "packages/gateway/src/index.ts"]
