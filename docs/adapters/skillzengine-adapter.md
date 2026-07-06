# SkillzEngine (skillsengine-admin-re) → LiveProbe integration

> **Status: IMPLEMENTED 2026-07-05** on branch `feat/live-probing` (commits `3040073` →
> `fefefe8`). Optional via `TRACING=1` — inert otherwise. Pieces: `scripts/with-tracing.sh`
> (no-op wrapper), `deployment/tracing.mjs` (**the --import entry: auto-instrumentation +
> noise filtering** — ignore-list drops Vite/static/asset requests at the source, express
> middleware + fs + dns/net instrumentations off; `TRACING_IGNORE` overrides),
> `docker-compose.tracing.yml` (collector overlay), `deployment/otel-collector.yaml`,
> dev-start.sh wiring, `docs/live-probing.md` + README steps. **Verified end to end live**:
> app routes trace with real titles + nested `mongodb.aggregate` (driver v7 works,
> auto-instrumentations-node 0.77); asset/vite/node_modules requests emit zero traces;
> express `GET *` title problem resolved by disabling that instrumentation. Client runs it
> against `./serve.sh` LiveProbe on the same host.

Client-private integration notes (this folder is gitignored). Reviewed 2026-07-05 against
`/home/rajesh/work/algo/products/skillsengine-admin-re`. The app has **no structured
instrumentation** (pino/morgan logs only — no trace ids, can't feed diagrams), so this is
the OTel path, not the adapter path: there is no existing structured stream to tap.

## The system (as reviewed)

| Process | Stack | Port | Runs |
|---|---|---|---|
| **admin-web** (`server.js`) | Express + Remix SSR (custom server, `app.all("*")` → Remix) | :3000 | host |
| **admin-ws** (`websocket.js`) | **uWebSockets.js** + mediasoup (WebRTC), Redis pub/sub | :3001 | host |
| **admin-worker** (`app/workers/index.server.ts`, via `tsx`) | BullMQ consumers: AI jobs (LangChain → Anthropic/OpenAI/Google), code eval (Piston), framework eval | — | host |
| **recording** (`recording-service.js`) | Node + GStreamer/FFmpeg | :3002 | docker |

Infra (docker-compose): MongoDB 7 (host :27018), Redis (host :6380), MailHog, Piston
code-exec API (:2001). Outbound: LLM APIs, Piston, Razorpay, S3, SMTP, node-ssh.

**Facts that shape the integration:**

- `"type": "module"` — **pure ESM**. `NODE_OPTIONS="--require …"` does NOTHING here
  (the CJS require hook never sees ESM imports). Must use `--import` (Node ≥ 20.6;
  `engines` says ≥ 20, container is Node 22 — fine, but check the host Node is ≥ 20.6).
- Custom Express server → express/http auto-instrumentation applies.
- Native `mongodb` driver v7, `ioredis` v5, BullMQ over Redis.
- The app already has a docker-compose for infra → the otel-collector slots in there.

## The recipe (zero source changes)

### 1. One dependency

```bash
npm i @opentelemetry/auto-instrumentations-node
```

(The `--import` register hook must resolve from the app's node_modules. This is the whole
"intrusion": one dependency + env. No source edits.)

### 2. Env per process

In `scripts/dev-start.sh` for dev; in the systemd/pm2 unit for prod. Identical for every
process except `OTEL_SERVICE_NAME`:

```bash
export NODE_OPTIONS="--import @opentelemetry/auto-instrumentations-node/register"  # NOT --require (ESM)
export OTEL_SERVICE_NAME=admin-web       # admin-ws | admin-worker | recording
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_TRACES_EXPORTER=otlp OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none
```

- The worker runs under `tsx` — `NODE_OPTIONS` is honored, nothing special needed.
- The recording container gets the same env in `docker-compose.yml`, with
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`.

### 3. One otel-collector in their compose

The Node SDK exports OTLP/**protobuf**; LiveProbe parses OTLP/**JSON** only — the
translating collector is mandatory:

```yaml
  otel-collector:
    image: otel/opentelemetry-collector:0.115.1
    ports: ["4318:4318"]                 # host processes export to localhost:4318
    volumes: ["./deployment/otel-collector.yaml:/etc/otelcol/config.yaml:ro"]
    command: ["--config=/etc/otelcol/config.yaml"]
    extra_hosts: ["host.docker.internal:host-gateway"]
```

```yaml
# deployment/otel-collector.yaml
receivers:
  otlp:
    protocols: { http: { endpoint: 0.0.0.0:4318 } }
processors:
  batch: { timeout: 1s }
exporters:
  otlphttp/liveprobe:
    endpoint: http://host.docker.internal:4319   # LiveProbe (adjust if remote)
    encoding: json                               # ← the protobuf→JSON translation
    tls: { insecure: true }
service:
  pipelines:
    traces: { receivers: [otlp], processors: [batch], exporters: [otlphttp/liveprobe] }
```

LiveProbe itself runs anywhere reachable on :4319 (no infra of its own: in-memory window
+ a local SQLite file; `RETENTION_DAYS` defaults to 14).

### 4. Verify the pipe before any SDK work

Hand-rolled native event → LiveProbe (proves reachability + rendering, bypasses OTel):
see `docs/integrating-your-app.md` § "Verify the pipe" for the curl fixture.

## What renders immediately

- **admin-web**: a server span per request; nested **ioredis** spans; outbound `fetch`
  spans. **LLM APIs and Piston render as dashed ghost nodes** (`api.anthropic.com`,
  `localhost:2001`) — uninstrumented peers are drawn, not hidden.
- **admin-worker**: Redis / Mongo / LLM spans per job (job = its own trace root).
- **recording**: its Mongo/Redis/HTTP activity.
- **Redis** as a datastore node (from `db.system`) — nothing installed on Redis itself.

## Caveats specific to this app

1. **MongoDB driver v7 may be ahead of `@opentelemetry/instrumentation-mongodb`'s
   supported range** (v6 was the ceiling as of early 2026). Verify Mongo spans appear;
   if absent, that's why. Everything else still traces; Mongo joins when the
   instrumentation supports v7 (or pin the driver to v6).
2. **Trace titles may collapse to `GET *`.** The express instrumentation reports
   `http.route`, and Remix is mounted as `app.all("*")`. If every trace is titled
   `GET *`, set `OTEL_NODE_DISABLED_INSTRUMENTATIONS=express` — the http
   instrumentation's `http.target` then yields real paths.
3. **uWebSockets.js is invisible to OTel** — it bypasses `node:http`, so `admin-ws` gets
   no inbound spans for socket traffic (its outbound Redis/Mongo calls still trace).
   mediasoup is native — same. Accepted limitation.
4. **BullMQ does not propagate trace context.** A web request that enqueues a job and the
   worker that processes it are **two separate traces** (web → redis client span; new
   root in the worker). The flow view still shows `admin-web → redis ← admin-worker`.
   Fixing it = community BullMQ instrumentation or manually carrying `traceparent` in
   job data — both are code changes; phase 2, opt-in.

## Phase 2 (optional, each a small code change)

- **Browser**: OTel-web bootstrap in `entry.client.tsx` (one file), exporter → the
  collector's public URL, `propagateTraceHeaderCorsUrls` for same-origin — browser + SSR
  + loaders become one trace. See `examples/otel-react-go/react-frontend/tracing.ts`.
- **BullMQ trace continuity**: see caveat 4.

## Granularity: service vs module/class vs action (Q&A from review)

**"Which action triggered it" — free, day one.** Every span walks up `parentSpanId` to
the trace root = the triggering action (`POST /assessments/save`, a BullMQ job name, a
cron tick). LiveProbe titles the trace by the root operation; attribute search answers
"everything triggered by X" / "every trace touching user 42" — put ids in attributes.

**"Which module/class/method" — needs in-process spans (code change).** Auto-
instrumentation only spans I/O boundaries; in Node there is no zero-code way to trace
your own classes. The floor is one wrapper utility applied to the classes that matter:

```ts
// app/lib/traced.server.ts
import { trace, SpanStatusCode } from "@opentelemetry/api";
const tracer = trace.getTracer("app");

export function traced<T extends (...a: any[]) => any>(namespace: string, fn: T, name = fn.name): T {
  return function (this: unknown, ...args: any[]) {
    return tracer.startActiveSpan(`${namespace}.${name}`, {
      attributes: { "code.namespace": namespace, "code.function": name },
    }, (span) => {
      try {
        const out = fn.apply(this, args);
        return out instanceof Promise ? out.finally(() => span.end()) : (span.end(), out);
      } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR }); span.end(); throw e;
      }
    });
  } as T;
}
```

Wrap e.g. `AssessmentService`, worker processors, the Piston runner. Spans nest inside
the request/job automatically (ambient context). **Object-instance** attribution goes in
attributes (`entity.id`, `org.id`, `user.id`) — searchable, without per-instance
diagram noise.

**How LiveProbe renders it:**

- **Waterfall: supported now.** Internal spans nest with timing; click → `code.namespace`
  / `code.function` / entity ids.
- **Sequence/flow: service-level today.** `participant` = `service.name` (one per
  process); same-participant internal spans are not drawn as arrows.
- **Class-level lifelines**: possible today via the native `/v1/events` path
  (`participant` is any string — post `"admin-web/AssessmentService"` and it renders).
  For the OTLP path it needs a LiveProbe enhancement: participant override from a span
  attribute (`code.namespace` / `liveprobe.participant`) + a service⇄module zoom toggle
  in the UI. Small change (the engine is participant-string-agnostic); on the LiveProbe
  backlog if wanted.

## System impact & installations (client question, 2026-07-05)

**Installs:** app → `npm i @opentelemetry/auto-instrumentations-node` (~30–50MB in
node_modules, the only in-app change); server → the otel-collector compose service
(~40MB image); LiveProbe wherever reachable (:4319, SQLite bounded by `RETENTION_DAYS`).
Nothing on Mongo/Redis/OS — no agents, no proxies, no kernel modules.

**Runtime impact:** low single-digit % CPU under load; export is batched (≤2048 queued
spans, ~5s flush) to localhost, off the hot path, non-blocking; a few tens of MB memory,
bounded — overflow **drops spans, never backpressures requests**; slightly slower boot
(ESM loader hook). Telemetry failure (collector/LiveProbe down) → batches dropped, app
unaffected by design. Outbound calls (LLM/Razorpay/Piston/S3) gain a W3C `traceparent`
header — standard, ignored by third parties, but new bytes on the wire. uWS/mediasoup
(native) and pino/morgan untouched.

**Cautions:** (1) scope `NODE_OPTIONS` to the service units, not a global shell profile —
else every Node process on the box boots the SDK; (2) default samples 100% of requests —
on a busy prod box consider `OTEL_TRACES_SAMPLER=parentbased_traceidratio` +
`OTEL_TRACES_SAMPLER_ARG=0.1`; (3) `--import` needs **Node ≥ 20.6** on the host.

**Rollback:** delete the `NODE_OPTIONS` env line and restart — instantly inert, nothing
persists in the app.

## The UI (client question, 2026-07-05)

LiveProbe's UI ships with its server — open the LiveProbe instance in a browser (`:4319`
serving the built UI) for the live flow graph, sequence/waterfall trace views, search,
errors, and history dashboards. It is a **separate dashboard next to skillzengine**, not
embedded in the admin app; skillzengine only emits. Run it from a LiveProbe checkout
(`./dev-start.sh --static`, or `node packages/server/src/index.ts` with the UI built —
the `npx liveprobe` CLI is still backlog). **UI + ingest share one unauthenticated
server**: bind to localhost/private network, reach it via SSH tunnel or VPN, or front it
with an authed reverse proxy — never expose :4319 raw. A nav link (or authed iframe) from
the skillzengine admin UI is fine once that's in place.

## Rollout order

1. Verify the pipe (curl fixture) → 2. collector in compose → 3. env on `admin-web` only
(first useful diagram) → 4. env on worker + recording + ws → 5. tune (`GET *` check,
Mongo v7 check) → 6. phase 2 items as needed.
