# Changelog

Timestamped functional changes (LOOPS rule XXIV). Newest first.

## [2026-07-09]
- **UI: health-colored live topology (feature 1/3, TDD).** The flow graph now traffic-lights nodes and
  edges from the live call counts it already carries — red at ≥5% error rate, amber at ≥1% or when an
  edge's latency is ≥2× the graph's median (relative, so it adapts to the system's normal). A node is
  colored by the calls *into* it, pointing at the failing/slow dependency rather than lighting up every
  caller. New pure `packages/ui/src/lib/topology-health.ts` (`topologyHealth()`, tunable thresholds),
  8 unit tests; wired into `flow-view.tsx` (edge/arrow/node classes + a bottom-left legend) with new
  CSS reusing `--error`/`--new` so it stays theme-aware. Hand-rolled SVG, no new deps. Also excluded
  `*.test.ts` from the UI's `tsc -b` build (tests run via the root tsx runner). Verified against seeded
  mixed-health data in headless Chromium (red order edge+node, amber reports edge+node, healthy rest,
  legend present, 0 overflow) and the live testbed's slow gateway edges.
- **UI: responsive layout now handles landscape too.** The earlier breakpoints were width-only, so a
  phone in landscape (wide but ~400px tall) got the stacked layout that split its scarce height into
  slivers. Added a `@media (max-height: 500px) and (orientation: landscape)` rule that reclaims the
  vertical axis: the live view goes back to feed-beside-graph, the trace page puts the detail panel
  beside the waterfall, and the header collapses to one tight row (counters/version hidden). The
  height cutoff targets landscape phones without catching tablets (which stay tall enough for the
  portrait layouts). Verified in headless Chromium across phone/tablet × portrait/landscape (12
  combos): 0px horizontal overflow and the live view uses the correct orientation (stacked in
  portrait, side-by-side in landscape) in every one.
- **Docs: added `CONTRIBUTING.md`.** Writes down the branch/PR workflow the team just agreed to —
  work on `dev`, `main` only ever fast-forwards to `dev` (the `sync` flow), never commit directly to
  `main` — plus how to reconcile if `main` diverges, a recommendation to branch-protect `main`,
  pre-push checks (test/typecheck/e2e + verify behavior), the load-bearing LOOPS rules, and which
  tracking doc updates with each change. Linked from the README working-docs list.
- **Deploy: `scripts/deploy.js` can optionally ship a local `.env`.** Previously it uploaded the image
  + rewritten compose but never the `.env`, so `CORS_ORIGINS`/`RETENTION_DAYS`/`HOST`/etc. had to be
  created on the server by hand. It now offers to upload a local `.env` — but only when one exists,
  defaulting to No and warning that it **overwrites** the remote `.env` (which may hold prod config).
  Uploaded alongside the compose file via the same multiplexed SSH session. README deploy section +
  prompt table updated. No behavior change when no local `.env` is present.
- **UI: mobile/tablet responsive pass (CSS only).** The app had no breakpoints — the fixed two-column
  live view, the 52px single-row header, the fixed 320px trace-detail panel, and unwrapped tables all
  overflowed on narrow screens. Added two `@media` breakpoints in `packages/ui/src/styles.css`: at
  ≤900px the header wraps to rows, the live view stacks the trace feed (capped 45vh) above the flow
  graph, and wide tables/toolbars scroll/wrap within the page; at ≤560px the trace page stacks the
  waterfall/sequence over the span-detail panel, gutters tighten, the version chip hides, tap targets
  grow to ≥34px, and `.app` uses `100dvh`. No component/JS changes. Verified in headless Chromium at
  390px and 820px across live/trace/errors/history: 0px horizontal overflow on all 8, layouts confirmed
  by screenshot.
- **Fix: algo-instrumentation adapter back-dates the request span to its start (TDD).** An HRMS
  `instrumentation` event is logged at request *completion*, so its `timestamp` is the end, while the
  `spans[]` children carry earlier starts. Stamping the synthetic `client` root and the handler span
  at `timestamp` made the `client → handler` entry arrow sort *after* the child arrows, so the
  sequence view seeded the leftmost lifeline with a db/redis call and pushed `client` to the far
  right. The adapter now anchors both at `timestamp − duration` (the real request start) when a
  duration is known — restoring parent-before-child order (client goes left) and fixing activation-bar
  nesting. Verified end to end: an HRMS-shaped `register-employee` event now yields participant order
  `[client, HRMS…, redis, database]`. 2 new tests + one updated assertion (79 green), typecheck clean.
  Adapter-only — no HRMS change.
- **Docs: reverse-proxy (TLS + basic auth) deployment recipe.** Running LiveProbe behind nginx broke
  the live WebSocket two ways: the server's origin check (from the hardening commit) refuses a WS
  upgrade whose `Origin` isn't loopback or in `CORS_ORIGINS`, and basic auth on the `/ws` location
  makes the handshake fail and re-prompt on every route change (a browser can't authenticate a WS
  handshake). Added a "Behind a reverse proxy" section to the README (exact-origin `CORS_ORIGINS`,
  `HOST=0.0.0.0`, an nginx block that proxies the WS upgrade and keeps `auth_basic off` on `/ws`),
  surfaced `HOST`/`CORS_ORIGINS`/`MASK_PII` in the env tables, added two troubleshooting rows, and
  corrected the stale "CORS is `*`" claim in `docs/integrating-your-app.md`. Docs only — no code
  change; `HOST` and `CORS_ORIGINS` already exist from the hardening commit.
- **Docs: revised `LOOPS.md` — tightened, de-drifted, made project-agnostic (new or migration).**
  Kept every rule numeral (so `CLAUDE.md`'s references stay valid) and reworded in place. Reframed
  three rules that fought a git workflow: XXIII (backup files → "stay recoverable" via VCS), XXVI
  (per-response session-tracker footer → one rolling handoff doc, matching `HANDOFF.md`), XII (dropped
  the arbitrary 80% coverage floor for "every breakable behavior has a failing-without-the-change
  test"). Folded in migration lessons from the Bun Zig→Rust port: XXXVI gained a migration-strategy
  block (complete-over-half-incremental, de-risk on a few files, write the idiom mapping down,
  compiler-errors-as-work-queue, isolate parallel worktrees) and XXXVII gained "count what you skip —
  no silent test deletions." Intro notes it applies greenfield or migration.
- **Fix: containerized deploy — collector couldn't reach the server (`ingest failed: fetch failed`).**
  The `liveprobe` service in `docker-compose.yml` didn't set `HOST`, so the server bound `127.0.0.1`
  inside its container. Sibling containers (`collector`, `otel-collector`) target `http://liveprobe:4319`
  and the published host port both hit the container's eth0/NAT, which a loopback-only listener refuses
  — only the in-container healthcheck (its own loopback) passed, so the container reported Healthy while
  ingest was dead. Added `HOST: "0.0.0.0"` to the `liveprobe` service. Same root cause as the dev-start
  fix below; the server's loopback default is unchanged.
- **Fix: testbed traces stopped landing after the ingest-hardening commit.** That commit changed the
  server's default bind to `127.0.0.1`, but the dockerized testbed collector reaches LiveProbe on the
  host via `host.docker.internal:4319` (host-gateway) — traffic that arrives on the Docker bridge and
  a loopback-only socket refuses. `dev-start.sh` now sets `HOST=0.0.0.0` (overridable) on both server
  invocations so local dev exposes the ingest port to the bridge, as before. No server-code change;
  the loopback default stands for non-dev deployments.

## [2026-07-08]
- **Security hardening of the ingest server (review-driven, TDD).** Fixed five issues found by a
  critical review and reproduced end-to-end against the Shopwave testbed:
  - *Remote crash (Critical):* an out-of-range `startTime` (e.g. `1e30`) threw `RangeError` in
    `dayOf()` inside the history-flush timer → process exit. Added `clampMicros()` at both ingest
    paths (`core/native.ts`, `core/otlp.ts`), made `dayOf()` non-throwing (`history-store.ts`), and
    wrapped `flushHistory()`'s `upsertMany` in try/catch (`server.ts`).
  - *Live-view eviction:* a far-future `startTime` became the window clock and evicted recent
    traces; `clampMicros` now caps start times at `now + 60s` (`startTimeCeiling()`).
  - *PII/secret masking wired in:* `ingestEvents()` now runs `maskEvents()` on every event before
    buffering/persisting/broadcasting (the helper was previously dead code). `MASK_PII=off` opts out.
  - *Resource limits:* 8 MB request-body cap (413) and 32 MB gzip-decompression cap (zip-bomb guard).
  - *Network posture:* default bind `127.0.0.1` (`HOST=0.0.0.0` to expose); CORS/WebSocket restricted
    to loopback origins (or `CORS_ORIGINS`) instead of `*`; errors no longer echo internal messages.
  - Tests: +5 server, +1 core (77 total green); typecheck clean.
- **Retention default raised 14 → 30 days; live-window knobs now env-configurable.**
  `RETENTION_DAYS` now defaults to 30 UTC days (`server.ts`), so a single trace's waterfall/sequence
  view stays viewable by id for 30 days after it ages out of the live in-memory window. Wired two
  previously code-only `ServerOptions` to env vars in the entrypoint (`index.ts`):
  `LIVE_WINDOW_MINUTES` (→ `horizonMicros`, default 5 — the real-time streaming window) and
  `MAX_TRACES` (→ `maxTraces`, default 2000 — live in-memory cap), via a shared validating
  `numEnv()` helper (finite, in-range, else fall back to the default). All three are now
  `.env`/shell-configurable; `RETENTION_DAYS=0` disables pruning. Docs synced (README env tables +
  sample `.env`, index/server comments, implementation-review, skillzengine adapter). Typecheck +
  server tests green.
- **Docs: `docs/pii-masking.md`** — reference for the masking helper (API, the two-layer
  key-based + value-based strategy, the Luhn-guarded card rule, usage as an allow-list backstop,
  and limitations). Linked from the `integration-adapters.md` PII section.
- **Shared `maskPii()` PII/secret masking helper (core, TDD).** New pure module
  `packages/core/src/mask.ts` exporting `maskPii(event, opts?)`, `maskEvents(events, opts?)`, and
  `maskString(value)`, exported from `@liveprobe/core`. Two conservative layers: (1) key-based —
  attribute keys whose name signals a secret/PII (`password`, `api_key`, `authorization`, `cvv`,
  `*.email`, …) have their value replaced wholesale (string/number/boolean); (2) value-based — any
  string (attribute value, `operation`, `peer`, `participant`) is scanned for embedded emails,
  bearer tokens, and **Luhn-valid** card numbers and redacted inline (Luhn check avoids redacting
  ordinary long digit runs like order ids). Options: `placeholder`, extra `redactKeys`,
  `maskIdentityFields`. Never mutates its input. Intended as a backstop after a per-client
  allow-list — adapters call `maskEvents(...)` before returning. 11 new tests; `docs/
  integration-adapters.md` PII section points at it. Not yet wired into the existing adapters
  (opt-in per client, to avoid changing verified output).

## [2026-07-07]
- **Sequence view: collapse repeated sibling spans into a ×N group.** A run of ≥3 repeated *leaf*
  sibling calls with the same signature (`from→to · operation · async`) — the shape an N+1 query or
  hot loop makes — now folds into one collapsed row instead of a long staircase. The fold *names*
  the problem rather than hiding it: it shows `×N`, the aggregate `Σ<total>` timing, whether the run
  was **sequential** (N+1 shape) or **concurrent** (fan-out), a `⚠` on a sequential run of ≥5, and
  `· N err` if any member errored (errors are never folded away). Click a fold (or its activation
  bar) to expand it; a `<title>` tooltip carries the full count/timing/error breakdown.
  - **Core (`packages/core/src/sequence-layout.ts`, TDD):** `sequenceLayout(sequence, expanded?)`
    detects groups (new exported `SequenceGroup`). Leaf-only — a call that strictly contains another
    is a parent and is never folded, so nesting is preserved. Buckets by signature within each
    contiguous leaf run (an interleaved dept/emp cluster ⇒ one group per signature). Collapsed by
    default; the optional `expanded` set opens specific groups. 7 new tests.
  - **UI:** browser mirror kept in sync (`packages/ui/src/lib/sequence-layout.ts`); `sequence-view.tsx`
    renders the ×N row, per-group expand/collapse (local state, reset per trace), and the aggregate
    badge; new CSS `.seq-msg-group` / `.seq-group-badge` / `.seq-activation-group` / `.seq-msg-n1`.
  - **61 unit green**, typecheck + UI build clean. Verified in a headless browser against a
    synthesized `GET /apply-leave` N+1 (interleaved `DepartmentLeaveOverride ×15` /
    `EmployeeLeaveOverride ×15`, one errored): 30-row staircase → 5 rows, both flagged `⚠`
    sequential, the errored fold shows `· 1 err`. Purely a view projection — the normalized event
    stream and Mermaid export are unchanged.
- **Waterfall: critical-path highlight, self-time shading, collapse/expand, span deep-links.**
  The remaining diagram followups. New pure core `criticalPath()` (`packages/core/src/
  critical-path.ts`) computes the chain that determines the trace's end time by sweeping
  backward from each node's end (last finisher on the path; spans that ran concurrently in a
  sibling's shadow are excluded) — unit tested, shipped as `TraceDetail.criticalPath`. The
  waterfall now: marks critical spans (◆ + accent bar outline + row accent); shades each bar's
  child-covered time ranges (hatched) so the solid remainder reads as **self-time**; lets you
  **collapse/expand** a span's subtree (chevron toggle + "+N hidden" count, DFS-order hiding);
  and syncs the selected span to a **`#spanId` URL hash** for shareable deep-links (trace page
  honors the hash on load). 1 new core test + 4 e2e (**54 unit + 22 e2e green**), typecheck + UI
  build clean; verified against a seeded nested trace — the redis cache that ran inside the DB
  call's window is correctly left off the critical path. Docs: `docs/live-views.md`.
- **Docker image hardening (follow-up review of the deployment PR).** Three fixes after building
  and running the image end to end:
  - **Runs as non-root.** Added `USER node` + `chown node:node /data` so the server and its SQLite
    volume run unprivileged (was root).
  - **Leaner runtime image.** Runtime `npm ci` now uses `--omit=dev` (drops vite/typescript/
    playwright) and re-adds only `tsx` (`npm install --no-save tsx@^4.19.2`).
  - **`deploy.js`: remote-dir hardening.** `remoteDir` is validated against a safe charset and
    single-quoted in the remote `cd`, closing a path-with-spaces bug / latent shell injection.
  - **Server fix exposed by non-root:** `packages/server/src/index.ts` created a *hardcoded*
    `packages/server/data` dir on boot even when `DB_PATH` pointed elsewhere (fine as root, EACCES
    as `node`). It now ensures the directory of the *actual* `dbPath` exists (skipping `:memory:`).
  Verified by building + running the image: boots as uid 1000, `/api/topology` 200, native ingest
  200, `/data/liveprobe.db` written node-owned, Docker healthcheck healthy. 53 unit + 18 e2e green.
- **Sequence view: activation bars + call/return arrows (UML).** The sequence tab was a flat
  list of one-way call arrows; it now renders a proper UML interaction. New pure core function
  `sequenceLayout()` (`packages/core/src/sequence-layout.ts`, mirrored browser-side in
  `packages/ui/src/lib/sequence-layout.ts`) turns the time-ordered messages into a bracketed
  call/return layout: each **synchronous** call gets an **activation bar** on the callee's
  lifeline (call row → return row), rows are bracketed so a parent's return lands after its
  children's, and overlapping activations on one lifeline get a depth-offset lane. The renderer
  draws the bars, **solid call arrows** (filled head), and **dashed reply arrows** (open/stick
  head) labelled with the call duration. Convention: **dashing = reply vs call; arrowhead =
  sync vs async** — async (producer/consumer) messages are solid with an open head and get no
  return or activation (fire-and-forget). Nesting is inferred from time containment (no
  parent-id dependency). Selection is preserved: clicking a bar or arrow still selects the span
  in the shared detail panel. 4 core unit tests + 1 e2e (**53 unit + 18 e2e green**), typecheck
  clean; verified visually against the live testbed (`POST /api/checkout`, 50 spans — nested
  gateway⊃auth⊃redis activations, dashed returns with µs labels). Docs: `docs/live-views.md`.
- **algo-instrumentation: stop dropping `spans[]` sent under `payload`, and never orphan a
  child (Gap C).** The adapter read child spans only from the top-level `spans` field, but the
  spec (and some emitters) nest them under `payload.spans` — those were silently dropped, so the
  request rendered as a flat 1-span trace with no internal fan-out (indistinguishable from an
  emitter that sent no children at all). It now accepts `spans[]` at **either** location, and a
  child arriving without a `parentSpanId` attaches to the request/handler span instead of
  becoming a second root. 2 new tests (**49 unit green**, typecheck clean); verified end to end
  through the collector `http` source (:4391 → server :4390): a `payload.spans[]` event produces
  `child-db` (peer `database`) + orphan `child-fn` both parented to the handler span. Adapter
  behaviour for real-nested `parentSpanId` is unchanged — it already honours whatever parent a
  child carries, so deeper trees render as soon as the emitter provides them (Gaps A/B are
  emitter-side). Docs: `docs/adapters/algo-instrumentation.md`.
- **Trace-page cohesion: waterfall + sequence are now one linked view.** Previously the
  waterfall was interactive (click a span → attribute panel) but the sequence view was inert,
  and the two tabs held independent state. Four changes, shipped together:
  - **`Message.spanId` (core, TDD).** `sequenceFor()` now tags each message with the span it
    represents (request arrow → the callee's server span; peer arrow → the client span), so a
    sequence arrow can be linked to its waterfall row. 1 new unit test (**47 unit green**).
  - **Shared span selection.** Selection is lifted to the trace page and passed to both tabs;
    clicking a sequence arrow *or* a waterfall row selects the same span and drives a single
    shared attribute panel. Switching tabs preserves the selection. The sequence view reuses the
    page's already-loaded detail instead of re-fetching.
  - **Waterfall time axis + gridlines.** A tick ruler (0 → trace duration) over the track column
    with vertical gridlines behind the bars; narrow-bar durations render outside the bar.
  - **Waterfall depth rails.** One vertical guide per ancestor level marks the tree structure in
    the label gutter (readable for deep traces).
  2 new e2e (axis/rails/shared-detail render; cross-tab selection sync) — **17 e2e green**,
  typecheck clean. Verified visually against the live testbed (`POST /api/checkout`, 9 services /
  50 spans): clicking the `get` arrow (auth→redis) highlights it and shows that span's redis
  attributes in the shared panel. Docs: `docs/live-views.md` (new), `docs/README.md`.

## [2026-07-06]
- **`serve.sh --collector`.** `serve.sh` starts only the OTLP/native server (:4319), so the
  algo-instrumentation stream (the internal `/v1/event/*` format that carries app/module +
  function granularity) was silently dropped unless you launched the collector by hand. The new
  `--collector` flag runs the collector alongside the server (`SOURCE=http ADAPTER=algo-instrumentation
  HTTP_PORT=${COLLECTOR_PORT:-4320}`, forwarding to the server), reaping it on exit via a trap.
  Flags are order-independent and combine with `--build`; unknown flags error. Point the app's
  `/v1/event/*` emitter at :4320. Verified end to end: `serve.sh --collector` on test ports, POST
  an algo instrumentation event to the collector → module lifeline `…LOCAL.<module>` lands in the
  server; collector reaped when serve.sh exits. Docs: README, CLAUDE.md, integrating-your-app.md.
- **OTLP: wildcard `http.route` no longer hides the URL.** Catch-all frameworks (Remix/SPA)
  report `http.route:"*"`, and `httpName()` preferred the route, so every request collapsed to
  `GET *` in the trace feed and flow view while the real path sat unused in `http.target`. It
  now skips a `"*"` route and falls back to `url.path` / `http.target`, so a live HRMS request
  renders `GET /permissions/4`. 1 test (**46 unit green**, typecheck clean); verified end to end
  through the HTTP OTLP ingest path (`GET *` span → `GET /permissions/4`). Note: this only
  affects the raw OTel auto-instrumentation stream (`service.name=hrms`) — module/function
  granularity still comes from the `algo-instrumentation` custom emitter (`…LOCAL.<module>` with
  `payload.spans[]`), which OTel auto-instrumentation cannot provide.
- **`algo-instrumentation`: consume HRMS's real trace structure.** HRMS now emits
  `request.traceId` / `request.spanId` and a `payload.spans[]` array of child operations
  (db / function / http …). The adapter prefers those real IDs (`traceId = request.traceId ??
  requestId ?? eventId`; event span uses `request.spanId`) and unpacks `spans[]` into nested
  child `Event`s — `kind:"db"` → a `client` span with `peer:"database"` (draws a database
  lifeline + topology edge), `function` → `internal`, redis/cache/http mapped too. Turns the
  shallow `client → hrms.<module>` trace into a real fan-out (`dashboard → database` per query).
  Backward-compatible: events without traceId/spans fall back to the old requestId synthesis.
  2 new tests (**45 unit green**, typecheck clean); mapping in `docs/adapters/algo-instrumentation.md`.
- **`algo-instrumentation`: trace-feed title = the endpoint, not the requestId.** The synthetic
  `client` root now carries the child operation (`GET /roles` for instrumentation, else the
  `log …`/`audit …` label) instead of the opaque requestId, so the live-trace feed reads the URL.
  HRMS gives each event its own requestId (one child/trace) so it's unambiguous; multi-event
  requests fall back to last-write-wins on the shared root. 1 test; verified live (`rootOperation`
  = `GET /roles`).
- **Client adapter specs moved into the repo.** `adapters-hidden/` (gitignored) →
  `docs/adapters/` (tracked): `adapter-id-1.md`, `algo-instrumentation.md`,
  `skillzengine-adapter.md`. Removed the `adapters-hidden/` `.gitignore` entry; updated path
  references in code + docs. Deliberate reversal of the earlier "private/client material, not
  for the repo" stance — these are now committed and pushed.
- **Adapter `adapter-id-2` → renamed `algo-instrumentation`**, plus real-format fixes driven
  by live HRMS traffic. Registry key / `ADAPTER=` value, files
  (`packages/collector/src/adapters/algo-instrumentation.{ts,test.ts}`, spec
  `adapters-hidden/algo-instrumentation.md`), and the `algoInstrumentation` export all renamed.
  Adapter now (1) **unwraps a `{ events: [...] }` batch envelope** — the shape the HRMS web app
  actually POSTs, previously dropped whole (no top-level `eventId`); (2) reads **`status_code`**
  (snake_case) as well as `statusCode`, so a 5xx with no explicit `success` flag renders as an
  error; (3) captures extra fields as searchable attributes — `application.service`/`.version`,
  top-level `severity`/`message`, `tags.*`, and `payload.memory_usage_mb`. No HRMS-side change
  (the adapter absorbs the format). TDD: 3 new tests (**43 unit green**, typecheck clean);
  verified end to end by POSTing a real HRMS batch through the `http` source → `HRMS WEB
  APPLICATION (LOCAL).<module>` lifelines with duration/status/attrs. Docs: mapping in
  `docs/integration-adapters.md`; spec refreshed in `adapters-hidden/algo-instrumentation.md`.

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
