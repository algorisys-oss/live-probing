# The event model

Everything LiveProbe draws is a projection of a stream of one type: the normalized `Event`.
One `Event` corresponds to exactly one span. Defined in
[`packages/core/src/event.ts`](../packages/core/src/event.ts).

## The `Event` shape

```ts
interface Event {
  traceId: string;        // groups spans into one trace
  spanId: string;         // unique within the trace
  parentSpanId?: string;  // absent => this span is a trace root
  participant: string;    // the service doing this span's work (resource service.name)
  peer?: string;          // the other side for outbound spans (service or datastore)
  operation: string;      // human label: "POST /api/checkout", "pg.query:SELECT", ...
  kind: SpanKind;         // client | server | producer | consumer | internal
  startTime: number;      // epoch MICROSECONDS
  duration: number;       // MICROSECONDS
  status: SpanStatus;     // ok | error | unset
  attributes: Record<string, string | number | boolean>; // raw span attributes, kept as-is
}
```

```ts
type SpanKind   = "client" | "server" | "producer" | "consumer" | "internal";
type SpanStatus = "ok" | "error" | "unset";
```

`DATASTORE_SYSTEMS` is a set of infrastructure peers (`postgresql`, `mysql`, `redis`,
`rabbitmq`, `amqp`, `kafka`, `mongodb`, `memcached`, `elasticsearch`). It decides when a
`peer` is drawn as a datastore node rather than treated as a service.

### Field notes

- **participant vs peer.** `participant` is *who ran this span* — always the emitting
  service. `peer` is *who they talked to*, and only set for outbound spans. A Postgres query
  span has `participant: "catalog"`, `peer: "postgresql"`.
- **operation** is the display label. HTTP spans get `"METHOD /path"` (see below); DB spans
  keep their instrumentation name (`"pg.query:SELECT"`); messaging spans keep names like
  `"publish shopwave.orders"` or `"payment.order-created process"`.
- **times are microseconds.** OTLP sends nanosecond strings; we divide by 1000.

## OTLP → Event mapping

`normalizeOtlp(payload)` in [`otlp.ts`](../packages/core/src/otlp.ts) walks OTLP/HTTP JSON:
`resourceSpans[] → scopeSpans[] → spans[]`.

| Event field | Source | Rule |
|-------------|--------|------|
| `participant` | `resource.attributes["service.name"]` | falls back to `"unknown"` |
| `traceId` / `spanId` / `parentSpanId` | span fields | empty `parentSpanId` → `undefined` (root) |
| `operation` | `span.name`, enriched | HTTP: `METHOD path` (below); else the span name |
| `kind` | `span.kind` | int or string enum → our union (below) |
| `startTime` / `duration` | `startTimeUnixNano` / `endTimeUnixNano` | `BigInt(nanos) / 1000n` → micros |
| `status` | `span.status.code` | 2/ERROR → `error`, 1/OK → `ok`, else `unset` |
| `peer` | attributes | resolved by priority (below) |
| `attributes` | `span.attributes` | flattened to a plain map |

### Kind mapping

OTLP kind is `2 SERVER, 3 CLIENT, 4 PRODUCER, 5 CONSUMER`, anything else `internal`. Values
may arrive as numbers, numeric strings, or `"SPAN_KIND_SERVER"` etc.; all are handled. Kind
is the reference oracle for arrow direction in both diagrams.

### Peer resolution (outbound spans only)

For `client` / `producer` / `consumer` spans, the first present attribute wins:

1. `db.system` (e.g. `postgresql`, `redis`) — a datastore peer
2. `messaging.system` (e.g. `rabbitmq`) — a broker peer
3. `peer.service` → `server.address` → `net.peer.name` → `network.peer.address` — a service/host
4. `messaging.destination.name` — a queue/exchange

`server` and `internal` spans have no peer.

### HTTP name enrichment

HTTP instrumentation frequently names a span by bare method (`"GET"`, `"POST"`), which makes a
useless trace title. When a span carries an HTTP method and a path, `operation` becomes
`"METHOD path"`:

- method from `http.request.method` or `http.method`
- path from `http.route`, else `url.path`, else `http.target` (query string stripped)

So `POST` + `http.target=/api/cart/items?x=1` → `operation = "POST /api/cart/items"`.

### Attribute-value decoding

OTLP attribute values are wrapped: `{ stringValue }`, `{ boolValue }`, `{ intValue }`
(string or number), `{ doubleValue }`. Each is unwrapped to a primitive; unknown shapes are
dropped.

## From events to diagrams

### Trace assembly (`TraceWindow.assemble`)

Spans are bucketed by `traceId`. A tree is built by linking each span to its
`parentSpanId`; spans whose parent is not in the window become **roots**. Children are sorted
by `startTime` (ties by `spanId`). Assembly is order-independent — a child can arrive before
its parent and still link correctly once both are present.

### Topology (`TraceWindow.topology`)

Aggregated across the whole window into `{ nodes, edges }`. Two edge sources:

1. **service → service**: for any span whose parent (same trace) has a *different*
   `participant`, add an edge `parent.participant → span.participant`. Because a full Shopwave
   trace is connected across RabbitMQ, this captures async hops too (order → payment-worker).
2. **service → datastore**: for any span whose `peer` is in `DATASTORE_SYSTEMS`, add an edge
   `participant → peer`.

Each edge accumulates `calls`, `errors` (spans with `status === "error"`), and an average
duration.

### Sequence (`sequenceFor`)

One assembled trace → `{ participants, messages }`, walking spans in `startTime` order:

- A span whose parent is a *different* participant emits a message `parent → span` labelled
  with `operation`.
- A span calling a datastore emits `participant → peer`.
- Same-participant internal work is not drawn.
- `async: true` when the span is a `consumer` or its parent is a `producer` (the RabbitMQ
  boundary), which the UI renders as a dashed arrow.

`participants` are listed in order of first appearance.

## Why one model

Sequence and flow are two projections of the same `Event[]`. There is exactly one place a
span is interpreted (`normalizeOtlp`) and one place trace structure is derived
(`TraceWindow`). Bugs have one place to hide, and a new view is just another projection.
