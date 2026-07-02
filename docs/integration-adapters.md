# Integrating LiveProbe with client apps (adapters)

**Status: MVP built and verified** (native `/v1/events` ingest + a collector with stdin/rabbitmq
sources + the `adapter-id-1` reference adapter). See "Running the collector" below.

## Problem

LiveProbe runs on the client side. Their apps are polyglot (Node, Ruby on Rails,
Elixir/Phoenix, Go, Python) and emit instrumentation in a **client-specific structured
format** (not OTLP) — the first client's format spec lives in `adapters-hidden/adapter-id-1.md`
(client-proprietary, kept out of the repo via `.gitignore`). Different
clients use different formats **and** different transports (client-1 emits to **RabbitMQ**,
another client emits to **stdout**). We need one way to bring all of them into LiveProbe.

## Principle: the normalized Event is the narrow waist

LiveProbe's engine only ever works with the normalized `Event` model
(`packages/core/src/event.ts`). Trace assembly, sequence diagrams, topology, history, and
search are all projections of `Event[]`. The OTLP ingest already in place (`normalizeOtlp`)
is just the first adapter: `OTLP JSON → Event[]`.

So integration reduces to: **for each input format, write `raw → Event[]`.** The core never
changes. Many input formats → one `Event` model → many views (an hourglass).

## Two orthogonal concerns

- **Transport (source)** — *where* events arrive: RabbitMQ, stdout, HTTP.
- **Format (adapter)** — *how* to map them: `adapter-id-1`, `adapter-id-2`, …

Any source pairs with any adapter. **Polyglot does not multiply adapters**: a client's five
languages all emit the *same* structured format, so one adapter covers all of them. The
language is irrelevant once events reach the transport.

## The collector

```
 SOURCES (transport)                 ADAPTERS (per client format)          SINK
 ──────────────────                  ────────────────────────────          ────
 rabbitmq  ─ consume queue ─┐
 stdout    ─ ndjson lines  ─┼─ raw event ─► adapter(raw) => Event[] ─► POST /v1/events ─► LiveProbe
 http      ─ receive POSTs ─┘             (adapter-id-1, id-2, …)          └► window/SQLite/UI
```

Config wires each client:

```yaml
sources:
  - id: client-1            # emits to RabbitMQ
    type: rabbitmq
    url:   amqp://…
    queue: instrumentation.events
    adapter: adapter-id-1

  - id: client-2            # emits to stdout
    type: stdout            # newline-delimited JSON on stdin / a tailed file / a log-shipper POST
    adapter: adapter-id-2
```

Source notes:
- **rabbitmq** — asserts a durable queue and consumes it, `prefetch(64)`, acking each message
  once the adapter has run and the event is buffered for send (see delivery semantics under the
  runbook below — it is **best-effort, not durable**). Set `EXCHANGE` to bind the queue to an
  existing exchange for a **non-intrusive fanout tap** (`EXCHANGE_TYPE` to declare it, else it is
  verified passively; `ROUTING_KEY` for the binding key(s), default `#`). Implementation:
  `packages/collector/src/sources/rabbitmq.ts`.
- **stdout** — newline-delimited JSON from stdin or a tailed file. In container/k8s land, apps
  write JSON lines to stdout and a log shipper (fluentbit/vector) can POST them to the
  collector's `http` source; or the collector tails the file directly. Same adapter either way.
- **http** — a plain receiver for log shippers / direct pushers.

## Deployment modes

The collector supports two deployment shapes; pick per client (or mix):

1. **Sidecar per client (recommended default for isolation).** One collector instance per
   client, running one source + one adapter, deployed next to (or as a sidecar of) that
   client's system. Benefits: fault and resource isolation (one client's spike or bad message
   can't affect another), independent scaling and upgrades, per-client credentials/config kept
   separate, and a blast radius of one client. This is the first-class option — a client's
   config is self-contained and its collector can be deployed/rolled back on its own.
2. **Single multi-source collector.** One collector reading several sources at once (the
   `sources: [...]` config above). Simpler to operate for a few small clients, but couples
   their fate together.

Both use the exact same collector binary and the same source/adapter building blocks — a
sidecar is just the collector configured with a single source. Start client onboarding with a
sidecar; consolidate later only if operationally justified.

## adapter-id-1 field mapping (their format → `Event`)

| LiveProbe `Event` | ← adapter-id-1 field |
|---|---|
| `traceId` / `spanId` / `parentSpanId` | `trace_id` / `span_id` / `parent_span_id` |
| `participant` | `service_category` (or `component`) |
| `operation` | `service:event_type` (their `span_name` = sc+component+service) |
| `startTime` | `span_start_timestamp` / `timestamp` (→ micros) |
| `status` | `level`: ERROR/CRITICAL → `error`, else `ok`/`unset` |
| `attributes` | `details` + `event_value`, `correlation_id`, `reference_id`, `reference_type`, `ou_id`, `event_source` |
| `kind` | *(not in their format)* → default `internal` |
| `peer` / `duration` | *(not present)* → optional (see gaps) |

**Works immediately** with the above: trace assembly, **sequence diagrams**, **service
topology** (LiveProbe derives service→service edges from parent/child `participant`
transitions — it does not need OTel span kinds), history, and search.

**Gaps to decide later:**
- **Latency/duration** — their format is event-centric; a per-span duration needs a span-end
  event (their `event_value` sometimes carries a TAT we could use).
- **Datastore nodes** — need a `peer` / `db.system` convention; without it, datastores don't
  appear as nodes (service→service topology still works).
- **Span kind** — default `internal`; could be inferred from their context parser
  (http / rabbitmq / socket) if we want producer/consumer arrows.

## What was built (MVP)

- [x] **`POST /v1/events`** — native ingest on the server, accepting `{ events: Event[] }` (the
  target all adapters produce). Shares the OTLP ingest path via `coerceEvents` in `@liveprobe/core`.
- [x] **A collector** (`packages/collector`) — sources `stdin` (ndjson) and `rabbitmq`, an adapter
  registry, and a batching sink that POSTs to `/v1/events`.
- [x] **`adapter-id-1`** — a reference `(raw) => Event[]` mapping for the structured-event format
  (field mapping below). One client event → one span.
- [x] **Verified end to end** — piped sample client events (stdin) through the adapter into
  LiveProbe: they rendered as a `web-gateway → orders-api → payments` trace with the payment span
  marked as an error, plus the matching topology and sequence.

New client after this = **a new adapter file + one config block**; the transport is just a source.

## Running the collector

```bash
# ndjson on stdin (one client event per line)
cat events.ndjson | SOURCE=stdin ADAPTER=adapter-id-1 LIVEPROBE_URL=http://localhost:4319 \
  npx tsx packages/collector/src/index.ts

# consume a RabbitMQ queue directly (one collector per client; run as a sidecar)
SOURCE=rabbitmq ADAPTER=adapter-id-1 RABBITMQ_URL=amqp://… QUEUE=instrumentation.events \
  LIVEPROBE_URL=http://localhost:4319 npx tsx packages/collector/src/index.ts

# non-intrusive fanout tap: bind a dedicated queue to an existing exchange (see the runbook)
SOURCE=rabbitmq ADAPTER=adapter-id-1 RABBITMQ_URL=amqp://… \
  EXCHANGE=instrumentation ROUTING_KEY="#" QUEUE=liveprobe.tap \
  LIVEPROBE_URL=http://localhost:4319 npx tsx packages/collector/src/index.ts
```

Adapters live in `packages/collector/src/adapters/` (`adapter-id-1`, plus `liveprobe-native`
passthrough). The client's private format spec stays in `adapters-hidden/`.

## Rolling out to an existing production estate (non-intrusive runbook)

The common real-world case: a client runs **many apps** (say 10) across **mixed environments**
(vanilla VPS, GCP, …) in **several languages** (React + Node + Postgres via an ORM,
Elixir/Phoenix + Ecto, …), and they **already emit** `adapter-id-1`-format instrumentation
through an internal library that publishes to a **shared RabbitMQ**, which is then written to
stdout and fanned out to their own aggregators for storage/analysis.

This is the easiest possible integration, because the client already did the hard part
(normalizing every app into one format on one transport). The whole job is to add a *reader*.

### The one principle: tap the stream, don't divert it

You do **not** touch the 10 apps, and you do **not** take over the existing consumers. You add
a parallel reader that gets a **copy** of the same stream and forwards it to LiveProbe. The
client's existing storage/analysis pipeline keeps working, unchanged and unaware.

### You deploy ONE collector for the client — not one per app

Because every app already funnels into a single normalized stream:

- **Language / framework / ORM is irrelevant.** React, Node, Elixir, Ecto, Postgres — by the
  time data reaches RabbitMQ it is uniform `adapter-id-1` JSON. LiveProbe never sees app code.
- **Hosting diversity is irrelevant.** VPS vs GCP vs anything else — they all publish to the
  one shared RabbitMQ. The integration point is that single broker, not the 10 apps.

So: **1 collector instance + 1 LiveProbe server per client**, regardless of app count, language
mix, or where the apps run. (Run one collector *per client*, not per app — see Deployment modes.)

### Step 1 — pick a tap point

**Option A — RabbitMQ fanout copy (recommended).** Bind a *new, dedicated* queue (e.g.
`liveprobe.tap`) to the same exchange the internal library publishes to. RabbitMQ then delivers
every message to both the existing aggregator queue **and** the LiveProbe queue. Point the
collector's `rabbitmq` source at `liveprobe.tap`.

> ⚠️ **Never point the collector at the aggregators' existing queue.** Two consumers on one
> queue are *competing* consumers — LiveProbe would *steal* half the messages from the client's
> pipeline. A tap must be its own queue bound to the exchange, so each side gets its own copy.

> The binding is built in: set `EXCHANGE` (plus optional `ROUTING_KEY`, default `#`) and the
> source declares/verifies the exchange, asserts your `QUEUE`, and binds it on startup — no
> manual RabbitMQ admin step. Use `EXCHANGE_TYPE` (e.g. `topic`, `fanout`) to *declare* the
> exchange; omit it to bind to one someone else already owns (verified passively, never
> redeclared). For a `direct` exchange, set `ROUTING_KEY` to the exact key(s); fanout ignores it.

**Option B — stdout tee (zero RabbitMQ changes).** The client already writes the stream to
stdout. `tee` that stream (or point a log shipper at the same file) into the collector's `stdin`
source. Nothing about RabbitMQ changes at all — the most non-intrusive option when you can't add
a queue binding.

### Step 2 — run LiveProbe

LiveProbe needs **no infrastructure of its own** (in-memory window + a local SQLite file; no
database or broker to provision). Run it anywhere that can reach the tap, kept private:

```bash
PORT=4319 node packages/server/src/index.ts     # or the docker / npx equivalent
```

### Step 3 — run the collector (one instance)

```bash
# Option A — RabbitMQ fanout tap: binds a dedicated queue to the client's exchange
SOURCE=rabbitmq ADAPTER=adapter-id-1 \
  RABBITMQ_URL=amqp://<shared-rabbit-host> \
  EXCHANGE=<their-exchange> ROUTING_KEY="#" \
  QUEUE=liveprobe.tap \
  LIVEPROBE_URL=http://<liveprobe-host>:4319 \
  node packages/collector/src/index.ts
#   add EXCHANGE_TYPE=topic (or fanout) to declare the exchange if it doesn't exist yet;
#   omit EXCHANGE to consume a queue directly instead of tapping an exchange.

# Option B — stdout tap
SOURCE=stdin ADAPTER=adapter-id-1 LIVEPROBE_URL=http://<liveprobe-host>:4319 \
  node packages/collector/src/index.ts  < your-ndjson-stream
```

The collector consumes → runs `adapterId1(raw)` per message → batches and POSTs normalized
events to `/v1/events`. A message that is not valid JSON is dropped (nack, no requeue) so one
poison message can't wedge the queue.

### Step 4 — open the UI

Traces assemble from the `trace_id` / `span_id` / `parent_span_id` already present in the
client's events. Sequence and topology render immediately.

### Where to run it (mixed VPS / GCP)

The collector must reach **both** the shared RabbitMQ and the LiveProbe server; LiveProbe must
be reachable from the collector. Put LiveProbe + the collector on one small box near the broker
(a VPS, a GCP VM, Cloud Run, or a GKE pod) with network access to RabbitMQ (same VPC / peered /
firewall rule). The 10 apps' own locations don't matter — they only talk to RabbitMQ.

### What you get — and what's limited for this format

Works out of the box: **trace assembly, sequence diagrams, service topology** (derived from
parent/child `participant` transitions — no OTel span kinds needed), history, and search.

Limited, because `adapter-id-1` is event-centric: the adapter maps each event to one span with
`kind: "internal"` and `duration: 0` (`packages/collector/src/adapters/adapter-id-1.ts`). So
there are **no latency bars and no precise client→server request/response arrows** for this
client. Closing that needs the upstream library to emit a span `kind` and a per-span duration
(or span-end events) — which *is* intrusive to the apps, so treat it as an opt-in phase 2, not
part of the minimal rollout. Full field mapping and gaps: see the two sections above.

### Production caveats (state these to the client)

- **Best-effort delivery, by design.** The collector acks a RabbitMQ message once its event is
  buffered for send, and the sink drops a batch (logs, no retry) if the `POST /v1/events` fails
  (`packages/collector/src/sink.ts`). LiveProbe is a **live-diagnostics view, not a system of
  record** — a dropped batch means a momentary gap in the live diagram, never data loss for the
  client (their own aggregators still receive everything). Don't position it as durable storage.
- **Exactly one consumer per stream.** LiveProbe assembles by trace/span id, so a second
  collector reading the *same* messages would double-count spans. Scale by giving each collector
  its *own* tap, never two collectors on one queue.
- **One collector per client.** For multiple clients, run a separate collector (and ideally a
  separate LiveProbe) per client — isolation, per-client RabbitMQ credentials, blast radius of
  one. See Deployment modes above.

## Open questions (answer before building)

1. Message granularity: on RabbitMQ, is each message **one** instrumentation event (JSON of
   the adapter-id-1 fields), or a batch/envelope? Same for the stdout stream (one event per
   line?).
2. Deployment: default to a **sidecar per client** (documented above). Confirm whether any
   clients should instead share a single multi-source collector.
3. Do we want per-span **duration** (requires span-end events) in the first cut, or start with
   structure-only (sequence + topology) and add latency later?
