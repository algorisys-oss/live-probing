# Architecture

Two systems live in this repo:

- **LiveProbe** (`packages/`) — the tool. It consumes OpenTelemetry traces and renders live
  sequence and flow diagrams of whatever system produced them.
- **Shopwave testbed** (`testbed/`) — a real distributed e-commerce system that emits those
  traces. It exists so LiveProbe has an honest, richly-instrumented system to observe.

The guiding idea: **draw observed behavior, not parsed source.** Everything LiveProbe shows
comes from what actually executed at runtime.

## The whole pipe

```
 Shopwave services (8) ──OTLP──►  OTel Collector ──┬─OTLP/gRPC─►  Jaeger        (reference UI)
 (auto-instrumented)                               │
                                                   └─OTLP/JSON─►  LiveProbe server
                                                                    │  POST /v1/traces
                                                                    ▼
                                                   normalizeOtlp → TraceWindow (rolling)
                                                                    │        │
                                                              sequence   topology
                                                                    │        │
                                                        REST + WebSocket (snapshot + deltas)
                                                                    │
                                                                    ▼
                                                        LiveProbe UI (React): flow + sequence
```

Every box is real and running. A single Shopwave checkout becomes one connected trace that
LiveProbe turns into both a per-trace sequence diagram and a contribution to the aggregate
topology graph.

## LiveProbe packages

### `packages/core` — the pure engine (no I/O)

The spine. All pure functions, unit-tested, no network or framework.

- **`event.ts`** — the normalized `Event` type (one event == one span) and the set of
  datastore systems. See [event-model.md](event-model.md).
- **`otlp.ts`** — `normalizeOtlp(payload)` flattens OTLP/HTTP JSON into `Event[]`. Maps span
  kind, status, timestamps (BigInt nanos → micros), and resolves the `peer`. Also rebuilds a
  real endpoint name (`"POST /api/checkout"`) from HTTP attributes when the instrumentation
  only emitted a bare method.
- **`trace-window.ts`** — `TraceWindow`, a rolling in-memory set of recent traces:
  - `add(events)` — upsert spans into per-trace buckets, in any order.
  - `assemble(traceId)` — build the span tree (roots = spans with no parent in the window),
    children sorted by start time.
  - eviction — drop traces older than a horizon (default 5 min) and past a hard cap (default
    2000), so memory is bounded.
  - `topology()` — aggregate the whole window into a service+datastore graph.
- **`sequence.ts`** — `sequenceFor(trace)` projects one assembled trace into ordered messages
  between participants.
- **`export/mermaid.ts`** — `toMermaidSequence` / `toMermaidFlow` render the models as Mermaid
  text (the snapshot/export path).

### `packages/server` — ingest + serve (Node http + ws only)

- **OTLP ingest**: `POST /v1/traces` accepts OTLP/HTTP JSON, gzip-aware, and feeds
  `normalizeOtlp` → `TraceWindow.add`.
- **REST**:
  - `GET /api/traces?limit=` — recent trace summaries
  - `GET /api/traces/:id` — one trace: summary + sequence model + Mermaid
  - `GET /api/topology` — the aggregate graph + Mermaid
- **WebSocket** (`/ws`): on connect sends a `snapshot`; then pushes `traces` deltas (per
  ingest) and `topology` deltas (throttled, ~750 ms).
- Serves the built UI from `packages/server/public` with SPA fallback.
- **`summary.ts`** — `summarize(trace)` (title, services, span count, duration, error flag)
  and `detail(trace)` (summary + sequence + Mermaid).

### `packages/ui` — React dashboard (React + zustand)

- A zustand store holds the recent traces (Map, capped 200, newest first), the topology, and
  connection state; it applies websocket messages on the hot path.
- **Flow view** — a custom SVG of the topology with a stable layout (positions recompute only
  when the node set changes, so deltas don't make it jump). Datastore nodes styled apart;
  edge width scales with call volume; red on errors.
- **Sequence view** — a custom SVG lifeline diagram for a selected trace (dashed for async,
  red for errors).
- Talks to the server via REST (initial/fallback) and the websocket (live).

## Message/websocket contracts

WebSocket frames from the server:

```
{ type: "snapshot", traces: TraceSummary[], topology: Topology, mermaidFlow: string }
{ type: "traces",   traces: TraceSummary[] }                    // upsert by traceId
{ type: "topology", topology: Topology, mermaidFlow: string }   // replace
```

```
TraceSummary = { traceId, rootOperation, services: string[], spanCount, startTime,
                 durationMicros, hasError }
Topology     = { nodes: string[], edges: Edge[] }
Edge         = { from, to, calls, errors, avgDurationMicros }
TraceDetail  = { summary: TraceSummary, sequence: Sequence, mermaidSequence: string }
Sequence     = { participants: string[], messages: Message[] }
Message      = { from, to, label, startTime, durationMicros, status, async }
```

## The testbed (Shopwave)

Eight Node/TypeScript services plus infrastructure, all in `testbed/docker-compose.yml`:

| Component | Role | Stores |
|-----------|------|--------|
| gateway | BFF / API entry, auth check, proxying | — |
| auth | signup/login, JWT, sessions | Postgres, Redis |
| catalog | products, search | Postgres, Redis (cache) |
| cart | cart state, price checks | Redis |
| order | orders, publishes order.created, saga | Postgres, RabbitMQ |
| payment-worker | consumes order.created, pays | Postgres, RabbitMQ |
| inventory-worker | consumes order.created, reserves stock | Postgres, RabbitMQ |
| notification-worker | consumes results, "sends" mail | Redis, RabbitMQ |
| postgres / redis / rabbitmq | infrastructure | — |
| otel-collector | receives OTLP, fans out to Jaeger + LiveProbe | — |
| jaeger | reference trace UI | — |

Services use **standard OpenTelemetry auto-instrumentation** (HTTP, pg, ioredis, amqplib) and
export OTLP to the collector. See [shopwave-events.md](shopwave-events.md) for the message
payloads and per-action traces.

Two instrumentation gotchas, both handled in `testbed/packages/shared`:
- `ioredis` and `amqplib` are loaded via `createRequire` because OTel only hooks the CommonJS
  `require` path, not ESM `import` — otherwise their spans silently vanish.
- Trace context must propagate through RabbitMQ message headers; the shared publish/consume
  helpers preserve it, so a checkout stays one connected trace across every queue hop.

## How LiveProbe connects to the testbed (T5)

`testbed/otel/collector-config.yaml` has an `otlphttp/liveprobe` exporter (JSON encoding)
pointing at `http://host.docker.internal:4319`, and the collector service has a
`host.docker.internal:host-gateway` mapping. So the collector — running in Docker — reaches
the LiveProbe server on the host. The two stacks stay decoupled: LiveProbe runs on the host,
the testbed in Docker, connected only by that one OTLP export line.

## Running it

`./dev.sh` builds the UI, brings up the testbed + traffic, and runs the LiveProbe server
serving the UI at http://localhost:4319. `./stop.sh` tears it all down. See the top-level
[README](../README.md) for details and ports.
