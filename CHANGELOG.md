# Changelog

Timestamped functional changes (LOOPS rule XXIV). Newest first.

## [2026-07-01 10:30]
- Added stop.sh (stop the LiveProbe server + tear down the whole Docker stack; --wipe drops data).
- Added docs/: architecture.md (full pipeline + packages + testbed + T5), event-model.md
  (the normalized Event structure and OTLP mapping), shopwave-events.md (per-action HTTP +
  RabbitMQ message payloads and the trace each action produces). Linked from the README.
- Files: stop.sh, docs/*, README.md.

## [2026-07-01 10:00]
- LiveProbe: derive real endpoint titles ("POST /api/checkout") from HTTP span attributes
  instead of the bare method the instrumentation emits; fixes uninformative trace titles in
  the list and sequence header. 8 tests pass.
- README: documented starting/stopping/tuning the load generator.
- Files: packages/core/src/otlp.ts, core.test.ts, README.md.

## [2026-07-01 09:00]
- Testbed auth seeds sample users on startup (alice/bob/carol @shopwave.test / password123),
  idempotent via ON CONFLICT. Documented in the README, plus a note explaining what Jaeger is.
- Files: testbed/packages/auth/src/seed-users.ts, db.ts, README.md.

## [2026-07-01 08:30]
- LiveProbe UI (packages/ui): React + zustand live dashboard. Trace list, custom-SVG flow
  view (stable-layout topology, datastore nodes, log-scaled edges, red on errors), and
  per-trace sequence view (lifelines, async/error styling). Live over websocket with REST
  fallback and auto-reconnect. Built and served by the LiveProbe server at :4319.
- dev.sh runs it all end to end (build UI -> testbed up -> loadgen -> server serving UI).
- Verified live: UI served (index + assets 200, SPA fallback), and /api shows the full
  Shopwave topology (12 nodes, 26 edges) + streaming traces from real traffic.
- Files: packages/ui/*, dev.sh, .gitignore, README.md.

## [2026-07-01 07:30]
- LiveProbe server (packages/server): OTLP/HTTP JSON ingest (gzip-aware) into the trace
  window; REST for recent traces, per-trace sequence + Mermaid, aggregate topology +
  Mermaid; websocket pushing snapshot + deltas. 7 tests pass.
- T5 wired and verified with LIVE traffic: the testbed OTel collector now fans out OTLP/JSON
  to LiveProbe on the host (host.docker.internal:4319, added host-gateway to the collector).
  LiveProbe renders the full Shopwave topology (order->postgresql, order->rabbitmq, etc.)
  and a real 52-span checkout sequence.
- Added dev.sh (end-to-end runner) and expanded the README with LiveProbe run instructions.
- Files: packages/server/*, testbed/otel/collector-config.yaml, testbed/docker-compose.yml,
  tsconfig.json (scope to node packages), dev.sh, README.md.

## [2026-07-01 06:00]
- LiveProbe core (packages/core): normalized Event model, OTLP/HTTP JSON -> Event[]
  normalizer, TraceWindow (out-of-order trace assembly, horizon+cap eviction, service/
  datastore topology aggregation), sequence projection, Mermaid sequence+flow exporters.
  6 unit tests pass against an OTLP fixture shaped like real testbed traffic; typecheck clean.
- Decisions recorded in CLAUDE.md: OTLP-first ingest (pivot from native-first, since the
  testbed emits OTLP); UI in React + zustand; lowercase-hyphenated file/folder names.
- Committed the testbed (code + docs) as two commits on top of the planning genesis.
- Files: package.json, tsconfig.json, packages/core/* (event, otlp, trace-window, sequence,
  export/mermaid, index, core.test), CLAUDE.md, plan.md.

## [2026-07-01 05:00]
- Testbed T2 (async workers + saga): payment-worker (15% decline), inventory-worker (real
  stock, out_of_stock path), notification-worker (redis dedupe). order-service gained a
  choreography saga (consume payment.*/inventory.*, atomic status recompute) and shared
  gained a consume() helper. Verified a checkout is ONE connected trace across all 8 services
  + Postgres + Redis + RabbitMQ (publish->consume->publish->consume unbroken); confirmed and
  cancelled (out_of_stock) terminal paths both work.
- Testbed T3 (storefront SPA): Vite + React + TS, nginx-served on :8088 (ui profile), gateway
  CORS opened. Testbed T4 (loadgen): concurrent journeys (load profile); 20s run did 51
  checkouts, 0 errors, ~17 rps.
- Built five components in parallel with subagents (3 workers, loadgen, SPA); one agent hit a
  transient 529 near the end, finished by hand. T5 (point the collector at LiveProbe) is a
  documented one-line switch, blocked on the LiveProbe core.
- Files: testbed/packages/{payment-worker,inventory-worker,notification-worker,loadgen} (new),
  packages/order (saga), packages/shared/src/amqp.ts, testbed/frontend/* (new),
  docker-compose.yml, Dockerfile, README.md.

## [2026-07-01 03:30]
- Testbed T1 (sync core): auth (scrypt + JWT + Redis sessions), cart (Redis + catalog price
  checks), order (Postgres, atomic transaction, publishes order.created to RabbitMQ). Gateway
  extended with auth verification and cart/order/checkout proxying. Added shared amqp helper
  (createRequire, publish to the shopwave.orders topic exchange).
- Verified: a checkout is one 26-span trace across 5 services + Postgres + Redis + a RabbitMQ
  publish; the order.created message carries a traceparent header (context crosses the async
  boundary). Built the three services in parallel with subagents; integrated gateway + compose.
- Files: testbed/packages/{auth,cart,order} (new), packages/gateway (extended),
  packages/shared/src/amqp.ts, docker-compose.yml, Dockerfile, package.json, README.md.

## [2026-07-01 02:00]
- Testbed T0: Shopwave infra + gateway/catalog vertical slice, OTel to Jaeger. Verified a
  single trace spans gateway -> catalog -> Postgres -> Redis with context propagated and
  cache miss/hit visible in spans.
- Fixed missing redis spans: OTel ioredis instrumentation only hooks CommonJS require, so
  the shared redis client loads via createRequire. Same trap expected for amqplib (T2).
- Remapped host ports to a private range (55432/56379/55672/15673/16687/24317-24318) to
  avoid colliding with other stacks already running on the machine.
- Files: testbed/ (docker-compose.yml, Dockerfile, otel/collector-config.yaml,
  infra/postgres/init, packages/shared, packages/gateway, packages/catalog), README.md.

## [2026-07-01 00:00]
- Project genesis: planning docs for LiveProbe and the Shopwave testbed.
- Files: CLAUDE.md, plan.md, plan-testbed.md, IMPLEMENT.md, LOOPS.md, .gitignore.
