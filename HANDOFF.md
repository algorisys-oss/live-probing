# Handoff

Current state and how to resume. Rolling doc — reflects the latest, not history (that's
`CHANGELOG.md`). Updated after every task. All work is on `origin/main` (and `dev`) at the
latest commit unless a "Last task" note says otherwise.

## Last task
Wrote `docs/integrating-your-app.md` — the general integration guide (how any app, dockerized
or not, emits into LiveProbe): the OTLP/**JSON-only** ingest fact, when a collector is needed,
and recipes for dockerized (Shopwave pattern) / bare process / browser / custom-format apps,
plus a field-mapping table and a curl smoke test. Linked from `docs/README.md`. Docs only — no
code, no tests affected. (Uncommitted on `dev`.)

Prior task: added a **Playwright e2e suite** (`e2e/`, 11 specs) covering the live dashboard (feed + flow +
error flag + pause), the trace page (waterfall + sequence tab + back link), search (endpoint +
span attribute), errors, and history→day. Deterministic fixtures seeded via `POST /v1/events`
(`e2e/seed.ts`); `playwright.config.ts` webServer builds the UI and serves it from the server on an
isolated port (`:4399`) + temp DB — **no docker/testbed needed**. `npm run test:e2e` (11 pass),
unit `npm test` (13) + typecheck still green. Also fixed the UI's hardcoded API base: it now
uses `window.location.origin` in prod (falls back to `:4319` only in the Vite dev server), so a
static deploy on any port works — and the e2e no longer needs a build-time URL override. And
surfaced the **app version** in the header (status bar): root `package.json` (**0.1.0**) is the
single source, injected as `__APP_VERSION__` via `vite.config.ts`; e2e now 12.

Prior task: `examples/otel-react-go/` — OTel integration reference for a React + Go app (Go→collector
`encoding:json`→LiveProbe; React→LiveProbe direct). Synced (`d998250`).

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
npm run test:e2e      # Playwright UI e2e (11); first run: npx playwright install chromium
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
- **UI API base is now origin-relative**: the built UI uses `VITE_LIVEPROBE_URL ?? window.location.origin`
  (prod) and only falls back to `http://localhost:4319` in the Vite dev server. So a static deploy on
  any port just works — nothing hardcoded. (`packages/ui/src/lib/api.ts`.)
- **e2e**: runs on an isolated `:4399` + `.e2e-data/` (both separate from dev); the browser hits its
  own origin, no build-time URL override needed. First run needs `npx playwright install chromium`.
  Don't prefix test runs with `pkill` in this environment — it can nuke the session.
- **Client format spec** is private in `adapters-hidden/` (gitignored); only a generic reference
  adapter lives in the repo.
