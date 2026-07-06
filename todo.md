# LiveProbe TODO

Progress and backlog. `[x]` = done and verified, `[ ]` = planned. Effort tags on backlog
items: **S** = hours, **M** = ~a day, **L** = multi-day.

---

## Completed

### Planning & docs
- [x] Brainstorm + decisions: observe behavior not source, OTLP-first ingest, React + zustand
      UI, lowercase-hyphenated naming
- [x] `CLAUDE.md`, `plan.md`, `plan-testbed.md`, `IMPLEMENT.md`, `CHANGELOG.md`
- [x] `docs/` — architecture, event model, Shopwave per-action events
- [x] `README.md` — run instructions, ports, sample users, loadgen control
- [x] Handoff-doc convention — `HANDOFF.md` (current state), updated after every task; documented in `CLAUDE.md`
- [x] Git repo initialized and pushed to `origin/main`

### Testbed (Shopwave) — a real 8-service e-commerce system
- [x] T0: infra (Postgres, Redis, RabbitMQ, Jaeger, OTel collector) + gateway + catalog; one
      trace to Jaeger, context across HTTP + datastores
- [x] T1: auth (scrypt + JWT + Redis sessions), cart (Redis + catalog price checks), order
      (Postgres, atomic transaction, publishes `order.created`)
- [x] T2: payment / inventory / notification workers + choreography saga (atomic status
      recompute); trace context propagates across every RabbitMQ hop
- [x] T3: storefront SPA (React + Vite, nginx-served)
- [x] T4: load generator (concurrent journeys, failure injection)
- [x] T5: OTel collector exports OTLP/JSON to LiveProbe; verified with live traffic
- [x] Sample users seeded (alice/bob/carol @shopwave.test / password123)
- [x] Fixed ioredis + amqplib ESM instrumentation gap via `createRequire`

### LiveProbe core (`packages/core`)
- [x] Normalized `Event` model (single source of truth)
- [x] OTLP/HTTP JSON normalizer (kind, status, peer, BigInt-nanos → micros)
- [x] HTTP name enrichment (`"POST /api/checkout"` from bare-method spans; wildcard `http.route="*"`
      falls back to the real path so catch-all/Remix apps don't collapse to `GET *`)
- [x] `TraceWindow` — out-of-order assembly, horizon + cap eviction, topology aggregation
- [x] Sequence projection (ordered messages + participants, async flag)
- [x] Mermaid sequence + flow export

### LiveProbe server (`packages/server`)
- [x] OTLP ingest `POST /v1/traces` (gzip-aware)
- [x] REST: recent traces, trace detail (sequence + Mermaid), topology
- [x] WebSocket `/ws`: snapshot + `traces`/`topology` deltas
- [x] Serves the built UI with SPA fallback
- [x] SQLite persistence (`node:sqlite`), partitioned by UTC day
- [x] Day APIs: `/api/days`, `/api/day/:date/summary` (requests, error rate, p50/p95/p99,
      throughput, top endpoints, slowest), `/api/day/:date/traces`
- [x] Trace detail falls back to history after live-window eviction
- [x] Search API (endpoint text, service, error, latency range, min spans, sort)

### LiveProbe UI (`packages/ui`, React + zustand + react-router)
- [x] Live dashboard: trace-list sidebar + flow view
- [x] Flow view — custom SVG topology, stable layout, zoom-to-fit + wheel-zoom + drag-pan +
      +/−/Fit controls; datastore nodes styled apart; edge width by volume, red on errors
- [x] Sequence view — custom SVG lifelines (dashed async, red errors)
- [x] Real endpoint titles in the list and headers
- [x] Pause control (freeze the live feed with an "N new" counter)
- [x] Routing: `/`, `/trace/:id`, `/history`, `/day/:date`, `/search`
- [x] Dedicated trace page (own URL, back link, summary + sequence)
- [x] Daily dashboard: rollup cards, throughput chart (errors overlaid), top endpoints, slowest
- [x] Search page + header search box + service autocomplete

### Dev tooling & ops
- [x] `dev-start.sh` — hot reload by default (Vite HMR + `tsx watch`), `--static` for build-and-serve
- [x] `testbed/docker-compose.dev.yml` — services under `tsx watch` with source bind-mounted
- [x] `dev-stop.sh` — one-command teardown (`--wipe` drops data)

### Verification
- [x] 10 unit/integration tests (core + server), typecheck clean
- [x] Headless-browser verification of every UI view (flow, sequence, trace page, history,
      day dashboard, search), no JS errors

---

## Backlog (enhancements)

### A. Visualization & interaction
- [x] **Ghost/external peer nodes** — non-datastore peers render as dashed "uninstrumented"
      nodes in flow + sequence (suppressed when the callee reports its own span, so no double
      edges); `externals` on Topology/Sequence; Mermaid flow styles them dashed; e2e covered
      (`docs/implementation-review.md` #1)
- [x] Clickable service nodes → a service page (deps, error rate, spans, top operations)
- [x] Tighter flow layout (barycenter ordering to reduce crossings + tighter spacing)
- [x] Span waterfall on the trace page + click-to-expand span attributes (Waterfall tab: Gantt bars nested by depth, colored per service, click a span → attributes panel)
- [x] Filter the live view (pick a service -> feed shows only its traces, flow shows its subgraph)
- [x] Export diagrams: copy Mermaid + download SVG/PNG (flow); copy Mermaid (sequence). D2 TODO

### B. Diagnostics & analysis
- [x] Error explorer (errored traces grouped by endpoint + error label, each links to a trace)
- [x] Latency-over-time per endpoint (p50/p95/p99 line chart on the day dashboard)
- [x] Search by span attribute (key=value or value; e.g. http.status_code=500, a userId)
- [x] Trace compare / diff (/compare: operation-level timing A vs B vs delta)
- [ ] Anomaly/alert hooks (error-rate or latency spike → banner/webhook) **M–L**

### C. Data & scale
- [x] Retention / pruning — `RETENTION_DAYS` (default 14, 0 disables) drops day-partitions
      older than the window at startup + hourly, VACUUMs so the file shrinks; history writes
      debounced (staged per trace, flushed on timer or before any /api read — read-your-writes
      kept) fixing the per-batch re-upsert amplification (`docs/implementation-review.md` #4)
- [ ] Sampling & backpressure on ingest under heavy load **M**
- [x] Multi-day trends overview chart on /history (requests/day + errors)

### D. Adoption & integration
- [x] **Client integration via adapters** (MVP): native `POST /v1/events` + collector
      (`packages/collector`) with stdin/rabbitmq sources + adapter registry + `adapter-id-1`
      reference mapping. Verified end to end. (more adapters = later)
- [x] **Collector `http` source + `algo-instrumentation`** (internal instrumentation-service
      format, formerly `adapter-id-2`): path-agnostic JSON receiver (drop-in for
      `POST /v1/event/instrumentation|log|audit`) + adapter mapping instrumentation/log/audit
      events to spans on `app.module` lifelines with a synthesized per-request root (format has
      no span ids). Verified end to end. Refreshed 2026-07-06 for the live HRMS format:
      `{ events: [...] }` batch envelope, `status_code` snake_case, extra fields captured.
- [x] **OTel integration reference** (`examples/otel-react-go/`): React + Go via OpenTelemetry —
      Go→collector(`encoding:json`)→LiveProbe, React→LiveProbe direct. Docs/snippets.
- [x] Collector: RabbitMQ connection-error handling / reconnect — `error`/`close` handled,
      exponential-backoff reconnect re-runs the full setup; initial connect still fails fast;
      runbook recommends a supervisor (`docs/implementation-review.md` #2)
- [ ] Docs: pure-ESM Node apps need `--import` (not `--require`) for auto-instrumentation —
      add to recipes A/B/E (`docs/implementation-review.md` gap 1) **S**
- [ ] Native SDK (`packages/sdk-js`) — drop-in tracer, use LiveProbe without OpenTelemetry **L**
- [ ] Config/env surface for ports, retention, window horizon, OTLP path **S**
- [ ] Package & publish core/server with a CLI (`npx liveprobe`) **M**

### E. Quality & hardening
- [~] UI tests — **Playwright e2e done** (`e2e/`, 11 specs: live/trace/search/errors/history,
      seeded via `/v1/events`, isolated port+DB, no docker). Component tests still open. **M**
- [ ] Raise coverage to the LOOPS bar (malformed OTLP, ws reconnect, ingest edges) **M**
- [ ] Security pass (optional API auth, tighten CORS before shared deployment) **M**
- [x] Topology edge-key separator — original finding corrected (it was already a NUL, not a
      space; names with spaces were never broken); the literal NUL byte made the file binary
      to git/grep, now written as the `"\u0000"` escape (`docs/implementation-review.md` #3)
- [ ] Ingest hardening: request body-size cap on `readBody`; sanitize attribute values in
      `coerceEvents` (`docs/implementation-review.md` #5) **S**

### F. Testbed realism
- [ ] A Python (or Go) service — prove polyglot-via-OTLP renders identically **M**
- [ ] More failure modes (timeouts, retries, circuit-breaking, slow dependency) **M**

---

## Top 5 picks (value per effort)
1. [x] Span waterfall + attribute drill-down on the trace page (B) — most useful for debugging
2. [x] Clickable service nodes → service page (A) — makes the flow graph navigable
3. [x] Search by span attribute (B) — "all traces for user X" / "all 500s on /checkout"
4. [~] UI e2e tests (E) — Playwright suite landed (11 specs); component tests still open
5. [x] Retention / pruning (C) — `RETENTION_DAYS` + debounced history writes landed
