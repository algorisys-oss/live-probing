# Handoff

Current state and how to resume. Rolling doc — reflects the latest, not history (that's
`CHANGELOG.md`). Updated after every task. All work is on `origin/main` (and `dev`) at the
latest commit unless a "Last task" note says otherwise.

## Last task
Added **`examples/otel-react-go/`** — a reference integration for a greenfield React + Go app via
OpenTelemetry (docs/snippets, no product code touched). Key fact it captures: LiveProbe ingest is
**OTLP/JSON**, so the Go side (protobuf exporter) must route through an **OTel Collector** with
`encoding: json` (mirrors `testbed/otel/collector-config.yaml`), while React's browser exporter is
already JSON and posts straight to `/v1/traces`. Includes `telemetry.go` + `main.go` (net/http +
`otelhttp` + pgx/`otelpgx`), `otel-collector.yaml`, and `tracing.ts` (fetch/XHR auto-instrument +
W3C propagation for one connected trace). Not yet committed/synced.

Prior task: client-integration MVP (adapter layer): native `POST /v1/events` ingest (`coerceEvents`
in `@liveprobe/core`), a **collector** (`packages/collector`) with `stdin`/`rabbitmq` sources +
adapter registry + batching sink, and reference **`adapter-id-1`**. Synced (`127b6c4`).

## Current state
LiveProbe is a mature working app, verified end to end against the live testbed. **13 tests pass**,
typecheck clean, UI verified in a headless browser. Nothing known broken.

- **Ingest**: OTLP (`POST /v1/traces`, gzip-aware) **and** native (`POST /v1/events`) → one
  in-memory `TraceWindow` + SQLite history (`node:sqlite`, partitioned by day).
- **Server API**: recent traces, trace detail (spans + sequence + Mermaid), topology, service
  detail, errors (grouped), day summary + endpoint latency, search, websocket deltas.
- **UI** (React + zustand + react-router), all built + verified:
  - Live: flow graph (barycenter layout, zoom-to-fit/pan, click a node → service page, export
    SVG/PNG/Mermaid) + trace feed, **Pause**, **filter by service** (feed + subgraph).
  - Trace page: **waterfall** (+ click a span → attributes) / **sequence** tabs, copy-Mermaid,
    **compare ⇄** link.
  - `/service/:name`, `/errors`, `/search` (endpoint / service / **span attribute** / latency /
    sort), `/history` (**multi-day trends**) + `/day/:date` (rollups, throughput, **latency-over-
    time**, slowest), `/compare?a=&b=` (operation timing diff). Route-keyed `ErrorBoundary`.
- **Client integration**: `packages/collector` (stdin/rabbitmq → adapter → `/v1/events`).
- **Testbed** (`testbed/`): 8-service e-commerce + workers over Postgres/Redis/RabbitMQ,
  OTel-instrumented; collector fans OTLP to Jaeger + LiveProbe. Loadgen currently **stopped**;
  history DB is **clean** (was reset from 555MB).

## How to run / verify
```bash
./dev.sh              # hot reload; open http://localhost:5173  (API/ws on :4319)
./dev.sh --static     # build + serve the UI from the server at http://localhost:4319
npm test              # core + server + collector tests (13)
./stop.sh             # tear down (--wipe drops data)
# feed a non-OTLP client: cat events.ndjson | SOURCE=stdin ADAPTER=adapter-id-1 \
#   LIVEPROBE_URL=http://localhost:4319 npx tsx packages/collector/src/index.ts
```
Details/ports: `README.md`. Jaeger at http://localhost:16687. Sample login `alice@shopwave.test` /
`password123`. Traffic: `cd testbed && docker compose start loadgen`.

## Next (backlog — see `todo.md`)
- **Retention / pruning** (S) — cap/prune the SQLite history so it stops regrowing (555MB before).
- **UI tests** (M) — the UI has many pages and no automated tests yet.
- **Python testbed service** (M) — prove polyglot-via-OTLP renders identically.
- **Collector follow-ups** — an `http` source, wire a real client's RabbitMQ queue, more adapters.
- **Smaller**: D2 export; side-by-side waterfalls in `/compare`.

## Gotchas
- **Git flow**: work on `dev`; the word **"sync"** = commit → push dev → fast-forward `main` →
  push main → back to dev. Don't commit/push between syncs. Check the branch before pushing.
- **Stray servers on :4319**: only run ONE LiveProbe server against `packages/server/data`. A
  `dev.sh --watch` server may not always reload on a server-code change — restart `./dev.sh`, and
  don't leave background `tsx packages/server/src/index.ts` instances around (use `DB_PATH` +
  a spare `PORT` to verify in isolation).
- **ioredis / amqplib** are loaded via `createRequire` (OTel only hooks CommonJS require, not ESM).
- **OTLP ingest is gzip-aware** (the `otlphttp` exporter compresses by default). Keep the gunzip.
- **Attribute search / waterfall** only cover traces ingested after those features shipped; the DB
  was reset, so that's effectively everything now.
- **Client format spec** is private in `adapters-hidden/` (gitignored); only a generic reference
  adapter lives in the repo.
