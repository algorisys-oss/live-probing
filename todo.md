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
- [x] HTTP name enrichment (`"POST /api/checkout"` from bare-method spans)
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
- [x] `dev.sh` — hot reload by default (Vite HMR + `tsx watch`), `--static` for build-and-serve
- [x] `testbed/docker-compose.dev.yml` — services under `tsx watch` with source bind-mounted
- [x] `stop.sh` — one-command teardown (`--wipe` drops data)

### Verification
- [x] 10 unit/integration tests (core + server), typecheck clean
- [x] Headless-browser verification of every UI view (flow, sequence, trace page, history,
      day dashboard, search), no JS errors

---

## Backlog (enhancements)

### A. Visualization & interaction
- [ ] Clickable service nodes → a service page (endpoints, deps, error rate, p95) **M**
- [ ] Tighter flow layout (less whitespace, edge-bundling for parallel edges) **M**
- [ ] Span waterfall on the trace page + click-to-expand span attributes **M**
- [ ] Filter the live view (pin flow/feed to one service or endpoint) **S**
- [ ] Export: copy Mermaid, download SVG/PNG, add D2 export **S–M**

### B. Diagnostics & analysis
- [ ] Error explorer (errored traces grouped by endpoint + error type, failing span highlighted) **M**
- [ ] Latency-over-time per endpoint (p50/p95/p99 line chart across the day) **M**
- [ ] Search by span attribute (userId, productId, http.status, …) **M**
- [ ] Trace compare / diff (structure + timing of two traces) **L**
- [ ] Anomaly/alert hooks (error-rate or latency spike → banner/webhook) **M–L**

### C. Data & scale
- [ ] Retention / pruning (drop days older than N, size cap) **S**
- [ ] Sampling & backpressure on ingest under heavy load **M**
- [ ] Multi-day trends overview chart on `/history` **S**

### D. Adoption & integration
- [ ] Native SDK (`packages/sdk-js`) — drop-in tracer, use LiveProbe without OpenTelemetry **L**
- [ ] Config/env surface for ports, retention, window horizon, OTLP path **S**
- [ ] Package & publish core/server with a CLI (`npx liveprobe`) **M**

### E. Quality & hardening
- [ ] UI tests (component + Playwright e2e) **M**
- [ ] Raise coverage to the LOOPS bar (malformed OTLP, ws reconnect, ingest edges) **M**
- [ ] Security pass (optional API auth, tighten CORS before shared deployment) **M**

### F. Testbed realism
- [ ] A Python (or Go) service — prove polyglot-via-OTLP renders identically **M**
- [ ] More failure modes (timeouts, retries, circuit-breaking, slow dependency) **M**

---

## Top 5 picks (value per effort)
1. [ ] Span waterfall + attribute drill-down on the trace page (B) — most useful for debugging
2. [ ] Clickable service nodes → service page (A) — makes the flow graph navigable
3. [ ] Search by span attribute (B) — "all traces for user X" / "all 500s on /checkout"
4. [ ] Retention / pruning (C) — small, keeps the DB bounded
5. [ ] A Python service in the testbed (F) — validates the core polyglot promise
