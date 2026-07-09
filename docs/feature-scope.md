# Feature scope — near-term backlog

Working scope for the next round of feature work. Effort scale: **S** ≈ half a day, **M** ≈ 1–2
days, **L** ≈ multi-day. Each item lists the data source / approach, the files it touches, and the
main risk, so it can be picked up cold and graded (LOOPS rule XXIX). Auth is deliberately deferred —
see [Deferred](#deferred).

Context: the three live-incident-triage features (health-colored topology, latency histogram +
heatmap, aggregate flamegraph) shipped 2026-07-09. Several items below build directly on the
`topologyHealth()` engine and the pure aggregators added for those.

## Group 1 — Live-view analytics (extends the triage track)

### 1a. Live RED tiles (p95) — **S–M** — ✅ DONE (2026-07-09)
- Shipped: `core/red-metrics.ts` (`redMetrics()`) → server computes on the topology WS tick →
  `red-tiles.tsx` strip above the live flow graph. Tiles colored by error-rate thresholds, click →
  service page. What follows is the original scope.
- **What:** a per-service Rate / Errors / Duration(p95) strip on the live view (and/or service page).
- **Approach:** compute from the in-memory `TraceWindow` in the server's `serviceDetail` (it already
  scans a service's spans); add p95. No history dependency — this is a *live* view.
- **Files:** `server/summary.ts` or `server.ts` (`serviceDetail`), new `ui/components/red-tiles.tsx`,
  `live-page.tsx` / `service-page.tsx`, CSS.
- **Risk:** low. p95 over a 5-min window is jumpy for low-traffic services — show call count alongside.

### 1b. Live-window distribution + flamegraph — **M**
- **What:** the histogram/heatmap and flamegraph currently read *history* (day page). Add a live
  variant sourced from the `TraceWindow` — "where is `POST /checkout` spending time *right now*."
- **Approach:** reuse the pure core aggregators (latency bucketing, `aggregateFlamegraph`) but feed
  spans from `window.assemble()` instead of SQLite. New live API routes.
- **Files:** `server.ts` (2 routes), a shared aggregation helper (lift from `history-store`),
  `service-page.tsx` wiring.
- **Risk:** medium — sparse for rare endpoints; needs a clear empty-state.

## Group 2 — Alerting (the active sequel to health-coloring)

### 2. Anomaly / alert hooks — **M–L** — ✅ DONE (2026-07-09)
- Shipped: `core/alert-rules.ts` (`evaluateAlerts()`) → server evaluates on the topology WS tick,
  tracks `since`, pushes active alerts → `/alerts` page + a nav count badge. Error-rate alerts on
  services, latency alerts on edges (2× median).
- Webhook (this commit): `server/alert-webhook.ts` (`createWebhookNotifier`) — POSTs one JSON body
  per inactive→active transition with a per-attempt timeout, exponential-backoff retries, and a
  per-alert-id cooldown (de-dup). Env: `ALERT_WEBHOOK_URL` (+ `_TIMEOUT_MS` / `_RETRIES` /
  `_COOLDOWN_MS`); unset = off. 8 tests (7 delivery + 1 server transition-fire).
- **What:** threshold rules (error-rate > X%, or p95 > Y, per service/edge) → a live banner in the UI
  **and** an optional outbound webhook.
- **Approach:** evaluate rules server-side on each topology tick — reuse `topologyHealth` thresholds
  as the rule engine; push `alert` deltas over the existing WebSocket; POST to a configured webhook.
  Config via env / `.env`.
- **Files:** new `core/alert-rules.ts` (pure, TDD), `server.ts` (evaluate + broadcast + webhook fire
  with de-dup/cooldown), UI banner + an `/alerts` view, `use-live-store` alert state.
- **Risk:** medium–high — needs de-duplication/cooldown (don't spam) and outward-facing webhook
  delivery (timeout, retry/backoff). Biggest single item here.

## Group 3 — Diagnostics visualizations

### 3a. Error-rate timeline — **S–M**
- **What:** a time series of error rate with click-through to sample traces, on the errors page.
- **Approach:** the day store already has per-minute error counts (`daySummary.throughput`); render a
  hand-rolled SVG timeline.
- **Files:** new `ui/components/error-timeline.tsx`, `errors-page.tsx`, minor server rollup.
- **Risk:** low.

### 3b. Dependency matrix — **M** — ✅ DONE (2026-07-09)
- **What:** a services × services adjacency heatmap (cell = calls / error-rate / latency) — scales
  better than the node-link graph for many services.
- **Shipped:** pure `ui/lib/dependency-matrix.ts` (`dependencyMatrix()` — rows=callers, cols=callees,
  cell health reuses `topologyHealth`; 6 tests) → `ui/components/dependency-matrix.tsx` (hand-rolled
  SVG grid, rotated callee headers, calls/errors/latency metric toggle, color=health / opacity=
  traffic, header+cell click → service page). A **Graph | Matrix** toggle on the live view swaps the
  two projections (both honor the service filter). No server change.
- **Files:** `ui/lib/dependency-matrix.ts` (+ test), `ui/components/dependency-matrix.tsx`,
  `pages/live-page.tsx` toggle, `styles.css`.

### 3c. Small viz backlog — **S each**
- D2 export (sibling of the existing Mermaid export); side-by-side waterfalls in `/compare`. Cheap,
  low value-per-novelty.

## Group 4 — Testbed realism (proves claims, strengthens demos)

### 4a. Python (or Go) testbed service — **M**
- Proves the polyglot-via-OTLP MVP claim; renders identically through the collector. Touches
  `testbed/` + compose only, not LiveProbe core.

### 4b. More failure modes — **M** — ✅ DONE (2026-07-09)
- Timeouts, retries, circuit-breaking, a slow dependency — makes the health/alert features demo-able
  with real red/amber. `testbed/` only.
- **Shipped:** two shared modules (env-gated, default off) — `chaos.ts` (`applyFault` — latency +
  error injection) and `resilient.ts` (`resilientFetch` — per-attempt timeout, backoff retries,
  per-host circuit breaker); 22 tests. Faults injected in catalog (slow reads) + order (flaky
  `POST /orders`); resilience wraps cart→{catalog,order} and gateway→downstream. `docker-compose.chaos.yml`
  is a curated scenario, `./dev-start.sh --chaos` turns it on. Verified live: order error alert +
  latency alerts fire, `cart→order` goes red, catalog p95 ~1.5s.

## Group 5 — Packaging / adoption

### 5a. `npx liveprobe` CLI + publish core/server — **M**
- The adoption unlock: a bin entry, config surface, and an npm publish flow.

### 5b. Native SDK (`packages/sdk-js`) — **L**
- Drop-in tracer to use LiveProbe without OpenTelemetry. Largest item; a Phase-2 goal.

## Summary + recommended order

| #  | Feature                         | Effort | Depends on   | Triage value |
| -- | ------------------------------- | ------ | ------------ | ------------ |
| 1a | Live RED tiles (p95)            | S–M    | —            | High         |
| 3b | Dependency matrix               | M      | #1 health    | High         |
| 2  | Alerting / anomaly hooks        | M–L    | #1 health    | Highest      |
| 1b | Live distribution + flamegraph  | M      | #2 / #3      | Med–High     |
| 3a | Error-rate timeline             | S–M    | —            | Med          |
| 4b | Testbed failure modes           | M      | —            | Med (demo)   |
| 4a | Python/Go testbed service       | M      | —            | Med (proof)  |
| 5a | `npx liveprobe` CLI             | M      | —            | Med (adoption)|
| 3c | D2 export / compare waterfalls  | S      | —            | Low          |
| 5b | Native SDK                      | L      | —            | Med (Phase 2)|

**Suggested path:** **1a (RED tiles)** first — small, high-value, completes the live-triage surface —
then **3b (dependency matrix)** and **2 (alerting)**, which both build on the `topologyHealth` engine.
A coherent "make the live view a real incident console" arc.

## Deferred

- **Built-in API auth (+ tighten CORS)** — `todo.md` E. Deferred by decision on 2026-07-09 (features
  first). Would let the deployed instance drop the nginx `auth_basic off` workaround on `/ws` (a
  browser can't authenticate a WebSocket handshake) by validating a shared token on the WS upgrade
  and `/api`. Revisit after the feature round.
