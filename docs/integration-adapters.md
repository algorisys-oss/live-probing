# Integrating LiveProbe with client apps (adapters)

**Status: designed, not built.** This is the plan to feed client apps' instrumentation into
LiveProbe. Resume from the "What to build" section.

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
- **rabbitmq** — assert/bind a queue, consume, **ack only after a successful forward** so
  nothing is lost on a hiccup. Reuses the pattern in `testbed/packages/shared/src/amqp.ts`.
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

## What to build (MVP)

1. **`POST /v1/events`** — a native ingest endpoint on the LiveProbe server accepting a batch
   of normalized `Event`s (the target all adapters produce). Deferred when we went OTLP-first.
2. **A collector** (`packages/collector`) with two sources —
   `rabbitmq` and `stdout` (ndjson) — plus an adapter registry.
3. **`adapter-id-1`** — the mapping above, as a `(raw) => Event[]` function.
4. **Verify end to end** — feed sample client-1 events through RabbitMQ and watch them render
   in the LiveProbe flow / sequence / history / search.

New client after that = **new adapter file + one config block**; the transport is just a
source type.

## Open questions (answer before building)

1. Message granularity: on RabbitMQ, is each message **one** instrumentation event (JSON of
   the adapter-id-1 fields), or a batch/envelope? Same for the stdout stream (one event per
   line?).
2. Deployment: default to a **sidecar per client** (documented above). Confirm whether any
   clients should instead share a single multi-source collector.
3. Do we want per-span **duration** (requires span-end events) in the first cut, or start with
   structure-only (sequence + topology) and add latency later?
