# Implementation review — ingest path & the zero-instrumentation story

*Reviewed 2026-07-02. Scope: the full ingest path (core normalizers, trace window, sequence
projection, server, collector sources/adapters/sink) plus the three integration docs, with a
focus on how apps **without instrumentation** (React / Node / Elixir) get into LiveProbe.*

Findings are recorded here; actionable items are mirrored in `todo.md` (sections A, C, D, E).
Nothing in this doc changes code.

## Verdict

The "one normalized Event, everything else is a projection" design holds up in the code
exactly as documented: `otlp.ts` and `adapter-id-1.ts` both funnel into the same `Event`,
and `trace-window.ts` / `sequence.ts` never care where an event came from. The integration
docs match the code — including the unflattering parts (best-effort delivery, no auth,
adapter gaps). Keep that honesty.

## Findings (most significant first)

### 1. Uninstrumented *services* are invisible in both views — **FIXED 2026-07-02**

> Fixed as recommended: topology and sequence now draw edges to non-datastore peers when the
> callee never reported a span, expose them as `externals`, and the UI renders them as dashed
> ghost nodes/lifelines (Mermaid flow export styles them dashed too). See `CHANGELOG.md`.

Both `trace-window.ts` (`topology()`) and `sequence.ts` (`sequenceFor()`) only draw a
peer edge when `peer` is in `DATASTORE_SYSTEMS` (postgres, redis, kafka, …). But
`resolvePeer` in `otlp.ts` also resolves `peer.service` / `server.address` /
`net.peer.name` for calls to other **services**.

Consequence: during an incremental rollout — an instrumented Node app calls a
not-yet-instrumented Elixir app — the client span exists and carries
`peer: "elixir-host"`, yet **nothing renders**: no arrow, no node, no hint the call
happened. The flow diagram silently shows less than the system does, which contradicts the
"observed behavior" principle, precisely in the partial-onboarding scenario the adoption
docs target.

**Recommendation:** render non-datastore peers as "ghost"/external nodes (visually
distinct, e.g. dashed outline). Partial onboarding then becomes self-documenting — the
ghosts *are* the list of what to instrument next.

### 2. RabbitMQ source has no connection-error handling — **FIXED 2026-07-02**

> Fixed: the source now handles `error`/`close` and reconnects with exponential backoff
> (initial connect still fails fast); the runbook additionally recommends a supervisor.

`packages/collector/src/sources/rabbitmq.ts` never attaches `conn.on("error")`. A broker
restart or heartbeat timeout emits an unhandled `error` event on the amqplib connection
and crashes the collector. The rollout runbook's step 3 runs it as a bare `node …`
process, so in the documented production shape a broker blip kills the tap until someone
notices.

**Recommendation (cheapest first):** document "run under systemd with `Restart=always`"
as a requirement (consistent with the best-effort posture); better, add an error handler
with a reconnect loop.

### 3. Topology edge-key separator — **CORRECTED, then FIXED 2026-07-02**

*The original finding here was wrong.* It claimed `EDGE_SEP = " "` (a space) broke service
names containing spaces — but the separator was actually a **literal NUL byte** (`"\0"`),
which review tooling rendered as a space. Service names with spaces were never broken; NUL
cannot appear in a service name.

The real (smaller) defect the misread exposed: a raw NUL byte in a `.ts` source file makes
git and grep treat `trace-window.ts` as **binary** — no textual diffs, no grep. Fixed by
writing the same value as the escape sequence `"\u0000"`; behavior unchanged, file is text
again.

### 4. History write amplification — **FIXED 2026-07-02**

> Fixed as recommended: ingest now *stages* the latest assembly per trace and flushes on a
> timer (default 1500ms) or before any `/api` read (read-your-writes preserved), so a trace
> is written once per flush instead of once per batch. Retention landed with it:
> `RETENTION_DAYS` (default 30, 0 disables) prunes whole day-partitions at startup and
> hourly, with VACUUM so the file shrinks. Verified on a real DB (901KB → 462KB).

`ingestEvents` in `server.ts` re-upserts every affected trace on every incoming batch, so
a 40-span trace arriving across 10 batches is written to SQLite ~10 times. Combined with
no retention, this is the likely mechanism behind the 555 MB history DB.

**Recommendation:** pair the planned retention work with "upsert on trace
completion/quiescence, or debounce per trace".

### 5. Smaller items

- `readBody` (`server.ts`) has no request-size cap — one giant POST to the
  unauthenticated ingest buffers unbounded memory. Fine for the private-network posture,
  but a one-line cap is cheap.
- `coerceEvents` (`native.ts`) accepts any object as `attributes` without checking value
  types, so nested objects/arrays sneak in behind the declared
  `string | number | boolean` type.
- `adapter-id-1.ts` `toMicros` treats a bare number as epoch **milliseconds**; a client
  emitting seconds or micros lands in the wrong era. Documented as "tune per client" —
  acceptable, just keep it on the onboarding checklist.

Done well (keep): BigInt nanosecond handling and the old `instrumentationLibrarySpans`
fallback in `otlp.ts`, gzip-aware ingest, HTTP-name enrichment, the poison-message nack,
and the injectable RabbitMQ connection for tests.

## The zero-instrumentation story (React / Node / Elixir)

The docs' claims were checked against the code and hold. What "no instrumentation"
actually costs per stack:

| Stack | True floor | Path |
|---|---|---|
| **Node** | Zero source changes — env only | `NODE_OPTIONS=--require @opentelemetry/auto-instrumentations-node/register` + OTel env → local otel-collector (`encoding: json`) → LiveProbe (Recipes A/B/E). HTTP, `pg`, `ioredis`, `amqplib` — and ORMs over `pg` — come free. |
| **React** | One file + one init call — no zero-code path exists | OTel-web emits OTLP/**JSON**: direct to LiveProbe in dev; in production through the collector's TLS+CORS endpoint because LiveProbe's ingest has no auth (Recipe E). `traceparent` propagation stitches browser + backend into one trace. |
| **Elixir / Phoenix** | Deps + ~3 setup lines — no BEAM preload equivalent | `opentelemetry_phoenix/ecto/bandit` attach to `:telemetry` events Phoenix/Ecto already fire; the exporter is protobuf-only, so the translating collector is mandatory (Recipe E). |
| **Any stack, truly zero** | Host-level only | eBPF (Beyla / OTel eBPF) → OTLP → collector, with the documented fidelity caveats. |

The load-bearing fact — LiveProbe parses OTLP/**JSON** only, so protobuf emitters (Node/
Go/Elixir server SDKs) need one translating otel-collector — is stated correctly
throughout, and that collector doubles as the single auth/TLS/CORS boundary. Sound design.

The adapter path (Recipe D, `integration-adapters.md`) is for apps that *already emit* a
structured format; it is **not** an option for genuinely uninstrumented apps, and the docs
correctly never claim otherwise.

### Gaps in the story

1. **Pure-ESM Node apps.** The recipes present `--require` as universally zero-code, but
   the CJS require hook does not intercept ESM `import`s — a `"type": "module"` app needs
   `NODE_OPTIONS="--import @opentelemetry/auto-instrumentations-node/register"`
   (Node ≥ 18.19) instead. The gotchas section hints at the CJS/ESM split (the
   ioredis/amqplib `createRequire` note) but the recipes never say it outright.
2. **The partial-rollout blind spot** (finding 1) undercuts the incremental-onboarding
   pitch: onboard the Node app first and its calls to the still-uninstrumented Elixir app
   simply don't appear — the diagram looks *complete* when it isn't.
