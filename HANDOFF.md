# Handoff

Current state and how to resume. Rolling doc — reflects the latest, not history (that's
`CHANGELOG.md`). Updated after every task.

## Last task
Built + verified **four features in one shot** (browser-verified at :5173):
1. **Tighter flow layout** — barycenter ordering (crossing reduction) + tighter spacing in
   `lib/layout.ts`.
2. **Export diagrams** — `lib/export-diagram.ts` (inlines computed styles → standalone SVG/PNG);
   flow view has copy-Mermaid / SVG / PNG buttons, trace page has copy-Mermaid for the sequence.
   (D2 export not done — Mermaid only.)
3. **Multi-day trends** — `components/trends-chart.tsx` on `/history` (requests/day bars, errors red).
4. **Trace compare** — `/compare?a=&b=` page: two summary heads + operation-level timing diff
   (A vs B vs Δ, color-coded); "compare ⇄" link added to the trace page.
10 tests pass, UI builds, no page errors. Synced.

## Earlier task
Built + verified **filter the live view** (UI-only; uncommitted, awaiting "sync"): a service
dropdown on the Live page (`filterService` in the store) — the trace feed shows only traces whose
`services` include it, and the flow graph shows the subgraph (that service + direct neighbors +
touching edges). Verified: filter=cart → 5-node subgraph, feed 175→93, no errors.

## Earlier task
Built + verified **search by span attribute** (uncommitted, awaiting "sync"): each trace stores a
compact `attrs_text` (distinct `key=value` pairs across its spans); search gained an `attr` filter
(`http.status_code=500` precise, or a bare value) — server `history-store.ts` + `/api/search`, UI
search page field. Verified discrimination (rabbitmq → only checkouts; nonexistent → 0).
Also: **cleaned the history DB (555MB → 28KB)** via DELETE+VACUUM, and killed a stale duplicate
LiveProbe server I'd left on :4319 (it was serving old code / blocking the watch server). Note:
attribute search only matches traces ingested *after* the attrs_text change (older rows: NULL).

## Earlier task
Built and verified **three UI/dashboard features** (browser-verified at :5173 against live data):
1. **Error explorer** (`/errors`) — errored traces grouped by endpoint + error label, each links to
   its trace. Server: `error_label` column + `errorGroups()` + `GET /api/errors`.
2. **Clickable service → service page** (`/service/:name`) — click a flow node → deps (in/out),
   error rate, spans, top operations. Server: `serviceDetail()` (live window) + `GET /api/service/:name`.
3. **Latency-over-time** — on the day page, click a top endpoint → p50/p95/p99 line chart. Server:
   `endpointLatency()` + `GET /api/day/:date/latency?endpoint=`.
Also: waterfall now auto-selects the failing span. **Bugfix:** an old historical trace (no
`spans`) crashed `WaterfallView` (`spans.find` on undefined), which unmounted the whole app —
blanking the trace page and the Errors page until reload. Fixed by defaulting `spans` to `[]`
and adding a route-keyed `ErrorBoundary` so one view crash can't take down the app. 10 tests
pass, UI builds. **Uncommitted — awaiting review + "sync".** (Prior task: span waterfall.)

## Current state
LiveProbe is a working MVP, end to end, verified against the live testbed.

- **LiveProbe** (`packages/`): OTLP ingest → in-memory window + SQLite history → REST + ws →
  React UI. Views: live flow (zoom-to-fit) + trace list, dedicated trace page, daily dashboard
  (`/history`, `/day/:date`), and search (`/search` + header box). Pause control on the feed.
- **Testbed** (`testbed/`): 8-service e-commerce (gateway, auth, catalog, cart, order +
  payment/inventory/notification workers) over Postgres/Redis/RabbitMQ, OTel-instrumented; a
  checkout is one connected trace across all of it. Collector fans OTLP to Jaeger + LiveProbe.
- **Tests**: 10 (core + server) pass; typecheck clean. UI verified in a headless browser.
- Nothing known broken.

## How to run / verify
```bash
./dev.sh              # hot reload; open http://localhost:5173  (API/ws on :4319)
./dev.sh --static     # build + serve the UI from the server at http://localhost:4319
npm test              # core + server tests
./stop.sh             # tear down (--wipe drops data)
```
Ports and details: `README.md`. Jaeger (reference) at http://localhost:16687. Sample login:
`alice@shopwave.test` / `password123`.

## Next
**In progress (continuing later): client integration via adapters.** Design is written up in
`docs/integration-adapters.md` — read it first. Summary: client apps (polyglot) emit a
client-specific instrumentation format over a transport (client-1 → RabbitMQ, another →
stdout). Plan is a collector with pluggable **sources** (rabbitmq / stdout / http) × **adapters**
(per client format, e.g. `adapter-id-1`) that map `raw → Event[]` and POST to a new native
`/v1/events` ingest. MVP to build: (1) `POST /v1/events`, (2) collector with rabbitmq + stdout
sources, (3) `adapter-id-1` mapping, (4) verify end to end. Open questions listed in that doc
(message granularity, sidecar vs single collector, whether to include per-span duration in v1).

Other backlog (see `todo.md`): span waterfall + attribute drill-down on the trace page;
clickable service nodes → a service page; search by span attribute.

## Gotchas
- **ioredis / amqplib** in the testbed are loaded via `createRequire` because OTel only hooks
  the CommonJS require path, not ESM import — otherwise their spans vanish.
- **OTLP ingest is gzip-aware**: the `otlphttp` exporter compresses by default; the server
  gunzips. Don't remove that.
- **T5 wiring**: the collector reaches the host via `host.docker.internal` (host-gateway added
  to the collector). LiveProbe runs on the host, testbed in Docker — kept decoupled.
- **Host ports** use a private range (55432/56379/55672/15673/16687/24317-8) to avoid clashing
  with other stacks on the machine.
- **Two SQLite writers**: only run one LiveProbe server against `packages/server/data`.
