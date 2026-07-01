# Shopwave: actions, events, and traces

Shopwave is the e-commerce testbed. This documents what each action does, the exact structure
of every message it puts on RabbitMQ, and the trace each action produces. Message contracts
live in [`testbed/packages/shared/src/contracts.ts`](../testbed/packages/shared/src/contracts.ts)
so producers and consumers can't drift.

## HTTP API (through the gateway, `:3000`)

The gateway is the single entry point. Protected routes require `Authorization: Bearer <jwt>`;
the gateway validates it by calling `auth /verify`, then forwards the request with an
`x-user-id` header.

| Method + path | Auth | Downstream | What it does |
|---------------|------|-----------|--------------|
| `POST /api/signup` | no | auth | create user (scrypt hash), issue JWT + Redis session |
| `POST /api/login` | no | auth | verify password, issue JWT + Redis session |
| `GET /api/products` | no | catalog | list products (Postgres) |
| `GET /api/products/:id` | no | catalog | one product; Redis read-through cache (60s) |
| `GET /api/cart` | yes | cart → catalog | cart items priced via catalog |
| `POST /api/cart/items` | yes | cart → catalog | validate product, `HINCRBY` qty in Redis |
| `DELETE /api/cart/items/:id` | yes | cart | `HDEL` from the Redis cart |
| `POST /api/checkout` | yes | cart → order | build order from cart, create it, clear cart |
| `GET /api/orders` | yes | order | list the user's orders (Postgres) |
| `GET /api/orders/:id` | yes | order | one order with items + status |

State stores: **auth** users in Postgres, sessions in Redis (`session:<jti>` → userId, 1h).
**catalog** products in Postgres, cache `product:<id>` in Redis. **cart** as a Redis hash
`cart:<userId>` of `productId → qty`. **order** orders + order_items in Postgres.

## RabbitMQ topology

One durable topic exchange, `shopwave.orders`. Routing keys and payloads:

```ts
const ORDER_EXCHANGE = "shopwave.orders";
const RoutingKeys = {
  orderCreated:        "order.created",
  paymentCompleted:    "payment.completed",
  paymentFailed:       "payment.failed",
  inventoryReserved:   "inventory.reserved",
  inventoryOutOfStock: "inventory.out_of_stock",
};
```

Queues and their bindings (each consumer has its own durable queue, so `order.created` fans
out to both workers):

| Queue | Bound routing keys | Consumer |
|-------|--------------------|----------|
| `payment.order-created` | `order.created` | payment-worker |
| `inventory.order-created` | `order.created` | inventory-worker |
| `notification.events` | `payment.*`, `inventory.*` | notification-worker |
| `order.saga` | `payment.*`, `inventory.*` | order (the saga) |

Every message is published JSON, `persistent`, with `content-type: application/json`, and —
crucially — the OpenTelemetry **traceparent is injected into the message headers**, so a
consumer continues the same trace as the publisher.

## Message payloads (exact structure)

### `order.created` — published by **order** on checkout

```ts
interface OrderCreated {
  orderId: string;   // UUID
  userId: string;    // UUID
  items: Array<{ productId: string; quantity: number; priceCents: number }>;
  totalCents: number;
  currency: string;  // "USD"
}
```
Example:
```json
{
  "orderId": "70edf0df-c85c-4feb-9d04-a9aa44ffa596",
  "userId": "5a139121-40c4-467b-9869-3d631dd6a882",
  "items": [
    { "productId": "p-003", "quantity": 2, "priceCents": 12900 },
    { "productId": "p-007", "quantity": 1, "priceCents": 1900 }
  ],
  "totalCents": 27700,
  "currency": "USD"
}
```

### `payment.completed` / `payment.failed` — published by **payment-worker**

```ts
interface PaymentResult {
  orderId: string;
  status: "completed" | "failed";
  reason?: string;   // set on failure, e.g. "card_declined"
}
```
```json
{ "orderId": "70edf0df-…", "status": "failed", "reason": "card_declined" }
```
The worker declines a configurable fraction of payments (`PAYMENT_DECLINE_RATE`, default 0.15)
and writes a row to its `payments` table either way.

### `inventory.reserved` / `inventory.out_of_stock` — published by **inventory-worker**

```ts
interface InventoryResult {
  orderId: string;
  status: "reserved" | "out_of_stock";
  shortfall?: Array<{ productId: string; requested: number; available: number }>;
}
```
```json
{
  "orderId": "70edf0df-…",
  "status": "out_of_stock",
  "shortfall": [{ "productId": "p-005", "requested": 5, "available": 4 }]
}
```
The worker holds real stock in its `inventory` table (seeded; a couple of SKUs are low on
purpose). It decrements inside a transaction when everything is available, otherwise reports
the shortfall and reserves nothing.

## The checkout event flow (choreography saga)

No orchestrator — services react to events and the order service folds the results into
status.

```
POST /api/checkout
  gateway → cart → (catalog prices) → order.createOrder()  [status: pending]
                                          │
                                          └─ publish order.created ──► shopwave.orders
                                                                          │ fan-out
                          ┌───────────────────────────────────────────────┼───────────────┐
                     payment-worker                             inventory-worker     notification-worker
                     pay (85% ok)                               reserve / out-of-stock   (also listens below)
                          │ publish payment.completed|failed         │ publish inventory.reserved|out_of_stock
                          └───────────────► shopwave.orders ◄─────────┘
                                               │
                          ┌────────────────────┴────────────────────┐
                     order (saga)                             notification-worker
                     update order status                     dedupe (Redis) + "send" email
```

**Order status** is recomputed by the saga in one atomic SQL `UPDATE` per event (so a payment
and an inventory event can't race):

- `payment.failed` **or** `inventory.out_of_stock` → `cancelled`
- `payment.completed` **and** `inventory.reserved` → `confirmed`
- otherwise still `pending`

So `GET /api/orders/:id` transitions `pending → confirmed` (both succeeded) or
`pending → cancelled` (either failed). The **notification-worker** dedupes each
`(orderId, event)` with a Redis `SET NX` before logging the "email," so retries don't double-send.

## What each action looks like as a trace

- **Browse a product** (`GET /api/products/:id`): `gateway → catalog`, then in catalog a Redis
  `get` (cache) and, on a miss, a Postgres `SELECT` + Redis `set`. ~4–6 spans.
- **Add to cart** (`POST /api/cart/items`): `gateway → auth /verify (redis)` then
  `gateway → cart → catalog` (validate) + Redis `hincrby`.
- **Checkout** (`POST /api/checkout`): the big one — one connected trace of ~25–52 spans across
  gateway, auth, cart, catalog, order, Postgres, Redis, a RabbitMQ `publish`, then the
  consumer spans in payment-worker, inventory-worker, the order saga, and notification-worker,
  because trace context rides through the RabbitMQ headers.

In LiveProbe, a checkout is a single sequence diagram spanning all of that, and it contributes
edges like `gateway→cart`, `order→postgresql`, `order→rabbitmq`, `payment-worker→postgresql`
to the aggregate flow graph.

## Load generator

`packages/loadgen` runs concurrent virtual users doing the full journey (signup/login →
browse → add to cart → checkout → view orders) with think-time between steps. Because payment
declines and out-of-stock are built in, it naturally produces error traces and red edges. See
the top-level README for start/stop/tune.
