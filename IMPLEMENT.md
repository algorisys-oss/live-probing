# IMPLEMENT

Decision-to-code audit trail (LOOPS rule XXV). Newest first.

## [2026-07-01] UX polish + daily/history mode

**Discussed (from using the live UI):** trace titles showed bare GET/POST; the live sidebar
reordered while inspecting; clicking a trace should open its own page; and the bigger vision —
"know what happened each day." Also: sample users, a one-command stop, and detailed docs.

**Decided:** do the quick UX win first, then the daily/history mode ("both, in that order").
Persistence engine = `node:sqlite` (built into Node 24, no dependency — fits stdlib-first).

**Implemented:**
- Titles: derive `METHOD /path` from HTTP span attributes in the normalizer.
- UI routing (react-router): `/` live, `/trace/:id` dedicated page, plus a Pause control that
  freezes the live feed with an "N new" counter.
- Persistence: `packages/server/history-store.ts` writes every trace (summary + detail) to
  SQLite partitioned by UTC day. APIs: `/api/days`, `/api/day/:date/summary` (requests, error
  rate, p50/p95/p99, throughput, top endpoints, slowest), `/api/day/:date/traces`. Trace
  detail falls back to the store after live-window eviction.
- UI daily dashboard (`/history`, `/day/:date`) — in progress via subagent.
- Ops/docs: `stop.sh` (one-command teardown), sample users in auth, and `docs/`
  (architecture, event-model, shopwave-events).

**Verified:** 9 tests pass. Headless-browser check of the live UI: routing, pause, and the
enriched sequence render with no JS errors. Day APIs verified on live traffic (360 requests,
p95 ~50 ms, per-endpoint rollups). Fixed a gzip trap in OTLP ingest along the way.

**Status:** LiveProbe MVP + history backend done and pushed. Daily dashboard UI integrating next.

## [2026-07-01] LiveProbe core + server + T5 (live end to end)

**Discussed:** build LiveProbe; UI in React + zustand; lowercase-hyphenated names; commit
and push; keep README updated; add a single dev.sh.

**Implemented:**
- `packages/core`: normalized Event model, OTLP/HTTP JSON normalizer, TraceWindow (out-of-
  order assembly, horizon+cap eviction, service/datastore topology), sequence projection,
  Mermaid sequence/flow export. 6 tests.
- `packages/server`: OTLP ingest (gzip-aware) into the window; REST (recent traces, trace
  detail with sequence + Mermaid, topology + Mermaid); websocket snapshot + deltas. 1 test.
- T5: testbed collector now exports OTLP/JSON to LiveProbe on the host via
  host.docker.internal (added host-gateway to the collector service).
- `packages/ui` (in progress, subagent): React + zustand live dashboard.
- `dev.sh`: one script to run testbed + loadgen + LiveProbe (serving the UI) end to end.

**Decisions:** OTLP-first ingest (pivot from native-first — the testbed already emits OTLP).
Server uses Node http + ws only (minimal deps). UI kept out of the root tsconfig (browser
app with its own config). LiveProbe runs on the host; the collector reaches it via
host-gateway, so the two compose stacks stay decoupled.

**Verified:** 7 tests pass; typecheck clean. With live loadgen traffic, LiveProbe's
/api/topology shows the full Shopwave graph and /api/traces/:id renders a real 52-span
checkout sequence. The gzip trap (otlphttp compresses by default) was found and fixed.

**Status:** core + server + T5 done and pushed (275b7ba). UI being built, then dev.sh
end-to-end verification and final commit.

## [2026-07-01] Testbed T2 + T3 + T4 built and verified ("continue all")

**Discussed:** continue building the rest of the testbed.

**Approach:** foundation first (shared `consume()`, gateway CORS, order-service saga), then
five parallel subagents — three workers, the load generator, and the React SPA — each in a
separate directory. Integrated compose/Dockerfile and verified myself. One agent (SPA) hit a
transient 529 near the end; its files were complete, I finished the build and Docker wiring.

**Implemented:**
- `packages/payment-worker`: consumes order.created, 15% random decline, writes payments,
  publishes payment.completed/failed.
- `packages/inventory-worker`: consumes order.created, real stock decrement in a transaction,
  out_of_stock path (seeded low stock on p-005/p-008), publishes inventory.reserved/out_of_stock.
- `packages/notification-worker`: consumes payment.*/inventory.*, redis SET NX dedupe, logs.
- `packages/order/src/saga.ts` + repo/db: choreography saga consuming payment.*/inventory.*,
  advancing status via one atomic UPDATE (CASE) so events can't race; new payment_status /
  inventory_status columns.
- `packages/shared/src/amqp.ts`: added `consume(queue, routingKeys, handler)` (assert+bind+ack,
  drop on throw).
- `packages/loadgen`: concurrent virtual users running full journeys, env-tunable.
- `testbed/frontend`: Vite + React + TS storefront (browse, auth, cart, checkout, order-status
  polling), nginx-served; gateway CORS opened. `ui` and `load` compose profiles added.

**Verified:**
- T2 (contract 6–11): a checkout is ONE connected trace across all 8 services + Postgres +
  Redis + RabbitMQ, following publish->consume->publish->consume unbroken. Both terminal saga
  paths confirmed: p-003 -> confirmed, p-005 x5 -> cancelled (out_of_stock). The amqplib
  createRequire fix carries context across every queue hop.
- T3 (contract 13): SPA builds clean, served on :8088, SPA-routing fallback works, API-backed.
- T4 (contract 12): 20s loadgen run = 51 journeys, 51 checkouts, 0 errors, ~17 rps.

**Blocked:** T5 (point the OTel collector at LiveProbe) needs the LiveProbe core, which is not
built. The collector config has the exporter stubbed for a one-line switch.

**Status:** testbed T0–T4 complete and running (14 containers). The honest, richly-traced
system LiveProbe will consume now exists. Next real work is the LiveProbe core (plan.md).

**Files:** testbed/packages/{payment-worker,inventory-worker,notification-worker,loadgen} new;
testbed/frontend new; packages/order + packages/shared changed; docker-compose.yml, Dockerfile,
README updated.

## [2026-07-01] Testbed T1 (sync core) built and verified

**Discussed:** continue building; parallelize with multiple agents.

**Approach:** built the shared amqp helper and dependencies myself (cross-cutting), then
spawned three subagents in parallel — one each for auth, cart, order — since each is a
separate package with no file overlap. Each got the exact shared API, integration
contract (ports, headers, request/response shapes), and house conventions. I then did the
gateway extension, compose wiring, Dockerfile copies, and the end-to-end verification.

**Implemented:**
- `packages/auth`: scrypt password hashing, JWT (HS256), Redis-backed revocable sessions;
  `/signup`, `/login`, `/verify`.
- `packages/cart`: Redis hash cart, catalog price validation over HTTP, `/cart`,
  `/cart/items`, `/cart/checkout` (calls order, clears cart).
- `packages/order`: Postgres orders + order_items, atomic create transaction, publishes
  `order.created` to the shopwave.orders topic exchange; `/orders`, `/orders/:id`.
- `packages/gateway`: auth verification hop, cart/order/checkout proxying with `x-user-id`.
- `packages/shared/src/amqp.ts`: connect + assert exchange + publish (createRequire).

**Verified (contract items 2, 3, 5 met):** a full signup -> add-to-cart -> checkout journey
produces one 26-span trace across gateway, auth, cart, catalog, order, Postgres, Redis, and
a RabbitMQ publish; the captured order.created message carries a traceparent header, proving
trace context crosses the RabbitMQ boundary. The amqplib createRequire fix predicted at T0
holds. Order creation confirmed atomic (single client BEGIN/COMMIT/ROLLBACK).

**Fixes during integration:** gateway had a bad Fastify request type helper (used
FastifyRequest from shared instead). A checkout 400 in the test harness was a harness bug
(sent application/json content-type with an empty body, which Fastify rejects), not a
service bug.

**Status:** T0 and T1 complete and running (11 containers). Next: T2 (payment, inventory,
notification workers consuming order.created with context propagation, failure injection).

**Files:** testbed/packages/{auth,cart,order} new; gateway, shared, docker-compose.yml,
Dockerfile, package.json changed; README updated.

## [2026-07-01] Testbed T0 built and verified

**Discussed:** start building; use Fastify for the services.

**Implemented:** the Shopwave T0 vertical slice.
- Compose stack: Postgres, Redis, RabbitMQ, Jaeger (reference oracle), OTel collector.
- `packages/shared`: Fastify factory + graceful shutdown, pg pool helper, redis helper,
  env parsing, RabbitMQ/domain contracts.
- `packages/catalog`: Postgres schema + seed (12 products), read-through Redis cache,
  `/products` and `/products/:id` routes.
- `packages/gateway`: Fastify BFF proxying to catalog via fetch (context propagation).
- Instrumentation via `@opentelemetry/auto-instrumentations-node/register` (zero-code),
  OTLP to the collector to Jaeger.

**Verified (contract items 1–5 partial, 4 met):** one gateway request is a single
9-span Jaeger trace across gateway, catalog, Postgres, and Redis; context propagates
across HTTP and datastore boundaries; cache miss/hit shows redis get/set spans.

**Root-caused during the build:** redis spans were missing because OTel's ioredis
instrumentation only patches the CommonJS `require` path, not ESM `import`. Fix: load the
client via `createRequire` in `shared/src/redis.ts`. Same trap is expected for `amqplib`
at T2 (the async-boundary risk called out in the plan, surfacing early). Also remapped
all host ports to a private range because Postgres/Redis/RabbitMQ/Jaeger/OTLP were already
bound by other stacks on this machine (left those untouched, scope lock).

**Status:** T0 complete and running. Next: T1 (auth, cart, order + publish order.created).

**Files created:** testbed/* (compose, Dockerfile, otel config, pg init, shared, gateway,
catalog), README.md.

## [2026-07-01] Testbed (Shopwave) planned and committed

**Discussed:** a full-featured full-stack app to test LiveProbe against, "as real as
possible," using Docker for Postgres, Redis, and RabbitMQ.

**Decided (via four confirmed forks):**
- Domain: e-commerce order pipeline.
- Frontend: lean but real React SPA (core journey, no admin/polish).
- Service breadth: full 8-service pipeline in the first build.
- Language: all services Node/TS. Instrumented with standard OpenTelemetry, not our SDK,
  so the testbed is an honest, independent trace source.
- Stack also runs Jaeger (reference oracle, rule XXXVII) and an OTel collector, so adding
  LiveProbe as a trace target later is a one-line config change.

**Implemented so far:** planning only.
- `plan-testbed.md` — architecture, services, infra, 14-item contract, phased tasks T0–T5.
- `plan.md` — `demo-services` task marked superseded by the testbed.

**Status:** planned and committed to git (genesis commit). Not built. Testbed T0 (infra +
gateway/catalog end to end in Jaeger) and LiveProbe `event-model` are the two independent
starting points.

**Files created/changed:** plan-testbed.md, plan.md, IMPLEMENT.md, CHANGELOG.md, .gitignore.

## [2026-07-01] Project shape and Phase 1 scope decided

**Discussed:** a utility to create realtime sequence and flow diagrams of running
systems. Brainstormed the design space and chose the direction.

**Decided:**
- Observe behavior at runtime, do not parse source.
- Data source: hybrid — OTLP wire format for the OpenTelemetry ecosystem plus a tiny
  drop-in SDK for systems with no tracing yet.
- Delivery: live-first (websocket to a browser UI), snapshot export secondary.
- Language: core and first SDK in TypeScript/Node. Polyglot achieved through the OTLP
  wire format, not multiple core runtimes. Python SDK in Phase 2 proves it.
- Diagrams: both sequence (per trace) and flow/topology (aggregate window), as two
  projections of one normalized event model.
- Renderer: custom, for smooth incremental redraws under continuous input.

**Implemented so far:** documentation only.
- `CLAUDE.md` — architecture, core event model, decisions, layout, working rules.
- `plan.md` — phased plan and the Phase 1 contract (21 testable criteria).
- `IMPLEMENT.md` — this file.

**Status:** planning complete, Phase 1 not started. Next task per `plan.md` is
`event-model` (the normalized Event type + native-batch normalizer, TDD).

**Files created:** CLAUDE.md, plan.md, IMPLEMENT.md.
