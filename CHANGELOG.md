# Changelog

Timestamped functional changes (LOOPS rule XXIV). Newest first.

## [2026-07-02]
- New doc `docs/integrating-your-app.md`: the general "wire your own system into LiveProbe"
  guide — the OTLP/JSON-only ingest fact, when a collector is needed, and recipes for a
  dockerized app (the Shopwave pattern), a non-dockerized process/VM/systemd, a browser SPA
  (direct), and an app emitting a custom format (native `/v1/events`). Plus a field-mapping
  table and a curl smoke test. Linked from `docs/README.md`. Docs only, no code change.

## [2026-07-01 20:55]
- Version surfaced in the UI: root `package.json` is the single product-version source (bumped
  0.0.0 → **0.1.0**); `packages/ui/vite.config.ts` reads it and injects `__APP_VERSION__` at build
  time; the header (status bar) shows `v0.1.0` next to the trace/service counters. Declared the
  global in `vite-env.d.ts`; added a `.version` style and an e2e assertion (12 e2e now).

## [2026-07-01 20:40]
- Fix hardcoded UI API base: `BASE_URL` (and the derived ws URL) now default to
  `window.location.origin` in a production build, falling back to `http://localhost:4319` only in
  the Vite dev server (`import.meta.env.DEV`). A static UI deploy on any port now talks to its own
  origin instead of a fixed :4319. Removed the `VITE_LIVEPROBE_URL=…:4399` override from `e2e:serve`
  — the e2e browser now uses its serving origin. All 11 e2e + 13 unit + typecheck green.
  (`packages/ui/src/lib/api.ts`.)

## [2026-07-01 20:15]
- UI e2e tests: Playwright suite under `e2e/` (11 specs across live dashboard, trace page
  waterfall/sequence, search by endpoint + span attribute, errors, history→day). Deterministic
  fixtures seeded via `POST /v1/events` (`e2e/seed.ts`); ingest persists synchronously so all
  pages see the data. `playwright.config.ts` webServer builds the UI, serves it from the server on
  an isolated port (:4399) + temp DB — no docker/testbed/loadgen. Scripts: `npm run test:e2e`,
  `e2e:serve`. Added `@playwright/test` devDep; gitignored test-results/report/.e2e-data.
- Gotcha surfaced + handled: the built UI's API base is `VITE_LIVEPROBE_URL ?? http://localhost:4319`,
  so `e2e:serve` builds with `VITE_LIVEPROBE_URL=http://localhost:4399` to point the browser at the
  test server. 13 unit tests + typecheck still green.

## [2026-07-01 19:30]
- Docs/examples: added examples/otel-react-go/ — a reference integration for a greenfield
  React + Go app via OpenTelemetry. Documents the load-bearing fact that LiveProbe ingest is
  OTLP/JSON, so Go (protobuf exporter) routes through an OTel Collector with encoding:json while
  React (browser JSON exporter) posts straight to /v1/traces. Files: README.md, otel-collector.yaml,
  go-backend/{telemetry.go,main.go,go.mod} (net/http + otelhttp + pgx/otelpgx), react-frontend/
  tracing.ts (fetch/XHR auto-instrumentation + W3C propagation). Reference snippets, not a runnable
  service; no product code changed.

## [2026-07-01 18:45]
- Client integration MVP (the adapter layer): native POST /v1/events ingest (coerceEvents in
  @liveprobe/core; server shares the ingest path with OTLP) + a collector (packages/collector)
  with stdin/rabbitmq sources, an adapter registry, and a batching sink, plus a reference
  adapter-id-1 mapping (structured client event -> Event[]). Server gained a DB_PATH override.
- Verified end to end: sample client events (stdin) -> adapter -> /v1/events -> LiveProbe rendered
  a web-gateway -> orders-api -> payments trace with the payment span as an error. 13 tests pass.
- Docs: docs/integration-adapters.md (built + run instructions), README, HANDOFF. Client's private
  format spec stays in adapters-hidden/.
- Files: packages/core (native.ts), packages/server (server.ts, index.ts, test), packages/collector/*,
  tsconfig, package.json.

## [2026-07-01 17:45]
- Four features: (1) tighter flow layout via barycenter ordering (crossing reduction) + spacing;
  (2) export diagrams — copy Mermaid + download standalone SVG/PNG for the flow, copy Mermaid for
  a trace's sequence (lib/export-diagram.ts inlines computed styles); (3) multi-day trends chart on
  /history (requests/day bars, errors overlaid); (4) trace compare (/compare?a=&b=) with a
  per-operation timing diff (A vs B vs delta) and a compare link on the trace page.
- Verified all four in a headless browser (SVG download fires, compare diff renders, no errors).
- Files: packages/ui (layout, export-diagram, flow-view, trace-page, trends-chart, history-page,
  compare-page, app, styles).

## [2026-07-01 17:00]
- Filter the live view: a service dropdown on the Live page (store `filterService`). The trace
  feed shows only traces touching the service, and the flow graph collapses to that service's
  subgraph (it + direct neighbors + touching edges). Client-side; clear button resets. Verified
  (filter=cart -> 5-node subgraph, feed 175->93, no errors).
- Files: packages/ui (store, live-page, trace-list, flow-view, styles).

## [2026-07-01 16:30]
- Search by span attribute: each trace stores a compact `attrs_text` (distinct key=value pairs
  across its spans); `/api/search` + the search page gained an `attr` filter ("key=value" precise,
  or a bare value). Verified discrimination on live data (messaging.system=rabbitmq -> only
  checkouts; nonexistent -> 0). Only matches traces ingested after this change (older rows NULL).
- Ops: cleaned the history DB (555MB -> 28KB, DELETE + VACUUM); killed a stale duplicate LiveProbe
  server left on :4319 that was serving old code and blocking the watch server.
- Files: packages/server/src/history-store.ts (+test), server.ts; packages/ui search page/api/types.

## [2026-07-01 15:30]
- UI/dashboard features: (1) span waterfall + attribute drill-down on the trace page
  (Waterfall/Sequence tabs; auto-selects the failing span); (2) error explorer (/errors) —
  errored traces grouped by endpoint + error label; (3) clickable flow node -> service page
  (/service/:name) with deps/error-rate/top-ops; (4) latency-over-time chart per endpoint on
  the day dashboard. Server: spans in trace detail, error_label + errorGroups, serviceDetail,
  endpointLatency; endpoints /api/service/:name, /api/errors, /api/day/:date/latency.
- Bugfix: an old trace without `spans` crashed WaterfallView and unmounted the app (blank
  trace + errors pages until reload). Fixed with a spans default + a route-keyed ErrorBoundary.
- Verified all four in a headless browser against live data. Files: packages/server
  (summary, history-store, server), packages/ui (pages/components/api/types/styles), docs.

## [2026-07-01 13:45]
- Flow graph zoom-to-fit: the whole topology now scales into view (datastore nodes no longer
  render off-screen), with wheel-zoom, drag-to-pan, and +/-/Fit controls.
- Richer search: added latency ceiling (maxMs), min span count, sort (recent | slowest), and a
  service autocomplete from the live topology. Server /api/search + the search page updated.
- dev.sh now hot-reloads by DEFAULT (Vite HMR UI + tsx watch server/testbed); use --static for
  the build-and-serve mode. 10 tests pass.
- Files: packages/ui/components/flow-view, pages/search-page, lib/api, styles; packages/server
  history-store + server + test; dev.sh; README; docs/architecture.md.

## [2026-07-01 13:00]
- Added a hot-reload dev loop: `./dev.sh --watch` runs the LiveProbe UI under Vite HMR (:5173),
  the LiveProbe server under `tsx watch`, and the testbed services under `tsx watch` via
  testbed/docker-compose.dev.yml (bind-mounts source). Plain ./dev.sh stays build-and-run.
  Verified tsx watch restarts on change and the dev overlay applies watch+mounts.
- Files: dev.sh, testbed/docker-compose.dev.yml, README.md.

## [2026-07-01 12:30]
- LiveProbe UI: daily dashboard (/history + /day/:date) with rollup cards (requests, error
  rate, p50/p95/p99), a throughput chart (errors overlaid red), top-endpoints table, and
  slowest traces. Plus a Search feature: /search page (endpoint / service / error / min-latency
  filters, shareable via URL) and a header search box; backed by GET /api/search over SQLite.
- Verified in a headless browser: history drill-down, the day dashboard (3,243 requests, p95
  59ms, per-endpoint rollups), and search (200 results linking to trace pages), no JS errors.
- Files: packages/ui/* (pages/history, day, search; components/header, throughput-chart;
  lib/api, types; app, styles), packages/server/src/history-store.ts (search) + server.ts, docs.

## [2026-07-01 11:45]
- LiveProbe history/persistence: the server now persists trace summaries + detail to SQLite
  (node:sqlite, no dep), partitioned by UTC day. New APIs: GET /api/days, /api/day/:date/summary
  (requests, error rate, p50/p95/p99, per-minute throughput, top endpoints, slowest traces),
  /api/day/:date/traces. /api/traces/:id now falls back to history after a trace ages out of the
  live window. 9 tests pass. Verified on live traffic (360 requests, p95 50ms, endpoint rollups).
- Files: packages/server/src/history-store.ts (+test), server.ts, index.ts, .gitignore.

## [2026-07-01 11:00]
- LiveProbe UI UX: added client-side routing (react-router). Clicking a trace now opens a
  dedicated /trace/:id page (own URL, back link, summary + sequence) instead of churning the
  live list. Added a Pause control that freezes the live trace feed (with an "N new" counter)
  so you can inspect calmly. Verified in a headless browser: routing, pause, and the enriched
  sequence render with no JS errors.
- Files: packages/ui/* (routing, pause, header, live-page, trace-page), docs/architecture.md.

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
