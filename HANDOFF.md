# Handoff

Current state and how to resume. Rolling doc — reflects the latest, not history (that's
`CHANGELOG.md`). Updated after every task. All work is on `origin/main` (and `dev`) at the
latest commit unless a "Last task" note says otherwise.

## Last task
**Renamed `adapter-id-2` → `algo-instrumentation` and fixed it for the live HRMS format** (TDD).
The HRMS web app POSTs a **`{ events: [...] }` batch envelope** with `status_code` (snake_case)
and extra fields — the old adapter dropped the whole envelope (no top-level `eventId`) so nothing
rendered. The adapter now: unwraps `{ events: [...] }` (each element mapped independently); reads
`status_code` as well as `statusCode` (a 5xx with no `success` flag is now an error); and captures
`application.service`/`.version`, top-level `severity`/`message`, `tags.*`, and
`payload.memory_usage_mb` as searchable attributes. Module still lands on the lifeline as before
(`HRMS WEB APPLICATION (LOCAL).<module>`) — **no UI change and no HRMS change** (the adapter
absorbs the format). Renamed files (`packages/collector/src/adapters/algo-instrumentation.{ts,test.ts}`,
spec `adapters-hidden/algo-instrumentation.md`), the registry key / `ADAPTER=` value, and the
`algoInstrumentation` export. 3 new tests (**43 unit green** + typecheck clean); verified end to
end by POSTing a real HRMS batch through the `http` source → two `…LOCAL.<module>` lifelines with
duration/status/`status_code`/`memory_usage_mb`/`tags.route_type`. Docs: mapping in
`docs/integration-adapters.md`, spec refreshed in `adapters-hidden/algo-instrumentation.md`.
Known format limitation unchanged: no causality → arrows fan out from the synthetic `client`
lifeline (real nesting needs the emitter to add span/parent ids).

Prior task: **Added `adapter-id-2` + collector `http` source** (now the `algo-instrumentation`
adapter above) — the path-agnostic `SOURCE=http` receiver (`HTTP_PORT`, default 4320) so
`/v1/event/*` emitters can be repointed at the collector unchanged.

Prior task: **Added `./serve.sh`** — standalone server entry point (UI + ingest on :4319, builds UI on
first run, no testbed) for client machines pointing real apps at LiveProbe; referenced from
README/CLAUDE.md/integration guide. Context: the SkillzEngine client integration landed on
their `feat/live-probing` branch (optional `TRACING=1` OTel auto-instrumentation; see
`adapters-hidden/skillzengine-adapter.md` for status + verified findings, incl. Mongo v7
instrumentation working). Synced this session.

Prior task: **Fixed review finding #4: history retention + debounced writes** (TDD). `HistoryStore.prune`
drops day-partitions older than `RETENTION_DAYS` (env / `retentionDays` option; default **14**,
`0` disables) at startup + hourly, VACUUMing after deletions so the file shrinks — verified on
a real DB (901KB → 462KB + startup log). Ingest now *stages* the latest assembly per trace and
flushes on a timer (`historyFlushMs`, default 1500ms) or **before any /api read**, preserving
read-your-writes (the e2e seed contract) while killing the per-batch re-upsert amplification.
4 new tests — **30 unit + 15 e2e green**, typecheck clean. README env notes added; review doc
finding #4 marked FIXED; todo C checked. The dev DB is now bounded even with loadgen running.

Prior task: **Fixed review findings #1 and #2** (from `docs/implementation-review.md`), TDD both:
- **Ghost nodes for uninstrumented peers**: topology + sequence now draw `participant → peer`
  edges when the callee never reported a span (suppressed when it did — no double edges), new
  `externals` field on `Topology`/`Sequence`, dashed grey nodes/lifelines in the UI, dashed
  `classDef external` in the Mermaid flow export. Partial rollouts now show every observed call.
- **Collector RabbitMQ auto-reconnect**: `error`/`close` handled (previously an unhandled
  `error` crashed the process), exponential-backoff reconnect (1s→30s) re-runs the full setup;
  initial connect still fails fast. Runbook still recommends a supervisor.
Post-sync correction in the same session: **review finding #3 was wrong** — `EDGE_SEP` was a
literal NUL byte (rendered as a space by review tooling), so names with spaces were never
broken; the real defect was that the raw NUL made git/grep treat `trace-window.ts` as binary.
Now written as the `"\u0000"` escape (behavior unchanged, file is text). Review doc corrected.
Also fixed a **pre-existing e2e flake** (history→day rollup assertion raced the fetch; now
auto-retrying). **26 unit + 15 e2e green (e2e 3× consecutively), typecheck clean**; verified
live in a browser (dashed ghost node + lifeline screenshots against seeded traces on an
isolated `:4390` server, then torn down). Docs: `event-model.md`, `integration-adapters.md`,
review doc marked FIXED, `todo.md` items checked.

Prior task: **Renamed dev scripts**: `dev.sh` → `dev-start.sh`, `stop.sh` → `dev-stop.sh` (git mv). All
current-state docs and self-references updated; historical logs left as written. No behavior change.

Prior task: **Implementation review + dev fix.** Wrote `docs/implementation-review.md` — a review of the
whole ingest path and the zero-instrumentation story (React / Node / Elixir). Top findings:
(1) non-datastore peers never render, so calls to not-yet-instrumented services are invisible
(the partial-rollout blind spot); (2) the RabbitMQ source crashes on connection errors (no
handler/reconnect); (3) `EDGE_SEP=" "` breaks service names with spaces; (4) per-batch trace
re-upsert amplifies SQLite writes (likely the old 555MB). Backlog items added to `todo.md`
(A/C/D/E); `docs/README.md` index updated (and its stale "not built yet" adapter line fixed).
Also fixed `dev-start.sh` failing with "network … not found": recreated the stale `loadgen`
container (see Gotchas) — **loadgen is now RUNNING** (traffic flowing). Docs only, no code.

Prior task: Docs: folded a **"Database tracing (and its intrusion floor)"** subsection into Recipe E of
`docs/integrating-your-app.md` — DB spans must originate in the app process (Postgres renders as a
datastore peer, nothing on the DB); three intrusion tiers (Node `--require` preload = no source
change; Elixir Ecto = two-line setup, no BEAM preload; eBPF/Beyla = zero app change); what doesn't
work (query logs/proxies lack trace ids); adapter-path caveat. Docs only — no code, no tests.

Prior task: Collector: added an **opt-in bounded tap queue** — `QUEUE_MAX_LENGTH` (x-max-length, drop-head
= keep newest) and `QUEUE_MESSAGE_TTL_MS` (x-message-ttl) so a live tap can't back up unboundedly
while the collector is down. 2 new unit tests (19 total, typecheck green); verified on the live
testbed RabbitMQ (conflicting re-declare → PRECONDITION_FAILED proves the args reached the broker).
Documented in `docs/integration-adapters.md`.

Prior task: Collector: made the RabbitMQ **fanout tap turnkey**. `rabbitmqSource` now supports `EXCHANGE` /
`EXCHANGE_TYPE` / `ROUTING_KEY` env — declares (with a type) or passively verifies the exchange,
asserts the queue, and binds it on startup, so tapping an existing stream is pure config (no
manual RabbitMQ admin). Source is injectable (`opts.connect`) for tests; added 4 unit tests via a
fake connection (17 total, typecheck green) and verified end-to-end against the live testbed
RabbitMQ. Updated `docs/integration-adapters.md` (runbook + Source notes + examples).

Prior task: Docs: added a **non-intrusive rollout runbook** to `docs/integration-adapters.md` for onboarding
an existing production estate — N polyglot apps (React+Node+Postgres, Elixir/Phoenix+Ecto, …)
across mixed hosting (VPS/GCP) that already emit `adapter-id-1` to a shared RabbitMQ. Covers:
tap-don't-divert, RabbitMQ fanout-copy vs stdout-tee (with competing-consumer warning), one
collector per client (not per app), where to run it, what renders vs. what's limited for the
event-centric format (no latency/kind), and best-effort delivery caveats. Corrected the "Source
notes" to match the code (no exchange bind; not durable). Cross-linked from Recipe D in
`docs/integrating-your-app.md`. Docs only — no code, no tests.

Prior task: Docs tidy: moved the planning specs `plan.md` + `plan-testbed.md` into `docs/` (they're
read-mostly design/contract specs, sitting alongside `architecture.md` etc.) and re-linked them
in `README.md`, `CLAUDE.md`, and `docs/README.md`. The rolling-state/audit docs (`HANDOFF.md`,
`todo.md`, `IMPLEMENT.md`, `CHANGELOG.md`) stay at the repo root — LOOPS rule XXV pins
IMPLEMENT.md there and CLAUDE.md pins HANDOFF there. No code, no tests affected.

Prior task: UI: added a **light/dark theme toggle** (header ☀/☾ button; `data-theme` on `<html>` drives a
second contrast-checked palette in `styles.css`; persisted to localStorage, applied pre-paint via
an inline script in `index.html`; `lib/theme.ts`) and **fixed the History trends-chart labels**
that rendered black-on-dark (`.axis`/`.axis-label` were scoped to `.latency-chart` only → promoted
to global). Diagram export bg now follows the active theme (`lib/export-diagram.ts`). Verified in
a headless browser against the running dev server; **14 e2e** (added 2) + 13 unit + typecheck green.

Prior task: wrote `docs/integrating-your-app.md` — the general integration guide (how any app,
dockerized or not, emits into LiveProbe): the OTLP/**JSON-only** ingest fact, when a collector is
needed, and recipes A–E (dockerized / bare process / browser / custom-format / **VPS-no-Docker for
React + Node/Go/Elixir**), plus a field-mapping table and a curl smoke test. Linked from
`docs/README.md`.

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
LiveProbe is a mature working app, verified end to end against the live testbed. **40 unit tests
+ 15 e2e pass**, typecheck clean, UI verified in a headless browser. Nothing known broken.

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
- **Client integration**: `packages/collector` (stdin/rabbitmq/http → adapter → `/v1/events`);
  adapters: `adapter-id-1`, `algo-instrumentation` (instrumentation-service format), `liveprobe-native`.
- **Testbed** (`testbed/`): 8-service e-commerce + workers over Postgres/Redis/RabbitMQ,
  OTel-instrumented; collector fans OTLP to Jaeger + LiveProbe. Loadgen currently **stopped**
  (2026-07-05; services still up — `docker compose start loadgen` to resume traffic); history
  DB is **bounded**: `RETENTION_DAYS` (default 14) prunes + VACUUMs at startup and hourly.

## How to run / verify
```bash
./dev-start.sh              # hot reload; open http://localhost:5173  (API/ws on :4319)
./dev-start.sh --static     # build + serve the UI from the server at http://localhost:4319
npm test              # core + server + collector tests (40)
npm run test:e2e      # Playwright UI e2e (15); first run: npx playwright install chromium
./dev-stop.sh             # tear down (--wipe drops data)
# feed a non-OTLP client: cat events.ndjson | SOURCE=stdin ADAPTER=adapter-id-1 \
#   LIVEPROBE_URL=http://localhost:4319 npx tsx packages/collector/src/index.ts
# HTTP-pushing client (instrumentation-service format): SOURCE=http ADAPTER=algo-instrumentation \
#   HTTP_PORT=4320 LIVEPROBE_URL=http://localhost:4319 npx tsx packages/collector/src/index.ts
```
Details/ports: `README.md`. Jaeger at http://localhost:16687. Sample login `alice@shopwave.test` /
`password123`. Traffic: `cd testbed && docker compose start loadgen`.

## Next (backlog — see `todo.md`)
- **UI tests** (M) — the UI has many pages and no automated tests yet.
- **Python testbed service** (M) — prove polyglot-via-OTLP renders identically.
- **Collector follow-ups** — wire a real client's RabbitMQ queue, more adapters (`http` source: done).
- **Smaller**: D2 export; side-by-side waterfalls in `/compare`.

## Gotchas
- **Stale-network containers after the compose network is recreated**: if `dev-start.sh` dies with
  `network <id> not found` on `loadgen`/`frontend`, those *stopped* profile containers still
  reference a deleted `shopwave_default` network id (compose starts, not recreates, existing
  stopped containers). Fix: `cd testbed && docker compose -f docker-compose.yml -f
  docker-compose.dev.yml --profile load up -d --force-recreate loadgen` (same idea with
  `--profile ui … frontend`). As of 2026-07-02 `frontend` still holds a stale reference —
  force-recreate it before next use.
- **Git flow**: work on `dev`; the word **"sync"** = commit → push dev → fast-forward `main` →
  push main → back to dev. Don't commit/push between syncs. Check the branch before pushing.
- **Stray servers on :4319**: only run ONE LiveProbe server against `packages/server/data`. A
  `dev-start.sh --watch` server may not always reload on a server-code change — restart `./dev-start.sh`, and
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
- **Client-private material** lives in `adapters-hidden/` (gitignored): the client format spec
  (`adapter-id-1.md`) and per-client integration notes (`skillzengine-adapter.md` — OTel/ESM
  `--import` recipe for the Remix app, its caveats, and the granularity Q&A). Only a generic
  reference adapter lives in the repo.
