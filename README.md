# LiveProbe

Live sequence and flow diagrams of running systems, drawn from observed runtime behavior
rather than parsed source. Point it at a system, watch requests flow through it as a live
sequence diagram (per trace) and a live topology diagram (aggregate), export either to
Mermaid or D2.

This repo has two parts:

- **LiveProbe** — the tool. Consumes OTLP traces, assembles them into a rolling window,
  and serves live sequence (per trace) and flow/topology (aggregate) diagrams over a
  websocket, plus Mermaid export. Lives in [packages/](packages/). See [plan.md](plan.md).
- **Shopwave testbed** — a real full-stack e-commerce system with Postgres, Redis,
  RabbitMQ, and OpenTelemetry, used as an honest trace source. Lives in [testbed/](testbed/).
  See [plan-testbed.md](plan-testbed.md).

## Status

| Part | State |
|------|-------|
| LiveProbe core (event model, OTLP normalizer, trace window, sequence, Mermaid) | **done, tested** |
| LiveProbe server (OTLP ingest + REST + websocket) | **done, tested** |
| LiveProbe UI (React + zustand live dashboard: flow + sequence views) | **done** |
| Testbed T0–T4 (full 8-service system + SPA + load gen) | **done, verified** |
| Testbed T5 (OTel collector -> LiveProbe) | **done, verified with live traffic** |

The testbed is 8 services (gateway, auth, catalog, cart, order + payment/inventory/
notification workers) over Postgres, Redis, and RabbitMQ, all OpenTelemetry-instrumented.
A checkout is one connected trace across all of them, including the async choreography
saga that advances order status (pending -> confirmed / cancelled) across RabbitMQ.
LiveProbe consumes that trace stream live: it already renders the full Shopwave topology
and per-trace sequences from real traffic.

## Running the testbed (what works today)

Everything runs in Docker. Host ports use a private range so nothing collides with other
stacks on the machine.

```bash
cd testbed
docker compose up -d --build
```

Then:

```bash
# List products (gateway -> catalog -> postgres)
curl -s localhost:3000/api/products | head -c 200

# Fetch a product twice: first a cache miss, then a hit (gateway -> catalog -> redis/pg)
curl -si localhost:3000/api/products/p-003 | grep -i x-cache   # miss
curl -si localhost:3000/api/products/p-003 | grep -i x-cache   # hit

# Full checkout journey (auth -> cart -> order -> RabbitMQ)
TOKEN=$(curl -s -X POST localhost:3000/api/signup -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"hunter2pw"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST localhost:3000/api/cart/items -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"productId":"p-003","quantity":2}' >/dev/null
curl -s -X POST localhost:3000/api/checkout -H "authorization: Bearer $TOKEN"   # creates order, publishes order.created
```

Open Jaeger at **http://localhost:16687** and look at the `gateway` service. A checkout is
a single trace spanning gateway, auth, cart, catalog, order, Postgres, Redis, and a
RabbitMQ publish, with context propagated across every boundary (including into the
`order.created` message headers).

Tear down with `docker compose down` (add `-v` to also drop the Postgres volume).

### Sample users

The auth service seeds a few accounts on startup, so you can log in (via the storefront SPA
at :8088 or the API) without signing up. All share the same password:

| Email | Password |
|-------|----------|
| `alice@shopwave.test` | `password123` |
| `bob@shopwave.test` | `password123` |
| `carol@shopwave.test` | `password123` |

```bash
curl -s -X POST localhost:3000/api/login -H 'content-type: application/json' \
  -d '{"email":"alice@shopwave.test","password":"password123"}'
```

Signing up new accounts still works too; the seed is idempotent and never overwrites them.

### Ports (host side)

| Service | URL / port |
|---------|-----------|
| Storefront SPA | http://localhost:8088 (start with `--profile ui`) |
| Gateway API | http://localhost:3000 |
| Auth API | http://localhost:3001 |
| Catalog API | http://localhost:3002 |
| Cart API | http://localhost:3003 |
| Order API | http://localhost:3004 |
| Payment worker | http://localhost:3005/healthz |
| Inventory worker | http://localhost:3006/healthz |
| Notification worker | http://localhost:3007/healthz |
| Jaeger UI | http://localhost:16687 |
| OTLP collector | localhost:24317 (gRPC), 24318 (HTTP) |
| Postgres | localhost:55432 |
| Redis | localhost:56379 |
| RabbitMQ | localhost:55672 (amqp), http://localhost:15673 (management) |

### Traffic generator (start / stop)

The load generator drives continuous, realistic user journeys so the diagrams have
something to show. It's off by default (it lives behind the `load` compose profile). All
commands run from `testbed/`.

```bash
# start it (continuous, ~12 req/s by default)
docker compose --profile load up -d loadgen

# watch what it's doing
docker compose logs -f loadgen

# stop it (diagrams go quiet; drive the system yourself instead)
docker compose stop loadgen        # pause;  `start loadgen` to resume
docker compose --profile load down loadgen   # remove the container entirely

# tune it: CONCURRENCY (parallel users), THINK_MS (pause between steps),
# DURATION_SECONDS (0 = forever). Example — a gentle trickle:
docker compose --profile load run --rm -e CONCURRENCY=1 -e THINK_MS=2000 loadgen
```

Note: some journeys intentionally fail (simulated payment declines and out-of-stock), so a
nonzero error count in its stats and red edges in the LiveProbe flow view are expected.

### Storefront profile

```bash
docker compose --profile ui up -d frontend      # storefront SPA on :8088
```

## Running LiveProbe

One command brings up the whole thing — testbed, traffic, and LiveProbe — with **hot reload
by default**:

```bash
./dev.sh
# then open http://localhost:5173
```

In this default (watch) mode: the **UI runs under Vite with HMR** at http://localhost:5173
(edits apply instantly), the **LiveProbe server** runs under `tsx watch` (restarts on
server/core changes), and the **testbed services** run under `tsx watch` too (via
`testbed/docker-compose.dev.yml`, which bind-mounts the source). Edit any source and it
reloads. The API/ws stays on :4319.

For a demo / non-dev run, build the UI once and serve it statically from the server:

```bash
./dev.sh --static   # then open http://localhost:4319
```

`--no-load` skips the traffic generator; `--no-build` (static mode) reuses the last UI build.
Stop everything with one script:

```bash
./stop.sh           # stop the LiveProbe server + tear down the Docker stack
./stop.sh --wipe    # also drop the Postgres data
```

Or do it manually:

```bash
# 1. Start the testbed (it exports OTLP to a collector that fans out to Jaeger + LiveProbe)
cd testbed && docker compose up -d --build && cd ..

# 2. Start the LiveProbe server (OTLP ingest on :4319, REST + ws)
npm install
PORT=4319 npx tsx packages/server/src/index.ts

# 3. Generate traffic and watch LiveProbe fill up
cd testbed && docker compose --profile load up -d loadgen && cd ..
curl -s http://localhost:4319/api/topology | python3 -m json.tool   # live service graph
curl -s "http://localhost:4319/api/traces?limit=5"                  # recent traces
```

The testbed collector is already wired to export OTLP/JSON to LiveProbe on the host
(`host.docker.internal:4319`) in
[testbed/otel/collector-config.yaml](testbed/otel/collector-config.yaml). LiveProbe endpoints:

| Endpoint | What |
|----------|------|
| `POST /v1/traces` | OTLP/HTTP ingest (gzip-aware) |
| `POST /v1/events` | native ingest — a batch of normalized events (what adapters produce) |
| `GET /api/traces?limit=` | recent trace summaries |
| `GET /api/traces/:id` | one trace: sequence model + Mermaid |
| `GET /api/topology` | aggregate service/datastore graph + Mermaid |
| `ws /ws` | live snapshot + deltas |

Apps that don't speak OpenTelemetry can be fed via an **adapter + collector** that maps a
client's instrumentation format to normalized events and POSTs them to `/v1/events` — see
[docs/integration-adapters.md](docs/integration-adapters.md) (`packages/collector`).

Run the LiveProbe tests with `npm test`.

## How the testbed is instrumented

Services use standard OpenTelemetry auto-instrumentation and export OTLP to an OTel
collector, which fans out to both Jaeger and LiveProbe.

**Jaeger** is an open-source distributed-tracing UI (http://localhost:16687). It stores the
same traces LiveProbe sees and shows each one as a waterfall of spans. We run it as a
known-good reference: if LiveProbe's diagram of a trace disagrees with Jaeger's view of it,
LiveProbe is wrong. It's a development aid, not part of LiveProbe itself.

One gotcha worth knowing: some OTel instrumentations (ioredis, and likely amqplib) only
hook the CommonJS `require` path, not ESM `import`. The shared layer loads those clients
via `createRequire` so their spans actually appear. See
[testbed/packages/shared/src/redis.ts](testbed/packages/shared/src/redis.ts).

## Working docs

- [todo.md](todo.md) — what's done (`[x]`) and the enhancement backlog.
- [docs/](docs/) — detailed docs: [architecture](docs/architecture.md), the
  [event model](docs/event-model.md), and [Shopwave events](docs/shopwave-events.md)
  (per-action message payloads and traces).
- [CLAUDE.md](CLAUDE.md) — short architecture overview and how we work here.
- [plan.md](plan.md) — LiveProbe plan and its Phase 1 contract.
- [plan-testbed.md](plan-testbed.md) — Shopwave testbed plan and contract.
- [IMPLEMENT.md](IMPLEMENT.md) — decision-to-code audit trail.
- [CHANGELOG.md](CHANGELOG.md) — timestamped functional changes.
- [LOOPS.md](LOOPS.md) — engineering principles this project runs under.
