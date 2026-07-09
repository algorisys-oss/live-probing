# Handoff

Current state and how to resume. Rolling doc — reflects the latest, not history (that's
`CHANGELOG.md`). Updated after every task. All work is on `origin/main` (and `dev`) at the
latest commit unless a "Last task" note says otherwise.

## Last task
**Docs: revised `LOOPS.md`** — tightened prose, made it project-agnostic (greenfield or migration),
and folded in the Bun Zig→Rust migration lessons. Rule numerals are unchanged, so `CLAUDE.md`'s
by-number references still resolve. Reframed XXIII (VCS recovery, not `.backup` files), XXVI (rolling
handoff doc, not a per-response footer), and XII (breakable-behavior coverage, not an 80% floor);
enriched XXXVI (migration strategy) and XXXVII (no silent test skips). Word count is ~flat (denser,
not shorter) because the migration material refilled the trimmed padding.

Earlier — **Fix: containerized deploy — `docker-compose.yml` `liveprobe` service now binds `HOST=0.0.0.0`.**
Surfaced on an HRMS staging deploy: `collector-1 | ingest failed: fetch failed` against
`http://liveprobe:4319/v1/events` while `liveprobe-1` logged `listening on 127.0.0.1:4319`. The
service set `PORT`/`DB_PATH`/`RETENTION_DAYS` but not `HOST`, so the server bound loopback inside its
container — sibling containers (`collector`, `otel-collector`) and the published host port all reach
it via eth0/NAT, which a loopback listener refuses. The in-container healthcheck hits its own
loopback, so the container reports **Healthy** while ingest is dead (a trap to remember). Added
`HOST: "0.0.0.0"` to the `liveprobe` service. Redeploy: `docker compose up -d liveprobe` (env-only,
no rebuild), then `docker compose restart collector`. Same root cause as the dev-start fix below;
server code / loopback default unchanged.

Earlier — **Fix: `dev-start.sh` — testbed traces stopped landing after the ingest-hardening commit.** The
hardening commit changed the server's default bind to `127.0.0.1`; the dockerized testbed collector
reaches LiveProbe on the host via `host.docker.internal:4319` (host-gateway, `testbed/otel/
collector-config.yaml:25`), which arrives on the Docker bridge — a loopback-only socket refuses it,
so no testbed traces flowed. `dev-start.sh` now sets `HOST="${HOST:-0.0.0.0}"` on **both** server
invocations (watch + static). Server code unchanged — loopback stays the safe default for real
deployments; only the local dev runner opts into exposing the bridge. The collector's OTLP POST is
not subject to the CORS/WebSocket origin policy (no `Origin` header → passes through), so the bind
was the sole blocker.

Earlier — **Security hardening of the ingest server (review-driven, TDD).** A critical review — validated
end-to-end against the Shopwave testbed — found five issues in the network-facing server; all fixed,
77 tests green (5 new server + 1 new core), typecheck clean.
- **Remote crash (Critical).** A native event with an out-of-range `startTime` (e.g. `1e30`) made
  `dayOf()` throw `RangeError` inside `upsertMany`, on the unguarded history-flush `setInterval` →
  whole process exits. Fixed three ways: `clampMicros()` in `core/event.ts` bounds every ingested
  timestamp (native + OTLP); `dayOf()` in `history-store.ts` never throws (falls back to epoch day);
  `flushHistory()` in `server.ts` wraps `upsertMany` in try/catch.
- **Live-view eviction (found while testing the crash fix).** A far-future `startTime` became the
  window's clock reference and evicted every recent trace. `clampMicros` now also caps a start time
  at `now + 60s` (`startTimeCeiling()`, `FUTURE_SKEW_MICROS`, kept < the 5-min live horizon).
- **PII/secret masking was dead code (High).** `maskPii` existed but was never called, so emails /
  cards / bearer tokens reached SQLite and the UI verbatim (confirmed live). Now wired at the true
  chokepoint: `ingestEvents()` runs `maskEvents()` on every event before buffer/persist/broadcast.
  This supersedes the earlier "wire it per-adapter" plan — one central point covers OTLP + native.
  Disable with `MASK_PII=off`.
- **No body/decompression limits (High).** `server.ts` now caps request bodies at 8 MB (413) and
  gzip output at 32 MB (`gunzipSync maxOutputLength`) — was an unbounded buffer + zip-bomb OOM.
- **Wide-open network posture (High).** Default bind is now `127.0.0.1` (set `HOST=0.0.0.0` to
  expose — **needed for the dockerized testbed collector → host path**); CORS reflects only loopback
  origins (or `CORS_ORIGINS`) instead of `*`; the WebSocket upgrade enforces the same origin policy.
  Error responses no longer echo internal messages.

Earlier on this branch — **Retention default 14 → 30 days; live-window knobs now env-configurable.** `RETENTION_DAYS`
defaults to 30 (`packages/server/src/server.ts:85`) — a trace's waterfall/sequence is retrievable by
id for 30 days after it leaves the live window. Also wired two previously code-only options to env
vars in `packages/server/src/index.ts` via a `numEnv()` helper: `LIVE_WINDOW_MINUTES` (→
`horizonMicros`, default 5) and `MAX_TRACES` (→ `maxTraces`, default 2000). All three configurable
via `.env`/shell; `RETENTION_DAYS=0` disables pruning. Note: `LIVE_WINDOW_MINUTES`/`MAX_TRACES` size
the live *real-time* stream only — the by-id detail view is governed solely by `RETENTION_DAYS`.
Docs synced (README env tables + sample `.env`, index/server comments, implementation-review,
skillzengine adapter). Typecheck + 4 server tests green.

Earlier on this branch — **Shared `maskPii()` PII/secret masking helper (core, TDD).** New `packages/core/src/mask.ts`
(exported from `@liveprobe/core`): `maskPii(event, opts?)`, `maskEvents`, `maskString`. Redacts
sensitive attribute keys by name and scrubs embedded emails / bearer tokens / Luhn-valid card
numbers from string values and the identity fields (`operation`/`peer`/`participant`); never
mutates input. Meant as a backstop *after* a per-client allow-list — an adapter calls
`maskEvents(...)` before returning. 11 new tests (72 total green), typecheck clean. **Not yet wired
into `adapter-id-1` / `algo-instrumentation`** — opt-in per client so existing verified output
doesn't change. Documented in `docs/pii-masking.md` (full reference: two-layer strategy, Luhn card
rule, limitations), linked from the `docs/integration-adapters.md` PII section. Synced to
`origin/main` and `dev`.

Earlier on this branch — **Sequence view: collapse repeated sibling spans into a ×N group.** An
N+1 (or any hot loop) drew as a staircase of identical rows; the sequence view now folds a run of
≥3 repeated **leaf** sibling calls (same `from→to · operation · async`) into one collapsed ×N row
that **names** the problem instead of hiding it. This came out of diagnosing a real HRMS
`GET /apply-leave` N+1 (see below).
- **Core (`packages/core/src/sequence-layout.ts`, TDD):** `sequenceLayout(sequence, expanded?)`
  now detects groups (new `SequenceGroup`, exported). Leaf-only — a call that strictly contains
  another is a parent and is never folded, so nesting is never hidden. Grouping buckets by
  signature *within each contiguous leaf run*, so an interleaved dept/emp cluster yields one group
  each. Each group carries `count`, `spanIds`, total/min/max/avg duration, `errorCount`, and
  `concurrent` (any member overlap ⇒ fan-out; else sequential ⇒ N+1 shape). Collapsed by default;
  `expanded` (a `Set` of group ids) opens one. 7 new tests.
- **UI:** mirror in `packages/ui/src/lib/sequence-layout.ts` (**keep in sync** with core);
  `sequence-view.tsx` renders the collapsed row (bold label + `×N`, `Σ<total> · sequential|
  concurrent` badge, `⚠` when a sequential run ≥5 = suspected N+1, `· N err` when a member
  errored — **errors are never folded away**), a per-group expand/collapse toggle (click the row
  or its activation bar), and a `<title>` tooltip with the full breakdown. Local `expanded` state,
  reset on trace change. New CSS: `.seq-msg-group`, `.seq-group-badge`, `.seq-activation-group`,
  `.seq-msg-n1` (amber `--new`).

**61 unit green**, typecheck + UI build clean. Verified in a headless browser against a synthesized
`GET /apply-leave` trace (3 distinct prologue queries left ungrouped + interleaved
`DepartmentLeaveOverride ×15` / `EmployeeLeaveOverride ×15`, one member errored): the 30-row
staircase collapses to 5 rows, both folds show `⚠` + sequential, the emp fold shows `· 1 err` in
red, and expanding one leaves the other folded.

**Diagnostic context (HRMS, not changed):** the trigger was a real N+1 on HRMS `GET /apply-leave`
— `app/routes/apply-leave.tsx:182` calls `resolveEffectiveLeaveType` per leave type, and
`app/services/leave-policy-override.server.ts` fires 3 queries each (redundant base refetch + dept
+ emp override `findFirst`) ⇒ 3N queries. Fix (batch to 2 `findMany`s) was scoped but **HRMS was
left untouched at the user's request**; the same pattern also lives in `resolveAllLeaveTypesForEmployee`.

Open threads in `todo.md`: **D** (algo emitter Gaps A/B, HRMS-side), **G** (Docker review
leftovers; `dev-stop` auto-wipe decision).

---

Prior task: **Waterfall followups: critical path + self-time + collapse/expand + span deep-links.**
Branch `diagram-followups` (merged to `dev`). Completed the diagram track.
- **Core:** pure `criticalPath(trace)` in `packages/core/src/critical-path.ts` — backward
  last-finisher sweep from each node's end; spans that ran concurrently in a sibling's shadow are
  excluded. Unit tested. Shipped in `TraceDetail.criticalPath` (server `summary.detail()`).
- **UI (`waterfall-view.tsx`):** marks critical spans (◆ + accent bar outline + row accent);
  shades each bar's child-covered ranges (hatched) so the solid remainder = self-time; collapse/
  expand a subtree (chevron + "+N" hidden count, DFS-order hiding); `trace-page.tsx` syncs the
  selected span to a `#spanId` URL hash. Waterfall keyed by `traceId` so collapse state resets.

---

Prior task: **Docker deployment PR review + hardening.** Reviewed the merged docker PR (`Dockerfile`,
`docker-compose.yml`, `.dockerignore`, `otel-collector-config.yaml`, `scripts/deploy.js`) by
actually building and running the image; it works end to end. Applied three hardening fixes on
branch `fix-docker-hardening` (merged to `dev`):
- **Non-root:** `USER node` + `chown node:node /data` in the Dockerfile.
- **Leaner runtime:** `npm ci --omit=dev && npm install --no-save tsx@^4.19.2` (drops
  vite/typescript/playwright from the runtime image).
- **`deploy.js`:** validate `remoteDir` against a safe charset + single-quote it in the remote
  `cd` (path-with-spaces bug / shell-injection).
- **Server boot fix (exposed by non-root):** `packages/server/src/index.ts` unconditionally
  `mkdir`ed a hardcoded `packages/server/data` even when `DB_PATH` was elsewhere (EACCES as
  `node`). Now `mkdir`s the directory of the *actual* `dbPath` (skips `:memory:`).

Verified by build+run: boots as uid 1000, `/api/topology` 200, ingest 200, `/data/liveprobe.db`
written node-owned, healthcheck healthy. 53 unit + 18 e2e green, typecheck clean.

**Docker review — remaining (not applied, lower priority):** pin the base image to a digest
(`node:22-slim` floats; loads `node:sqlite` unflagged today at v22.23.1); `deploy.js` doesn't
bundle the `otel/opentelemetry-collector` image (remote pulls from registry under `--profile
otel`); healthcheck hits `/api/topology` (triggers `flushHistory`) — a side-effect-free
`/healthz` would be cleaner; `docker save | gzip` for faster transfer.

---

Prior task: **Sequence view: activation bars + UML call/return arrows.** Branch `seq-activation-bars`
(merged to `dev`). The sequence tab drew a flat list of one-way call arrows; it's now a proper
UML interaction diagram.

- **Core:** new pure `sequenceLayout(sequence)` in `packages/core/src/sequence-layout.ts` —
  turns time-ordered messages into a bracketed call/return layout. Each **sync** call → an
  **activation bar** on the callee lifeline (call row → return row); rows are bracketed so a
  parent's return lands after its children's; overlapping activations on one lifeline get a
  depth-offset lane. Nesting is inferred from **time containment** (a sync parent is active
  while its children run) — no parent-id dependency. Async → call row only, no return/bar.
  Exported from core index. 4 unit tests.
- **UI:** the browser mirrors the same pure fn in `packages/ui/src/lib/sequence-layout.ts`
  (the UI stays decoupled from the core package and mirrors its shapes; core is the tested
  source of truth — **keep the two in sync**). `sequence-view.tsx` now draws activation rects,
  solid call arrows (filled head), and dashed reply arrows (open/stick head) labelled with the
  call duration. **Convention: dashing = reply vs call; arrowhead = sync vs async.** Two new SVG
  markers (`seq-arrow-open`, `seq-arrow-open-error`). Selection preserved (click a bar or arrow
  → shared detail panel).

**53 unit + 18 e2e green** (1 new e2e in `e2e/trace.spec.ts`), typecheck + UI build clean.
Verified visually against the live testbed (`POST /api/checkout`, 50 spans): nested
gateway⊃auth⊃redis activation bars, dashed returns with µs labels, clicked call highlighted +
its span in the shared panel.

**Next in the diagram track** (scoped/queued in `todo.md`): waterfall critical-path highlight +
self-time shading; collapse/expand subtrees; deep-link a span via `#spanId`. Emitter-side algo
Gaps A/B (shallow one-level fan-out, missing `spans[]` per route) remain open on HRMS — the
sequence layout renders real depth the moment the emitter provides nested parents.

Still open (non-diagram): the `dev-stop` auto-wipe change was discussed (recommendation: wipe by
default + `--keep` opt-out) but not implemented — the user paused on it.

---

Prior task: **algo-instrumentation Gap C: accept `payload.spans[]` and never orphan a child.** Branch
`fix-algo-spans-location` (merged to `dev`). The adapter
(`packages/collector/src/adapters/algo-instrumentation.ts`) read child spans only from top-level
`r.spans`, but the spec / some emitters nest them under `payload.spans` — silently dropped, so
those requests rendered flat (no db/function children), looking exactly like an emitter that sent
no spans at all. Now reads `spans[]` from **either** location, and `childSpan` takes a
`parentFallback` (the handler span id) so a child with no `parentSpanId` attaches to the handler
instead of becoming a second root. 2 new tests (**49 unit green**, typecheck clean). Verified end
to end through the real collector `http` source → sink → server (isolated ports 4391 → 4390): a
`payload.spans[]` event yields `child-db` (peer `database`) + orphan `child-fn`, both parented to
the handler span.

This closes only the LiveProbe-side gap. **Gaps A (shallow one-level fan-out — every child
parented to `request.spanId` instead of its real enclosing span) and B (routes emitting no/partial
`spans[]`, e.g. `/permissions`) are emitter-side (HRMS)** and still open — the algo stream stays
shallow until HRMS emits true nested `parentSpanId`s and populates `spans[]` for every route. The
adapter already honours real parent ids, so deeper trees render the moment the emitter provides
them. Activation-bars work (scoped, not yet built) should target the OTel stream first, which has
real depth today.

---

Prior task: **Trace-page cohesion: the waterfall and sequence tabs are now one linked view.** Branch
`trace-page-cohesion` (merged to `dev`). The waterfall was already interactive (click a span →
attribute panel) but the sequence view was inert and the two tabs held independent selection.
Four changes shipped together:

1. **`Message.spanId` (core, TDD).** `sequenceFor()` (`packages/core/src/sequence.ts`) tags each
   message with the span it represents — request arrow → the callee's server span, peer arrow →
   the client span — so a sequence arrow links to a real waterfall row. Mirrored in
   `packages/ui/src/lib/types.ts`.
2. **Shared span selection.** `selectedSpanId` is lifted to `packages/ui/src/pages/trace-page.tsx`
   and passed to both `WaterfallView` (`selectedId`/`onSelect`) and `SequenceView`
   (`selectedSpanId`/`onSelectSpan`). One shared `SpanDetail` panel (now exported from
   `waterfall-view.tsx`) renders at page level for both tabs. Selection persists across tab
   switches; on load it auto-selects the first errored span (else the root). `SequenceView` takes
   an optional `detail` prop and reuses the page's already-loaded detail instead of re-fetching.
3. **Waterfall time axis + gridlines** — a tick ruler over the track column with vertical
   gridlines behind the bars; narrow-bar durations render outside the bar.
4. **Waterfall depth rails** — one vertical guide per ancestor level in the label gutter marks
   the tree structure.

**47 unit + 17 e2e green**, typecheck + UI build clean. 2 new e2e in `e2e/trace.spec.ts`
(axis/rails/shared-detail; cross-tab selection sync). Verified visually against the live testbed
(`POST /api/checkout`, 9 services / 50 spans): clicking the `get` arrow (auth→redis) highlights it
and shows that span's redis attributes in the shared panel. New doc `docs/live-views.md` explains
the homepage flow graph (rolling-window aggregate) and the trace views.

Gotcha found this session: Playwright's `reuseExistingServer` reuses a stale server already on
:4399 **without rebuilding the UI**, so new-markup e2e assertions fail against old assets. If e2e
fails only on new UI, kill whatever holds :4399 and re-run so `e2e:serve` rebuilds fresh.

---

Prior task: **Live HRMS wiring: `serve.sh --collector` + wildcard-URL fix.** Two changes, committed together.

**(a) `serve.sh --collector`.** `serve.sh` only starts the OTLP/native server (:4319); the
algo-instrumentation stream (`/v1/event/*` → app/module + function granularity) needs the
**collector** (:4320), which `serve.sh` never launched — so with `serve.sh` alone you get only the
OTel view. `--collector` now runs the collector alongside the server (env `COLLECTOR_PORT`, default
4320), reaped on exit via a trap; flags combine with `--build`, unknown flags error. Point the app's
`/v1/event/*` emitter at :4320. Verified e2e (test ports): POST an algo event to the collector →
`…LOCAL.<module>` lifeline lands in the server; collector reaped on serve.sh exit.

**IMPORTANT — the two streams don't merge.** A live HRMS request appears as **two separate traces**:
the OTel copy (`service.name=hrms`, `hrms → redis`, hex trace id) and the algo copy
(`hrms.<module>` / `…LOCAL.<module>`, UUID trace id). OTel can't carry module/function; only the
algo stream does. Opening the OTel copy shows the module-less `hrms → redis` — the module view is
the *other* trace (service chip `hrms.<module>`). NOTE: current live HRMS algo events for
`/permissions` arrive **without** `payload.spans[]`, so that trace shows the module lifeline but no
function/db children yet (the `/dashboard` sample did include them). Open decision unchanged: to get
one clean module-rich view per request, quiet the raw OTel `hrms` stream (disable HRMS OTel
auto-instrumentation, or filter `service.name=hrms` at ingest).

**(b) OTLP: stop hiding real URLs behind `GET *` for catch-all routes** (TDD). A live HRMS (Remix)
diagnosis showed two streams landing in LiveProbe: (1) OTel auto-instrumentation — `service.name=hrms`,
every request titled `GET *` because the app's Express `http.route` is the wildcard `*`, topology
`hrms → localhost → redis` (the `localhost` node is HRMS's own outbound telemetry POSTs to
:4000/:4320/:3001); and (2) the `algo-instrumentation` custom emitter — `HRMS WEB APPLICATION
(LOCAL).<module>` lifelines with real endpoint + `payload.spans[]` functions (`GET /dashboard` →
`authenticate`/`fetchPermissions`/…), the stream that actually carries URL + module + functions.
Fix is scoped to stream (1): `httpName()` in `packages/core/src/otlp.ts` now skips a `"*"` route
and falls back to `url.path`/`http.target`, so `GET *` → `GET /permissions/4`. It does **not** add
module/function granularity — OTel auto-instrumentation can't; that's what the algo emitter is for.
1 new test (**46 unit green**, typecheck clean); verified end to end on an isolated server
(:4399) by POSTing a wildcard-route OTLP span and reading back `rootOperation = GET /permissions/4`,
and confirmed live (`GET /permissions/8`). Note: a plain-`tsx` server (no watch) must be **restarted**
to pick up core changes.

Prior task: **Renamed `adapter-id-2` → `algo-instrumentation` and fixed it for the live HRMS format** (TDD).
The HRMS web app POSTs a **`{ events: [...] }` batch envelope** with `status_code` (snake_case)
and extra fields — the old adapter dropped the whole envelope (no top-level `eventId`) so nothing
rendered. The adapter now: unwraps `{ events: [...] }` (each element mapped independently); reads
`status_code` as well as `statusCode` (a 5xx with no `success` flag is now an error); and captures
`application.service`/`.version`, top-level `severity`/`message`, `tags.*`, and
`payload.memory_usage_mb` as searchable attributes. Module still lands on the lifeline as before
(`HRMS WEB APPLICATION (LOCAL).<module>`) — **no UI change and no HRMS change** (the adapter
absorbs the format). Renamed files (`packages/collector/src/adapters/algo-instrumentation.{ts,test.ts}`,
spec `docs/adapters/algo-instrumentation.md`), the registry key / `ADAPTER=` value, and the
`algoInstrumentation` export. 3 new tests (**43 unit green** + typecheck clean); verified end to
end by POSTing a real HRMS batch through the `http` source → two `…LOCAL.<module>` lifelines with
duration/status/`status_code`/`memory_usage_mb`/`tags.route_type`. Docs: mapping in
`docs/integration-adapters.md`, spec refreshed in `docs/adapters/algo-instrumentation.md`.
Known format limitation unchanged: no causality → arrows fan out from the synthetic `client`
lifeline (real nesting needs the emitter to add span/parent ids).

Follow-on: **`algo-instrumentation` now consumes HRMS's real trace structure.** HRMS emits
`request.traceId`/`request.spanId` + a `payload.spans[]` array (db/function/http children). The
adapter prefers the real IDs and unpacks `spans[]` into nested child spans — `db` → `client`
with `peer:"database"`, `function` → `internal` — so a request draws its real fan-out
(`dashboard → database` per query) instead of a flat 2-span trace. Backward-compatible with
older (no-traceId/no-spans) events. 2 tests (45 unit green). Verify end-to-end from real HRMS.

Follow-on: **trace-feed title now shows the endpoint, not the requestId** — the synthetic
`client` root carries the child operation (`GET /roles`), since the feed title is
`roots[0].event.operation` (`packages/server/src/summary.ts`). One-line adapter change +
1 test; verified live. *(Restart the running collector to pick this up — the live pipeline
caches the old code otherwise.)*

Follow-on: **moved the client adapter specs into the repo** — `adapters-hidden/` (gitignored)
→ `docs/adapters/` (tracked): `adapter-id-1.md`, `algo-instrumentation.md`,
`skillzengine-adapter.md`. Removed the `adapters-hidden/` `.gitignore` entry. These are now
committed and pushed (deliberate — previously kept out of the repo as client-private).

Prior task: **Added `adapter-id-2` + collector `http` source** (now the `algo-instrumentation`
adapter above) — the path-agnostic `SOURCE=http` receiver (`HTTP_PORT`, default 4320) so
`/v1/event/*` emitters can be repointed at the collector unchanged.

Prior task: **Added `./serve.sh`** — standalone server entry point (UI + ingest on :4319, builds UI on
first run, no testbed) for client machines pointing real apps at LiveProbe; referenced from
README/CLAUDE.md/integration guide. Context: the SkillzEngine client integration landed on
their `feat/live-probing` branch (optional `TRACING=1` OTel auto-instrumentation; see
`docs/adapters/skillzengine-adapter.md` for status + verified findings, incl. Mongo v7
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
- **UI dev port drifted to :5174 this session**: another app (**Yappy**) was already on :5173, so
  LiveProbe's Vite fell through to **:5174** (its `<title>` is `LiveProbe`; API/ws still :4319). The
  :4319 server in this session was **API-only** (root `/` → `{"error":"not_found"}`, no static UI
  host) — to screenshot the UI, hit the Vite port, not :4319. Confirm the port with
  `ss -ltnp | grep vite` and `curl :<port>/ | grep -i '<title>'`.
- **Synthetic verification trace in the DB**: verifying the ×N fold injected a demo trace
  `n1apply00000000000000000000000001` (`GET /apply-leave`, HRMS→postgresql) via `POST /v1/events`.
  Harmless; drops on `./dev-stop.sh --wipe`. Use a **near-now** `startTime` (epoch µs) when seeding —
  a past timestamp is evicted from the live window immediately (learned the hard way).
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
- **Per-client adapter specs** live in `docs/adapters/` (tracked in the repo as of 2026-07-06;
  previously gitignored under `adapters-hidden/`): client format specs (`adapter-id-1.md`,
  `algo-instrumentation.md`) and per-client integration notes (`skillzengine-adapter.md` — OTel/ESM
  `--import` recipe for the Remix app, its caveats, and the granularity Q&A).
