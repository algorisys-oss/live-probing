# Integrating your app with LiveProbe

How to feed **any** running system — dockerized or not, Node or polyglot, greenfield or
already-instrumented — into LiveProbe so it draws live sequence and flow diagrams of what
your system actually does.

This is the general guide. For worked, copy-paste references see:

- [shopwave-events.md](shopwave-events.md) — the in-repo testbed: a dockerized 8-service
  e-commerce app instrumented end to end (the pattern in "Recipe A" below).
- [../examples/otel-react-go/README.md](../examples/otel-react-go/README.md) — a React
  frontend + Go backend (the "browser direct" and "non-Node service via collector" patterns).
- [integration-adapters.md](integration-adapters.md) — for apps that already emit a
  **custom, non-OTLP** instrumentation format (the native `/v1/events` + collector-adapter path).

## The mental model: one normalized event, two front doors

LiveProbe's engine only ever works with one normalized `Event` (see
[event-model.md](event-model.md)). Both diagram types — the per-trace **sequence** view and
the aggregate **flow/topology** view — are projections of the same `Event[]`. Integration is
therefore just: *get your telemetry into that event stream.* There are two ingest endpoints
on the LiveProbe server (default `:4319`):

| Endpoint | Body | Who uses it |
|----------|------|-------------|
| `POST /v1/traces` | **OTLP/JSON** spans | Anything OpenTelemetry-instrumented (the main path) |
| `POST /v1/events` | Pre-normalized `{ "events": [...] }` | Custom formats via the collector adapter; hand-rolled tests |

Both accept plain or gzipped JSON, and CORS is wide open (`access-control-allow-origin: *`),
so browsers can post directly.

## The one fact that shapes every integration

**LiveProbe's OTLP ingest reads OTLP/JSON, not protobuf.** The server `JSON.parse`s the
request body ([packages/server/src/server.ts](../packages/server/src/server.ts) `/v1/traces`).
That single fact decides whether you need a collector:

```
Emitter that speaks OTLP/JSON  ─────────────────────────────►  LiveProbe :4319/v1/traces   ✅ direct
Emitter that speaks OTLP/protobuf ─► OTel Collector (encoding: json) ─► LiveProbe :4319     (translated)
```

- **Browsers** (OTel-web) and a few SDKs configured for `http/json` emit JSON → post
  straight to LiveProbe, no collector.
- **Most server SDKs** (Node, Go, Python, Java, …) default to OTLP/**protobuf**. Send them
  through a lightweight **OpenTelemetry Collector** that re-exports with `encoding: json`.
  The collector is also where you batch, retry, and add resource attributes.

> Traces, not logs. LiveProbe draws diagrams from causal span structure (`traceId` /
> `parentSpanId` / `kind` / timing). Use OpenTelemetry's **tracing** signal; set metrics and
> logs exporters to `none`. A span with `status=error` is your red arrow; detail rides along
> as span **attributes**.

## Pick your path

| Your app | Path |
|----------|------|
| Node service, want zero code changes | **Recipe A** — `--require` auto-instrumentation + collector |
| Any OTel-SDK service (Go/Python/Java/…), dockerized | **Recipe A** — set OTel env, add a collector service |
| Same, **not** dockerized (bare process / VM / systemd) | **Recipe B** — same env, run one collector next to it |
| Browser / SPA frontend | **Recipe C** — OTel-web, post direct to `:4319` |
| App already emitting a **custom** (non-OTLP) format | **Recipe D** — native `/v1/events` via a collector adapter |

Whatever the language, once spans reach the wire the language is irrelevant — LiveProbe only
sees OTLP/JSON. Polyglot systems do **not** need one integration per language.

---

## Recipe A — Dockerized app via OpenTelemetry (the Shopwave pattern)

This is exactly how the repo's own testbed works. Two moving parts: OTel env on each service,
and one collector container that fans spans to LiveProbe.

**1. Instrument each service via env.** For Node, zero-code auto-instrumentation with a
`--require` preload covers `http`/`fetch`, `pg`, `ioredis`, `amqplib`, etc. Define the shared
OTel env once and give each service only its own name (YAML anchor keeps it DRY):

```yaml
# docker-compose.yml
x-otel-env: &otel-env
  NODE_OPTIONS: --require @opentelemetry/auto-instrumentations-node/register
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318   # OTLP/HTTP into the collector
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_TRACES_EXPORTER: otlp
  OTEL_METRICS_EXPORTER: none
  OTEL_LOGS_EXPORTER: none

services:
  orders:
    environment:
      <<: *otel-env
      OTEL_SERVICE_NAME: orders     # ← the ONE per-service line; becomes the diagram's node/lifeline label
```

`OTEL_SERVICE_NAME` is stamped onto every span as the `service.name` resource attribute,
which LiveProbe maps to `Event.participant` — the box in the flow view and the lifeline in the
sequence view. Rename it and the diagram renames.

For non-Node services, drop the `NODE_OPTIONS` line and instrument with that language's OTel
SDK, but keep the same `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` env.

**2. Add a collector that re-exports JSON to LiveProbe on the host:**

```yaml
  otel-collector:
    image: otel/opentelemetry-collector:0.115.1
    command: ["--config=/etc/otel/config.yaml"]
    volumes:
      - ./otel/collector-config.yaml:/etc/otel/config.yaml:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"   # lets the container reach LiveProbe on the host
```

```yaml
# otel/collector-config.yaml
receivers:
  otlp:
    protocols: { grpc: { endpoint: 0.0.0.0:4317 }, http: { endpoint: 0.0.0.0:4318 } }
processors:
  batch: { timeout: 1s }
exporters:
  otlphttp/liveprobe:
    endpoint: http://host.docker.internal:4319   # LiveProbe's OTLP/JSON ingest
    encoding: json                               # ← the protobuf→JSON translation
    tls: { insecure: true }
service:
  pipelines:
    traces: { receivers: [otlp], processors: [batch], exporters: [otlphttp/liveprobe] }
```

`endpoint: http://host.docker.internal:4319` is correct because the OTLP/HTTP exporter appends
`/v1/traces` itself. Add `jaeger`/`debug` exporters alongside if you want a second sink.

Start LiveProbe on the host (`./dev.sh`), bring the stack up, drive traffic → the diagram
redraws live.

## Recipe B — Non-dockerized app (bare process, VM, systemd, k8s pod)

Nothing here needs Docker. Two options:

**B1 — Run one collector next to the app (recommended, same as Recipe A minus compose).**
Install the collector binary (`otelcol`) and point it at LiveProbe:

```bash
# 1. LiveProbe running somewhere reachable (host, another VM, a cluster service)
# 2. Collector — same collector-config.yaml as above, but endpoint is LiveProbe's real address:
#    exporters.otlphttp/liveprobe.endpoint: http://<liveprobe-host>:4319
otelcol --config ./collector-config.yaml       # listens OTLP on :4317/:4318

# 3. Your app: export env before launching (works for a plain process or a systemd unit)
export OTEL_SERVICE_NAME=orders
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_TRACES_EXPORTER=otlp OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none
export NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"  # Node only
node ./server.js
```

In a systemd unit these go in `[Service]` as `Environment=` lines. In k8s they're container
`env:` entries and the collector is a sidecar or a DaemonSet.

**B2 — Skip the collector (only if your SDK can emit OTLP/JSON).** Some SDKs support
`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`. If yours does, point the app straight at LiveProbe
and drop the collector entirely:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://<liveprobe-host>:4319
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json      # ← must be JSON; protobuf won't parse
```

This is the leanest path for a single service, but most server SDKs default to protobuf, so
**B1 is the safe default.** The browser is the one emitter that always speaks JSON — see C.

## Recipe C — Browser / SPA frontend (direct, no collector)

The OTel-web OTLP/HTTP exporter emits JSON, so the browser posts straight to LiveProbe. Point
its exporter at `http://<liveprobe-host>:4319/v1/traces` and instrument fetch/XHR. To stitch
frontend spans to your backend into **one** trace, enable W3C context propagation
(`propagateTraceHeaderCorsUrls` on the web side, the `TraceContext` propagator on the server)
so the `traceparent` header rides the API call. Full snippet:
[../examples/otel-react-go/react-frontend/tracing.ts](../examples/otel-react-go/react-frontend/tracing.ts).

## Recipe D — App already emitting a custom (non-OTLP) format

If your app emits a proprietary structured format over RabbitMQ, stdout, or HTTP rather than
OTLP, use the native path: the repo's **collector** (`packages/collector`) consumes from a
source, runs a per-format **adapter** (`raw → Event[]`), and POSTs to `/v1/events`. One
adapter covers all of a client's languages. Design and config in
[integration-adapters.md](integration-adapters.md).

---

## Field mapping (what shows up in the diagram)

LiveProbe's `normalizeOtlp` derives the normalized `Event` from OTLP spans
([packages/core/src/otlp.ts](../packages/core/src/otlp.ts)):

| Diagram element | Comes from |
|-----------------|-----------|
| Participant (node / lifeline) | `service.name` resource attribute (= `OTEL_SERVICE_NAME`) |
| Peer (the other side of an edge) | `peer.service`, or `db.system` / `messaging.system` on client spans |
| Operation (arrow / span label) | span name (route, method, query) |
| Arrow direction | span `kind` (`client`/`server`/`producer`/`consumer`/`internal`) — OTel is the oracle |
| Red / error edge | span `status = error` |
| Timing | span start + duration (microseconds) |

Practical consequences: set a clear `OTEL_SERVICE_NAME` per service; keep standard OTel
semantic attributes (`db.system`, `messaging.system`, `http.route`) so peers and infra
(Postgres, Redis, RabbitMQ) render correctly without being instrumented themselves; propagate
`traceparent` across every hop — including message-queue headers — or traces fragment.

## Verify the pipe before touching any SDK

Prove LiveProbe is reachable and drawing with a hand-rolled native event (bypasses OTel
entirely — `startTime` and `duration` are epoch **microseconds**):

```bash
curl -X POST http://localhost:4319/v1/events -H 'content-type: application/json' -d '{
  "events": [
    {"traceId":"t1","spanId":"a","participant":"web","peer":"orders-api","operation":"GET /orders","kind":"client","startTime":1700000000000000,"duration":8000,"status":"ok","attributes":{}},
    {"traceId":"t1","spanId":"b","parentSpanId":"a","participant":"orders-api","operation":"GET /orders","kind":"server","startTime":1700000000001000,"duration":6000,"status":"ok","attributes":{}}
  ]
}'
```

Open the LiveProbe UI — you should see a `web → orders-api` trace. Then wire your real SDK via
the recipe above and watch real traffic replace the fixture.

## Common gotchas

- **Spans arrive at Jaeger but not LiveProbe** → the collector exporter is missing
  `encoding: json`, or is sending protobuf. LiveProbe only parses JSON.
- **Nothing arrives from a container** → the collector can't reach the host; add the
  `host.docker.internal:host-gateway` `extra_hosts` entry (or use LiveProbe's real address).
- **Frontend and backend show as two separate traces** → context propagation isn't wired;
  the `traceparent` header (and CORS allow-list for it) must be enabled on both sides.
- **Node spans missing for `amqplib` / `ioredis`** → load those libs via CJS `require`, not
  ESM `import`; OTel's instrumentation only hooks the require path (see
  `testbed/packages/shared/src/amqp.ts`).
- **Everything is one giant `internal` blob** → you're emitting the wrong signal or missing
  `kind`; make sure you export **traces** with proper client/server span kinds, not logs.
