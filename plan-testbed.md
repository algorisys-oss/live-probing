# Testbed Plan — Shopwave

A real, full-stack e-commerce order pipeline used to exercise LiveProbe with honest,
varied, continuous traffic. Working name **Shopwave**. This upgrades and replaces the
`examples/demo-services` placeholder in `plan.md`.

The point is not to build a product. The point is a realistic distributed system that
emits every trace shape LiveProbe needs to draw: sync request chains, async fan-out,
cache hit/miss, and error paths, all under continuous load.

## Principle

Instrument with **standard OpenTelemetry**, not our own SDK. That keeps the testbed an
honest, independent trace source: it works with Jaeger today and with LiveProbe's OTLP
collector once that exists. It also proves the "any OTel app works" claim for free. We
dogfood our own `sdk-js` later by adding it to one service alongside the OTel export.

## Architecture

```
  Storefront SPA ─► Gateway/BFF ─┬─► auth      (Postgres users, Redis sessions)
                                 ├─► catalog   (Postgres, Redis cache: hit/miss)
                                 ├─► cart      (Redis; validates price via catalog)
                                 └─► order     (Postgres) ──publish──► RabbitMQ
                                                                         │ order.created
                                            ┌────────────────────────────┼────────────────┐
                                       payment-worker            inventory-worker     notification-worker
                                       (Postgres payments,       (Postgres inventory,  (Redis dedupe,
                                        random declines)          out-of-stock path)    "sends" email)
                                            │ payment.completed/failed  │ inventory.reserved/out_of_stock
                                            └──────────────► RabbitMQ ◄──┘
                                                              │ (choreography saga updates order status)
```

Order status advances as downstream events complete (event-driven choreography saga),
which is what produces the interesting async topology.

## Services (all Node/TS, OTel auto-instrumented)

| Service | Stores | Talks to | Emits |
|---|---|---|---|
| gateway (BFF) | — | all services | HTTP spans, entry point |
| auth | Postgres users, Redis sessions | — | login/signup |
| catalog | Postgres products, Redis cache | — | cache hit/miss spans |
| cart | Redis cart | catalog | cart ops |
| order | Postgres orders | RabbitMQ | publishes order.created |
| payment-worker | Postgres payments | RabbitMQ | consumes order.created, publishes payment.* |
| inventory-worker | Postgres inventory | RabbitMQ | consumes order.created, publishes inventory.* |
| notification-worker | Redis dedupe | RabbitMQ, order | consumes payment.*/inventory.*, updates status |

## Infra (docker-compose)

- **postgres** — one container, a database per service (created by an init script), for
  realistic service isolation.
- **redis** — sessions, caches, cart, dedupe.
- **rabbitmq** — with the management plugin; topic exchange for the order events.
- **jaeger** — all-in-one, OTLP in. The reference oracle we diff LiveProbe against (rule XXXVII).
- **otel-collector** — receives OTLP from every service, exports to Jaeger now and to
  LiveProbe once its collector exists. One switch to add LiveProbe as a second exporter.

## Instrumentation

`@opentelemetry/sdk-node` + auto-instrumentations for http, the web framework, `pg`,
`ioredis`, and `amqplib`. A shared bootstrap module sets it up once per service. Trace
context must propagate across HTTP **and** across RabbitMQ messages (inject into message
headers on publish, extract on consume), or traces break at the async boundary.

## The contract (testable "done" — rule XXIX)

1. `docker compose up` brings up postgres, redis, rabbitmq, jaeger, otel-collector, and
   all 8 services, all healthy.
2. Migrations run; per-service databases exist and catalog is seeded.
3. Signup then login returns a JWT; the session is stored in Redis.
4. Browsing the same product twice shows a Redis cache miss then a hit, visible in spans.
5. Checkout writes an order row and publishes `order.created` to RabbitMQ.
6. payment-worker consumes it and writes a payment row; a configurable decline rate
   produces error spans.
7. inventory-worker decrements stock; insufficient stock takes the out-of-stock path and
   emits the alternate event.
8. notification-worker consumes downstream events and advances the order to a terminal
   status.
9. One completed journey is a single trace spanning gateway through the workers, visible
   in Jaeger.
10. The RabbitMQ fan-out shows as producer and consumer spans across services.
11. **Trace context propagates across RabbitMQ**: no broken traces at the async boundary.
    (The load-bearing one. Naive setups drop the trace here.)
12. The load generator sustains concurrent journeys with configurable RPS and failure rates.
13. The SPA completes browse, cart, checkout, and order-status against the live backend.
14. Flipping one collector config line adds LiveProbe as a second OTLP target with no
    service changes.

## Phases

Everything except T5 is independent of LiveProbe and can be built now. Building the
testbed first gives us the realistic trace source to develop LiveProbe against.

```
Task: T0 infra + scaffolding   [DONE 2026-07-01, verified]
  Files: testbed/docker-compose.yml, otel/collector-config.yaml,
         infra/postgres/init/*.sql, packages/shared/*, packages/gateway/*, packages/catalog/*
  Action: compose stack up; shared OTel/pg/redis helpers; gateway + catalog end to end
  Verify: DONE — a gateway request is one Jaeger trace of 9 spans spanning gateway,
          catalog, Postgres, and Redis; context propagates across every boundary; the
          cache miss/hit path shows redis get/set spans (contract items 1–5 partial, 4 met).
  Done: one request through gateway→catalog→postgres/redis appears as one trace in Jaeger.
  Note: OTel instrumentation for ioredis (and likely amqplib) only hooks CommonJS require,
        not ESM import. Shared clients that hit that trap load via createRequire so their
        spans appear. This is the async-boundary risk (contract 11) surfacing early — good.

Task: T1 sync core   [DONE 2026-07-01, verified]
  Files: packages/auth/*, packages/cart/*, packages/order/*, packages/gateway/* (extended),
         packages/shared/src/amqp.ts
  Action: auth (JWT+Redis), cart (Redis, price check via catalog), order (Postgres + publish)
  Verify: DONE — signup/login issue a JWT with a Redis-backed session; add-to-cart stores in
          Redis; checkout writes an order (atomic pg transaction) and publishes order.created.
          Verified a checkout is one 26-span trace across gateway, auth, cart, catalog, order,
          Postgres, Redis, and a RabbitMQ publish; the published message carries a traceparent
          header, so context crosses the async boundary (contract items 2, 3, 5 met).
  Done: a checkout writes an order and publishes order.created.
  Note: confirmed the amqplib createRequire fix predicted at T0 — publish spans appear and
        trace context is injected into message headers. T2 consumers just extract it.

Task: T2 async workers   [DONE 2026-07-01, verified]
  Files: packages/payment-worker/*, packages/inventory-worker/*, packages/notification-worker/*,
         packages/order/src/saga.ts (+ repo/db saga columns), packages/shared/src/amqp.ts (consume)
  Action: consume RabbitMQ with context propagation; choreography saga; failure injection
  Verify: DONE (contract 6–11) — payment-worker (15% decline), inventory-worker (real stock,
          out_of_stock path), notification-worker (redis dedupe). order-service saga folds
          payment/inventory results into status via one atomic UPDATE. A checkout is ONE
          connected trace across all 8 services + Postgres + Redis + RabbitMQ, following
          publish->consume->publish->consume with no break (contract 11 met). Confirmed both
          terminal paths: p-003 -> confirmed, p-005 x5 -> cancelled (out_of_stock).

Task: T3 frontend   [DONE 2026-07-01, verified]
  Files: testbed/frontend/* (Vite + React + TS, served by nginx), gateway CORS
  Action: lean SPA — browse, product, cart, checkout, order status polling; login/signup
  Verify: DONE (contract 13) — builds clean, served on :8088, SPA routing fallback works,
          backed by the live gateway API. Runs under the `ui` compose profile.

Task: T4 load generator   [DONE 2026-07-01, verified]
  Files: packages/loadgen/*
  Action: concurrent virtual users running full journeys; env knobs for concurrency/duration
  Verify: DONE (contract 12) — 20s run: 51 journeys, 51 checkouts, 0 errors, ~17 rps.
          Runs under the `load` compose profile.

Task: T5 wire to LiveProbe   [BLOCKED on LiveProbe core]
  Files: testbed/otel/collector-config.yaml
  Action: uncomment the otlp/liveprobe exporter and add it to the traces pipeline
  Verify: contract 14
  Done: LiveProbe renders live diagrams of Shopwave traffic (needs LiveProbe Phase 2 collector)
```

## Decisions

- All services Node/TS: dogfoods `sdk-js` later, one language, fastest first build. A
  Python service is the natural polyglot proof once the core is stable.
- Standard OpenTelemetry for instrumentation, not our SDK, so the testbed is honest.
- Jaeger in the stack as the reference oracle (rule XXXVII).
- otel-collector in the middle so adding LiveProbe is a one-line config change.
- Database-per-service on one Postgres container for realistic isolation without container sprawl.
- Event-driven choreography saga for order status, to produce rich async topology.

## Open questions

- Web framework: Express vs Fastify. Fastify has cleaner OTel and TS support; decide at T0.
- RabbitMQ topology: one topic exchange with routing keys vs per-event exchanges. Lean to
  one topic exchange; confirm at T2.
- Decline / out-of-stock rates: set from what makes the diagrams legible, not realism alone.
