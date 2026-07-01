# LiveProbe

Live sequence and flow diagrams of running systems, drawn from observed runtime behavior
rather than parsed source. Point it at a system, watch requests flow through it as a live
sequence diagram (per trace) and a live topology diagram (aggregate), export either to
Mermaid or D2.

This repo has two parts:

- **LiveProbe** — the tool itself. Not built yet. See [plan.md](plan.md) and
  [CLAUDE.md](CLAUDE.md).
- **Shopwave testbed** — a real full-stack e-commerce system with Postgres, Redis,
  RabbitMQ, and OpenTelemetry, used as an honest trace source to develop LiveProbe
  against. See [plan-testbed.md](plan-testbed.md). Lives in [testbed/](testbed/).

## Status

| Part | State |
|------|-------|
| LiveProbe core | planned, not started |
| Testbed T0 (infra + gateway/catalog end to end in Jaeger) | **done, verified** |
| Testbed T1 (auth, cart, order; checkout publishes order.created) | **done, verified** |
| Testbed T2 (payment/inventory/notification workers + choreography saga) | **done, verified** |
| Testbed T3 (storefront SPA) | **done, verified** |
| Testbed T4 (load generator) | **done, verified** |
| Testbed T5 (point the OTel collector at LiveProbe) | blocked on LiveProbe core |

The full system is 8 services (gateway, auth, catalog, cart, order + payment/inventory/
notification workers) over Postgres, Redis, and RabbitMQ, all OpenTelemetry-instrumented.
A checkout is one connected trace across all of them, including the async choreography
saga that advances order status (pending -> confirmed / cancelled) across RabbitMQ.

## Running the testbed (what works today)

Everything runs in Docker. Host ports use a private range so nothing collides with other
stacks on the machine.

```bash
cd testbed
docker compose up -d --build
```

Then:

```bash
# List products (gateway -> catalog -> postgres)
curl -s localhost:3000/api/products | head -c 200

# Fetch a product twice: first a cache miss, then a hit (gateway -> catalog -> redis/pg)
curl -si localhost:3000/api/products/p-003 | grep -i x-cache   # miss
curl -si localhost:3000/api/products/p-003 | grep -i x-cache   # hit

# Full checkout journey (auth -> cart -> order -> RabbitMQ)
TOKEN=$(curl -s -X POST localhost:3000/api/signup -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"hunter2pw"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST localhost:3000/api/cart/items -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"productId":"p-003","quantity":2}' >/dev/null
curl -s -X POST localhost:3000/api/checkout -H "authorization: Bearer $TOKEN"   # creates order, publishes order.created
```

Open Jaeger at **http://localhost:16687** and look at the `gateway` service. A checkout is
a single trace spanning gateway, auth, cart, catalog, order, Postgres, Redis, and a
RabbitMQ publish, with context propagated across every boundary (including into the
`order.created` message headers).

Tear down with `docker compose down` (add `-v` to also drop the Postgres volume).

### Ports (host side)

| Service | URL / port |
|---------|-----------|
| Storefront SPA | http://localhost:8088 (start with `--profile ui`) |
| Gateway API | http://localhost:3000 |
| Auth API | http://localhost:3001 |
| Catalog API | http://localhost:3002 |
| Cart API | http://localhost:3003 |
| Order API | http://localhost:3004 |
| Payment worker | http://localhost:3005/healthz |
| Inventory worker | http://localhost:3006/healthz |
| Notification worker | http://localhost:3007/healthz |
| Jaeger UI | http://localhost:16687 |
| OTLP collector | localhost:24317 (gRPC), 24318 (HTTP) |
| Postgres | localhost:55432 |
| Redis | localhost:56379 |
| RabbitMQ | localhost:55672 (amqp), http://localhost:15673 (management) |

### Optional profiles

```bash
docker compose --profile ui up -d frontend      # storefront SPA on :8088
docker compose --profile load up -d loadgen     # continuous traffic (set DURATION_SECONDS=0 to run forever)
```

## How the testbed is instrumented

Services use standard OpenTelemetry auto-instrumentation and export OTLP to an OTel
collector, which forwards to Jaeger. Adding LiveProbe later is a one-line change in
[testbed/otel/collector-config.yaml](testbed/otel/collector-config.yaml).

One gotcha worth knowing: some OTel instrumentations (ioredis, and likely amqplib) only
hook the CommonJS `require` path, not ESM `import`. The shared layer loads those clients
via `createRequire` so their spans actually appear. See
[testbed/packages/shared/src/redis.ts](testbed/packages/shared/src/redis.ts).

## Working docs

- [CLAUDE.md](CLAUDE.md) — architecture and how we work here.
- [plan.md](plan.md) — LiveProbe plan and its Phase 1 contract.
- [plan-testbed.md](plan-testbed.md) — Shopwave testbed plan and contract.
- [IMPLEMENT.md](IMPLEMENT.md) — decision-to-code audit trail.
- [CHANGELOG.md](CHANGELOG.md) — timestamped functional changes.
- [LOOPS.md](LOOPS.md) — engineering principles this project runs under.
