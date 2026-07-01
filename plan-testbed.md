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
Task: T0 infra + scaffolding
  Files: testbed/docker-compose.yml, otel-collector-config.yaml,
         infra/postgres/init/*.sql, packages/shared/*, packages/gateway/*, packages/catalog/*
  Action: compose stack up; shared OTel/pg/redis/amqp helpers; gateway + catalog end to end
  Verify: contract 1 (partial), a catalog request is a trace in Jaeger, HTTP context propagates
  Done: one request through gateway→catalog→postgres/redis appears as one trace in Jaeger

Task: T1 sync core
  Files: packages/auth/*, packages/cart/*, packages/order/*
  Action: auth (JWT+Redis), cart (Redis, price check via catalog), order (Postgres + publish)
  Verify: contract 2–5, cache hit/miss (4)
  Done: a checkout writes an order and publishes order.created

Task: T2 async workers
  Files: packages/payment-worker/*, packages/inventory-worker/*, packages/notification-worker/*
  Action: consume RabbitMQ with context propagation; choreography saga; failure injection
  Verify: contract 6–11
  Done: order reaches a terminal status via events; trace is unbroken across RabbitMQ

Task: T3 frontend
  Files: testbed/frontend/* (Vite + React + TS)
  Action: lean SPA — browse, product, cart, checkout, order status; login/signup
  Verify: contract 13
  Done: the core journey works against the live backend

Task: T4 load generator
  Files: testbed/loadgen/*
  Action: concurrent virtual users running journeys; knobs for RPS and failure injection
  Verify: contract 12
  Done: continuous, varied, watchable traffic

Task: T5 wire to LiveProbe
  Files: testbed/otel-collector-config.yaml
  Action: add LiveProbe's OTLP ingest as a second exporter (depends on LiveProbe Phase 2)
  Verify: contract 14
  Done: LiveProbe renders live diagrams of Shopwave traffic
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
