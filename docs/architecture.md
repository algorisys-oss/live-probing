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
- **REST (live)**:
  - `GET /api/traces?limit=` — recent trace summaries
  - `GET /api/traces/:id` — one trace: summary + sequence model + Mermaid (falls back to the
    history store once a trace has aged out of the live window)
  - `GET /api/topology` — the aggregate graph + Mermaid
  - `GET /api/service/:name` — one service from the live window: inbound/outbound deps, error
    rate, span count, and top operations
- **REST (history)**:
  - `GET /api/days` — days that have data, with request/error counts
  - `GET /api/day/:date/summary` — requests, error rate, p50/p95/p99 latency, per-minute
    throughput, top endpoints, and the slowest traces
  - `GET /api/day/:date/traces?limit=` — that day's trace summaries
  - `GET /api/day/:date/latency?endpoint=` — p50/p95/p99 per minute for one endpoint
  - `GET /api/errors?limit=` — errored traces grouped by endpoint + error label, with a sample trace
  - `GET /api/search?q=&service=&error=&minMs=&maxMs=&minSpans=&sort=&traceId=&limit=` —
    search all persisted traces (endpoint substring, service, error-only, latency range,
    min span count, sort by recent or slowest, or exact id)
- **WebSocket** (`/ws`): on connect sends a `snapshot`; then pushes `traces` deltas (per
  ingest) and `topology` deltas (throttled, ~750 ms).
- Serves the built UI from `packages/server/public` with SPA fallback.
- **`summary.ts`** — `summarize(trace)` (title, services, span count, duration, error flag)
  and `detail(trace)` (summary + sequence + Mermaid).
- **`history-store.ts`** — persistence. On ingest, each affected trace (summary + detail) is
  upserted into **SQLite** (`node:sqlite`, no external dependency), partitioned by UTC day.
  This is what powers the daily view and lets trace detail survive eviction from the live
  window. The live window stays in memory for speed; the store is the durable record.

### `packages/ui` — React dashboard (React + zustand + react-router)

- A zustand store holds the recent traces (Map, capped 200, newest first), the topology, and
  connection state; it applies websocket messages on the hot path. The websocket is opened
  once in the root layout so it survives navigation.
- **Routes**:
  - `/` — the **live page**: trace-list sidebar + the flow view.
  - `/trace/:traceId` — a **dedicated trace page** (deep-linkable): summary + two tabs — a
    **span waterfall** (Gantt nested by depth, click a span → its attributes) and the sequence.
  - `/service/:name` — a **service page** (also reached by clicking a flow node): deps, error
    rate, top operations.
  - `/errors` — the **error explorer**: errored traces grouped by endpoint + error label.
  - `/history` — days that have data.
  - `/day/:date` — the **daily dashboard**: rollup cards (requests, error rate, p50/p95/p99),
    a throughput chart, top endpoints, and the slowest traces (each linking to its trace page).
  - `/search` — search all recorded traces by endpoint / service / error / min latency; there
    is also a search box in the header.
- **Pause** — the live list reorders as traces stream, which fights inspection. A Pause toggle
  freezes the visible list (new traces still buffer into the map and a "N new" counter ticks);
  Resume flushes. Topology keeps updating regardless.
- **Flow view** — a custom SVG of the topology with a stable layout (positions recompute only
  when the node set changes, so deltas don't make it jump). Zoom-to-fit by default (the whole
  graph scales into view), with wheel-zoom, drag-to-pan, and +/−/Fit controls. Datastore nodes
  styled apart; edge width scales with call volume; red on errors.
- **Sequence view** — a custom SVG lifeline diagram for a trace (dashed for async, red for
  errors), used on the trace page.
- Talks to the server via REST (initial load + trace detail) and the websocket (live).

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
