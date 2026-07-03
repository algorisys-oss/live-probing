# Changelog

Timestamped functional changes (LOOPS rule XXIV). Newest first.

## [2026-07-03]
- **Collector: `http` source + `adapter-id-2`** (internal instrumentation-service format).
  New `SOURCE=http` (`HTTP_PORT`, default 4320): a path-agnostic JSON receiver (single event
  or array per POST, 5MB cap, `GET /healthz`) so emitters that push to
  `POST /v1/event/instrumentation|log|audit` can be repointed at the collector unchanged.
  New `adapter-id-2` maps the three event types (instrumentation / log / audit) to spans:
  `traceId = request.requestId`, participant = `application.name.module` (**app + module are
  the sequence lifelines**), a deterministic synthetic `client` root span anchors each request
  (the format has no span/parent ids — the window dedupes re-emissions by spanId),
  instrumentation → `server` span with `durationMs` + statusCode/success → status, log →
  ERROR/FATAL/CRITICAL as errors, audit → `audit ACTION entity id` with `before.*`/`after.*`
  flattened into searchable attributes. TDD: 10 new tests (**40 unit green**, typecheck clean);
  verified end to end on an isolated server (sequence + topology + Mermaid + attribute search).
  Docs: mapping section in `docs/integration-adapters.md`; private spec in
  `adapters-hidden/adapter-id-2.md` (gitignored).

## [2026-07-02] <!-- was mis-dated 2026-07-05; serve.sh landed in 2d3a360 on 07-02 -->
- **`./serve.sh` — standalone server entry point.** Runs just the LiveProbe server (UI +
  OTLP/native ingest + ws on `:4319`, env: `PORT`/`DB_PATH`/`RETENTION_DAYS`), building the
  UI on first run — no testbed, no watch. This is the command for client machines where a
  real app is the trace source (`dev-start.sh` is for developing LiveProbe itself, and drags
  the Shopwave testbed up). Referenced from `README.md`, `CLAUDE.md`, and Recipe A in
  `docs/integrating-your-app.md`. Verified: boots, serves UI + `/healthz` on :4319.

## [2026-07-02]
- **History retention + debounced writes (review finding #4).** (1) `HistoryStore.prune`
  drops whole day-partitions older than the retention window (`RETENTION_DAYS` env /
  `retentionDays` option; default **14**, `0` disables), runs at startup and hourly, and
  VACUUMs after deletions so the DB file actually shrinks — verified on a real file
  (901KB → 462KB, startup log line). Guards the 555MB regrowth with loadgen running.
  (2) Ingest no longer re-upserts every affected trace per batch: assemblies are *staged*
  per trace and flushed on a timer (`historyFlushMs`, default 1500ms) or **before any /api
  read**, so read-your-writes is preserved (the e2e seed contract) while a trace is written
  once per flush instead of once per ingest batch. Flush also runs on close. TDD: 4 new
  tests (prune drops days / prune 0 disables / flush-on-read with a 60s timer / startup
  prune via `retentionDays`) — **30 unit + 15 e2e green**, typecheck clean. README env
  notes; review finding #4 marked FIXED.
- **Review finding #3 corrected + NUL byte fixed.** The review's claim that
  `EDGE_SEP = " "` broke service names with spaces was wrong: the separator was a **literal
  NUL byte** that review tooling rendered as a space (names with spaces were never broken).
  The actual defect: the raw NUL made git/grep treat `trace-window.ts` as **binary** (no
  diffs). Now written as the `"\u0000"` escape — same runtime value, file is text again.
  Review doc + todo corrected; 26 tests + typecheck green.
- **Ghost nodes for uninstrumented peers.** Topology and sequence now draw the edge to a
  non-datastore `peer` when the callee never reported a span of its own (suppressed when a
  cross-participant child exists, so instrumented calls aren't double-drawn), and expose those
  peers as `externals` on `Topology`/`Sequence`. The UI renders them as dashed grey "ghost"
  nodes (flow) and lifelines (sequence, not clickable); the Mermaid flow export styles them
  dashed via `classDef external`. Fixes review finding #1 (the partial-rollout blind spot): an
  instrumented app calling a not-yet-instrumented one is now visible. TDD: 4 new core tests +
  1 new e2e (ghost node renders); `docs/event-model.md` updated. Verified in a live browser
  (flow + sequence screenshots) against seeded ghost traces.
- **Collector: RabbitMQ auto-reconnect.** The `rabbitmq` source now attaches `error`/`close`
  handlers (an unhandled `error` event previously crashed the process on a broker restart) and
  reconnects with exponential backoff (1s → 30s), re-running the full
  exchange/queue/bind/consume setup per attempt; the initial connect still fails fast. New
  `reconnectDelayMs` option; `ConnLike` gained `on()`. Fixes review finding #2. TDD: 3 new
  collector tests (reconnect + re-consume, failed-retry loop, stop() cancels). Runbook caveat
  updated in `docs/integration-adapters.md`. **26 unit tests, 15 e2e**, typecheck clean.
- **e2e flake fix:** the history→day spec asserted `.rollup-card` count with a non-retrying
  snapshot immediately after navigation and intermittently raced the day-summary fetch
  (reproduced on a clean checkout); now an auto-retrying `toBeVisible()`. 3× consecutive green.
- **Renamed the dev scripts**: `dev.sh` → `dev-start.sh`, `stop.sh` → `dev-stop.sh` (git mv,
  history preserved). Updated every current-state reference (`README.md`, `CLAUDE.md`,
  `HANDOFF.md`, `todo.md`, `docs/architecture.md`, `docs/integrating-your-app.md`,
  `examples/otel-react-go/README.md`, `testbed/docker-compose.dev.yml`, and the scripts'
  self-references). Historical entries in `CHANGELOG.md` / `IMPLEMENT.md` intentionally
  untouched. No behavior change.
- **Docs: implementation review** (`docs/implementation-review.md`) — reviewed the full ingest
  path (core normalizers, trace window, sequence projection, server, collector) and the
  zero-instrumentation story for React / Node / Elixir. Key findings: uninstrumented service
  peers render nowhere (only `DATASTORE_SYSTEMS` peers draw edges — the partial-rollout blind
  spot), RabbitMQ source has no connection-error handling, `EDGE_SEP=" "` breaks service names
  with spaces, per-batch trace re-upsert amplifies history writes, plus smaller ingest-hardening
  items. Actionable items mirrored into `todo.md` (A/C/D/E). Also un-staled the
  `integration-adapters.md` line in `docs/README.md` ("Design, not built yet" → MVP built).
  Docs only — no code.
- **Dev fix: stale-network containers.** `dev.sh` failed with "network 83b5089a… not found":
  the stopped profile containers (`loadgen`, `frontend`) still referenced a deleted
  `shopwave_default` network id after the network was recreated, and compose *starts* (not
  recreates) existing stopped containers. Recreated `loadgen` (`docker compose --profile load
  up -d --force-recreate loadgen`; verified generating traffic). `frontend` still holds the
  stale reference — recreate it the same way before next use. Gotcha added to `HANDOFF.md`.
- **Docs: database tracing subsection** in Recipe E of `docs/integrating-your-app.md` — why DB
  spans must be born in the app process (Postgres renders as a datastore *peer*, nothing installed
  on the DB), the three intrusion tiers (Node `--require` preload = no source change; Elixir Ecto
  = a two-line setup, no BEAM preload exists; eBPF/Beyla = zero app change, host-level), what
  doesn't work for LiveProbe (query logs / proxies have no trace ids), and the adapter-path
  caveat (`adapter-id-1` drops `peer`/`duration`). Docs only.
- **Collector: bounded tap queue (opt-in).** `rabbitmqSource` now takes `QUEUE_MAX_LENGTH`
  (→ `x-max-length` with `x-overflow: drop-head`, keeping newest) and `QUEUE_MESSAGE_TTL_MS`
  (→ `x-message-ttl`) so a live tap can't back up unboundedly while the collector is down. Added
  2 unit tests (args set / no-bounds asserts without an `arguments` object) — **19 tests**. Verified
  on the live testbed RabbitMQ (a conflicting re-declare returned PRECONDITION_FAILED, proving the
  args reached the broker). Documented in `docs/integration-adapters.md`.
- **Collector: built-in RabbitMQ exchange tap.** `rabbitmqSource` now takes `EXCHANGE` /
  `EXCHANGE_TYPE` / `ROUTING_KEY` (env in `packages/collector/src/index.ts`): it declares the
  exchange (when a type is given) or verifies it passively (when not), asserts the queue, and
  binds it — making the non-intrusive fanout tap pure config instead of a manual RabbitMQ admin
  step. The source is now injectable (`opts.connect`) for testing. Added 4 unit tests (plain
  consume, passive-tap binding, declare-tap default key `#`, poison-message nack) via a fake
  connection — **17 tests** total. Verified end to end against the live testbed RabbitMQ (declared
  a topic exchange, bound a dedicated queue, received a published event). Updated the runbook +
  Source notes in `docs/integration-adapters.md` to reflect the built-in binding.
- **Docs: non-intrusive adapter rollout runbook.** Added a step-by-step runbook to
  `docs/integration-adapters.md` for onboarding an existing production estate (N polyglot apps
  across VPS/GCP that already emit `adapter-id-1` to a shared RabbitMQ): tap-don't-divert
  principle, RabbitMQ fanout-copy vs stdout-tee tap points (with the competing-consumer
  warning), one-collector-per-client, where to run it, what renders vs. what's limited for this
  format, and honest production caveats (best-effort delivery, single consumer). Corrected two
  optimistic claims in the "Source notes" to match the code (the `rabbitmq` source asserts a
  queue but does not bind an exchange; delivery is best-effort, not durable). Cross-linked from
  Recipe D in `docs/integrating-your-app.md`. Docs only.
- **Docs tidy:** moved the planning/contract specs `plan.md` and `plan-testbed.md` into `docs/`
  (alongside `architecture.md`, `event-model.md`, …) and indexed them in `docs/README.md`.
  Updated the links/paths in `README.md` and `CLAUDE.md`. Rolling project-state and audit docs
  (`HANDOFF.md`, `todo.md`, `IMPLEMENT.md`, `CHANGELOG.md`) stay at the repo root, where the LOOPS
  doctrine (rule XXV: IMPLEMENT.md at project root) and CLAUDE.md (HANDOFF at repo root) pin them.
  No code touched.
- **UI: light/dark theme + history-chart legibility fix.** (1) Fixed black-on-dark labels on
  the History trends chart: `.axis`/`.axis-label` were only styled scoped under `.latency-chart`,
  so the trends chart's reused class names fell back to the SVG default black fill — promoted
  both to global rules (`packages/ui/src/styles.css`). (2) Added a **light/dark theme toggle** in
  the header: a `data-theme` attribute on `<html>` drives a second, contrast-checked (WCAG AA)
  palette; choice persisted to localStorage and applied pre-paint via an inline script in
  `index.html` to avoid a flash (`lib/theme.ts`, `components/header.tsx`). Diagram SVG/PNG export
  now takes its background from the active theme's `--bg` (`lib/export-diagram.ts`). Added 2 e2e
  (chart-label legibility + toggle/persist) → **14 e2e** + 13 unit + typecheck green.
- New doc `docs/integrating-your-app.md`: the general "wire your own system into LiveProbe"
  guide — the OTLP/JSON-only ingest fact, when a collector is needed, and recipes for a
  dockerized app (the Shopwave pattern), a non-dockerized process/VM/systemd, a browser SPA
  (direct), and an app emitting a custom format (native `/v1/events`). Plus a field-mapping
  table and a curl smoke test. Linked from `docs/README.md`. Docs only, no code change.
- Added **Recipe E — VPS deploy, no Docker (React + Node / Go / Elixir)** to the same doc:
  one systemd collector per box, browser routed through the collector (so LiveProbe stays
  private), and per-stack config incl. Elixir/Phoenix OTel setup. Reflects the user's typical
  DigitalOcean deployment.

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
