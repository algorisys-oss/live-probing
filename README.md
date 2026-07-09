# LiveProbe

Live sequence and flow diagrams of running systems, drawn from observed runtime behavior
rather than parsed source. Point it at a system, watch requests flow through it as a live
sequence diagram (per trace) and a live topology diagram (aggregate), export either to
Mermaid or D2.

This repo has two parts:

- **LiveProbe** — the tool. Consumes OTLP traces, assembles them into a rolling window,
  and serves live sequence (per trace) and flow/topology (aggregate) diagrams over a
  websocket, plus Mermaid export. Lives in [packages/](packages/). See [docs/plan.md](docs/plan.md).
- **Shopwave testbed** — a real full-stack e-commerce system with Postgres, Redis,
  RabbitMQ, and OpenTelemetry, used as an honest trace source. Lives in [testbed/](testbed/).
  See [docs/plan-testbed.md](docs/plan-testbed.md).

## Status

| Part                                                                           | State                                |
| ------------------------------------------------------------------------------ | ------------------------------------ |
| LiveProbe core (event model, OTLP normalizer, trace window, sequence, Mermaid) | **done, tested**                     |
| LiveProbe server (OTLP ingest + REST + websocket)                              | **done, tested**                     |
| LiveProbe UI (React + zustand live dashboard: flow + sequence views)           | **done**                             |
| Testbed T0–T4 (full 8-service system + SPA + load gen)                         | **done, verified**                   |
| Testbed T5 (OTel collector -> LiveProbe)                                       | **done, verified with live traffic** |

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

| Email                 | Password      |
| --------------------- | ------------- |
| `alice@shopwave.test` | `password123` |
| `bob@shopwave.test`   | `password123` |
| `carol@shopwave.test` | `password123` |

```bash
curl -s -X POST localhost:3000/api/login -H 'content-type: application/json' \
  -d '{"email":"alice@shopwave.test","password":"password123"}'
```

Signing up new accounts still works too; the seed is idempotent and never overwrites them.

### Ports (host side)

| Service             | URL / port                                                  |
| ------------------- | ----------------------------------------------------------- |
| Storefront SPA      | http://localhost:8088 (start with `--profile ui`)           |
| Gateway API         | http://localhost:3000                                       |
| Auth API            | http://localhost:3001                                       |
| Catalog API         | http://localhost:3002                                       |
| Cart API            | http://localhost:3003                                       |
| Order API           | http://localhost:3004                                       |
| Payment worker      | http://localhost:3005/healthz                               |
| Inventory worker    | http://localhost:3006/healthz                               |
| Notification worker | http://localhost:3007/healthz                               |
| Jaeger UI           | http://localhost:16687                                      |
| OTLP collector      | localhost:24317 (gRPC), 24318 (HTTP)                        |
| Postgres            | localhost:55432                                             |
| Redis               | localhost:56379                                             |
| RabbitMQ            | localhost:55672 (amqp), http://localhost:15673 (management) |

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

## Running LiveProbe (development)

One command brings up the whole thing — testbed, traffic, and LiveProbe — with **hot reload
by default**:

```bash
./dev-start.sh
# then open http://localhost:5173
```

In this default (watch) mode: the **UI runs under Vite with HMR** at http://localhost:5173
(edits apply instantly), the **LiveProbe server** runs under `tsx watch` (restarts on
server/core changes), and the **testbed services** run under `tsx watch` too (via
`testbed/docker-compose.dev.yml`, which bind-mounts the source). Edit any source and it
reloads. The API/ws stays on :4319.

For a demo / non-dev run, build the UI once and serve it statically from the server:

```bash
./dev-start.sh --static   # then open http://localhost:4319
```

To run **only the LiveProbe server** (UI + ingest, no testbed) — e.g. on a machine where a
real app is the trace source:

```bash
./serve.sh                # builds the UI if missing; serves on :4319
./serve.sh --collector    # also run the algo-instrumentation collector on :4320
# env: PORT, DB_PATH, RETENTION_DAYS (default 30), LIVE_WINDOW_MINUTES (default 5),
#      MAX_TRACES (default 2000), COLLECTOR_PORT (--collector only, default 4320)
```

`serve.sh` alone speaks OTLP + already-normalized native events. Apps that emit the internal
instrumentation-service format (`/v1/event/*`, module/function granularity) POST to the
**collector**, which maps them to Events — add `--collector` and point that emitter at `:4320`,
otherwise that richer stream is silently dropped.

`--no-load` skips the traffic generator; `--no-build` (static mode) reuses the last UI build.
Stop everything with one script:

```bash
./dev-stop.sh           # stop the LiveProbe server + tear down the Docker stack
./dev-stop.sh --wipe    # also drop the Postgres data
```

Or do it manually:

```bash
# 1. Start the testbed (it exports OTLP to a collector that fans out to Jaeger + LiveProbe)
cd testbed && docker compose up -d --build && cd ..

# 2. Start the LiveProbe server (OTLP ingest on :4319, REST + ws)
npm install
PORT=4319 npx tsx packages/server/src/index.ts
#   env: DB_PATH=<file> (history db location), RETENTION_DAYS=N (keep the N most recent
#   UTC days of history; default 30, 0 disables — pruned at startup and hourly),
#   LIVE_WINDOW_MINUTES=N (live streaming window, default 5), MAX_TRACES=N (live memory cap,
#   default 2000)

# 3. Generate traffic and watch LiveProbe fill up
cd testbed && docker compose --profile load up -d loadgen && cd ..
curl -s http://localhost:4319/api/topology | python3 -m json.tool   # live service graph
curl -s "http://localhost:4319/api/traces?limit=5"                  # recent traces
```

The testbed collector is already wired to export OTLP/JSON to LiveProbe on the host
(`host.docker.internal:4319`) in
[testbed/otel/collector-config.yaml](testbed/otel/collector-config.yaml). LiveProbe endpoints:

| Endpoint                 | What                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `POST /v1/traces`        | OTLP/HTTP ingest (gzip-aware)                                        |
| `POST /v1/events`        | native ingest — a batch of normalized events (what adapters produce) |
| `GET /api/traces?limit=` | recent trace summaries                                               |
| `GET /api/traces/:id`    | one trace: sequence model + Mermaid                                  |
| `GET /api/topology`      | aggregate service/datastore graph + Mermaid                          |
| `ws /ws`                 | live snapshot + deltas                                               |

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

## Running LiveProbe with Docker

Run LiveProbe in a container (UI + OTLP ingest + API + websocket). History is persisted in a
named volume.

```bash
docker compose up -d --build
# open http://localhost:4319
```

Optional profiles:

```bash
# Algo-instrumentation HTTP collector (same as ./serve.sh --collector)
docker compose --profile collector up -d

# OTel collector — accepts OTLP/protobuf from instrumented apps, forwards JSON to LiveProbe
docker compose --profile otel up -d
# point OTEL_EXPORTER_OTLP_ENDPOINT at http://localhost:4318
```

Environment variables (set in `.env` or the shell): `PORT` (default 4319), `RETENTION_DAYS`
(default 30 — how long a trace's waterfall/sequence stays viewable by id; `0` disables pruning),
`LIVE_WINDOW_MINUTES` (default 5 — the live real-time streaming window) and `MAX_TRACES`
(default 2000 — live in-memory trace cap), `COLLECTOR_PORT` (default 4320), `OTEL_GRPC_PORT` /
`OTEL_HTTP_PORT` (defaults 4317 / 4318). Tear down with `docker compose down` (add `-v` to drop
history). Network/security: `HOST` (default `127.0.0.1` — set `0.0.0.0` to expose to other
containers or a reverse proxy), `CORS_ORIGINS` (comma-separated browser origins allowed for CORS
and the live WebSocket, beyond loopback), `MASK_PII` (`off` disables the built-in PII/secret
scrubbing). See [Behind a reverse proxy](#behind-a-reverse-proxy-tls--basic-auth).

When LiveProbe runs in Docker and your app stack is in a separate compose project, point the
app's OTel collector at `http://<liveprobe-host>:4319` (or join both stacks on a shared Docker
network and use `http://liveprobe:4319`). The testbed's collector config uses
`host.docker.internal` for LiveProbe on the host — change
[testbed/otel/collector-config.yaml](testbed/otel/collector-config.yaml) to
`http://liveprobe:4319` if both run in Docker on the same network.

## Deploying LiveProbe to a remote server

Use [scripts/deploy.js](scripts/deploy.js) to ship a production build to a VPS or other host
over SSH. The script builds the image on your machine, uploads it as a tarball (no registry
required), rewrites `docker-compose.yml` to use the pre-built image instead of `build: .`, and
optionally runs `docker compose up -d` on the server.

```bash
npm run deploy
# or: node scripts/deploy.js
```

Run this from the **repo root** (where `docker-compose.yml` and the `Dockerfile` live).

### Prerequisites

**Local machine**

- Docker (your user must be able to run `docker` without `sudo`)
- `ssh` and `scp`
- Node.js 20+ (only to run the script; the server image is self-contained)

**Remote host**

- Docker and Docker Compose v2
- SSH access for your user (key-based auth recommended)
- Your user in the `docker` group (same as local — `docker` must work without `sudo`)
- A directory to deploy into (default `/var/www/liveprobe`)

One-time server setup example:

```bash
# on the server
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# log out and back in, then verify:
docker ps
```

Ensure you can reach the host from your laptop:

```bash
ssh -p 22 user@your-server.example.com
```

### Deployment flow

The script is interactive. It prompts for each value (press Enter to accept the default):

| Prompt                      | Default                   | Notes                                                             |
| --------------------------- | ------------------------- | ----------------------------------------------------------------- |
| Image version               | `latest`                  | Tag suffix only — e.g. `1.0.0` or `v1.2.3`, not `liveprobe:1.0.0` |
| Remote host                 | `your-server.example.com` | Hostname or IP                                                    |
| SSH username                | `root`                    | User with Docker access                                           |
| SSH port                    | `22`                      |                                                                   |
| Remote directory            | `/var/www/liveprobe`      | Created if missing                                                |
| Run `docker compose up -d`? | no                        | Answer `y` to start (or restart) services after upload            |

After a summary, confirm with `y` to proceed. The script then:

1. Builds `liveprobe:<version>` locally from the `Dockerfile`
2. Saves the image to a tarball
3. Opens one multiplexed SSH session (password asked at most once)
4. Uploads the tarball, a remote-ready `docker-compose.yml`, and `otel-collector-config.yaml`
5. Runs `docker load` on the server and removes the tarball
6. Optionally runs `docker compose up -d --no-build` in the remote directory

Example session:

```text
=== LiveProbe deploy ===

Image version [latest]: 1.0.0
Remote host [your-server.example.com]: prod.example.com
SSH username [root]: deploy
SSH port [22]:
Remote directory [/var/www/liveprobe]:
Run `docker compose up -d` on the remote host? [y/N]: y

Summary:
  Image            : liveprobe:1.0.0
  Remote host      : deploy@prod.example.com:22
  Remote directory : /var/www/liveprobe
  Run remote up    : yes

Proceed? [y/N]: y
```

### After deploy

On the server, LiveProbe listens on port **4319** by default (UI + OTLP/HTTP ingest + API +
websocket). History is stored in the `liveprobe-data` Docker volume.

```bash
ssh deploy@prod.example.com
cd /var/www/liveprobe

docker compose ps
docker compose logs -f liveprobe

# smoke test
curl -s http://localhost:4319/api/topology | head
```

Open `http://<your-server>:4319` in a browser (ensure the host firewall allows that port).

**Environment variables** — create `/var/www/liveprobe/.env` on the server before or after the
first `compose up` (same variables as local Docker):

```bash
PORT=4319
RETENTION_DAYS=30
# LIVE_WINDOW_MINUTES=5   # live real-time streaming window
# MAX_TRACES=2000         # live in-memory trace cap
# behind a reverse proxy (see the section below):
# HOST=0.0.0.0                                # expose beyond loopback
# CORS_ORIGINS=https://liveprobe.example.com  # exact browser origin(s) for CORS + WebSocket
# MASK_PII=off            # disable built-in PII/secret masking (not recommended)
# optional profiles:
# COLLECTOR_PORT=4320
# OTEL_GRPC_PORT=4317
# OTEL_HTTP_PORT=4318
```

Then restart: `docker compose up -d`.

**Optional compose profiles** (same as local):

```bash
cd /var/www/liveprobe
docker compose --profile collector up -d   # algo-instrumentation adapter on :4320
docker compose --profile otel up -d        # OTel collector on :4317/:4318 -> LiveProbe
```

Point instrumented apps at `http://<your-server>:4318` (OTel HTTP) or
`http://<your-server>:4319/v1/traces` (OTLP/JSON direct to LiveProbe).

### Behind a reverse proxy (TLS + basic auth)

LiveProbe has no auth of its own and binds `127.0.0.1` by default, so the usual production
shape is nginx terminating TLS + HTTP basic auth in front of it. Two things trip people up — the
**WebSocket** and LiveProbe's **origin check** — so both are spelled out here.

**1. LiveProbe env** — expose it to the proxy and allow the public origin:

```bash
HOST=0.0.0.0                               # bind all interfaces so nginx can reach it
CORS_ORIGINS=https://liveprobe.example.com # the EXACT browser origin (see note below)
```

`CORS_ORIGINS` must match the `Origin` the browser sends, character for character: scheme +
host + port, **no trailing slash, no path**. Include the port if you serve on a non-standard one
(`https://liveprobe.example.com:4321` is a *different* origin from `https://liveprobe.example.com`).
The live WebSocket upgrade is refused server-side unless its origin is loopback or listed here —
this is the #1 reason the feed stays blank behind a proxy.

**2. nginx** — proxy the WebSocket upgrade, and do **not** put basic auth on `/ws`:

```nginx
server {
    listen 443 ssl;                        # or another port; then use it in CORS_ORIGINS
    server_name liveprobe.example.com;
    # ... certbot TLS lines ...

    # UI + API: basic auth here is fine (normal requests carry cached credentials).
    location / {
        auth_basic           "LiveProbe";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass           http://127.0.0.1:4319;
        proxy_set_header     Host $http_host;
        proxy_set_header     X-Forwarded-Proto $scheme;
    }

    # Live WebSocket: NO basic auth — a browser can't send an auth header on the WS
    # handshake, so basic auth here means a failed upgrade and an auth prompt on every
    # route change. Protect it with an IP allow-list instead if you need to.
    location /ws {
        auth_basic         off;
        proxy_pass         http://127.0.0.1:4319;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $http_host;
        proxy_read_timeout 86400;          # keep the long-lived socket open
    }

    # Ingest from a remote instrumented app (algo/native/OTLP through the collector on :4320).
    # Lock it to the sending host; it must bypass basic auth (the emitter can't authenticate).
    location /v1/event/ {
        allow 203.0.113.10;                # your app's egress IP
        deny  all;
        proxy_pass         http://127.0.0.1:4320;
        proxy_http_version 1.1;
        proxy_set_header   Host $http_host;
        client_max_body_size 5m;
    }
}
```

`auth_basic off` on `/ws` is the fix for both a dead feed **and** repeated auth prompts. The
trade-off: the read-only trace stream is then reachable by any client that can hit the port
(LiveProbe's origin check stops other *browsers*, not a direct client). For a private/staging
box that's usually fine; add an `allow <ip>; deny all;` to the `/ws` block to lock it to known
operator IPs. Keep the `auth_basic` **realm string identical** across locations — differing
realms re-prompt on their own.

### Manual deploy steps

If you answer **no** to “Run `docker compose up`?”, the image and configs are still uploaded
and loaded. Start or upgrade on the server yourself:

```bash
cd /var/www/liveprobe
docker compose up -d --no-build
```

To redeploy a new version, run `npm run deploy` again with a new version tag. The script
overwrites `docker-compose.yml` and loads the new image; run `docker compose up -d --no-build`
to pick it up (or let the script do that for you).

### Troubleshooting

| Symptom                                            | Fix                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Cannot access Docker (permission denied)` locally | `sudo usermod -aG docker $USER`, then `newgrp docker`                                            |
| `ssh connect failed`                               | Check host, port, key, and that the user exists                                                  |
| `remote docker compose up failed`                  | SSH in and run `docker compose logs`; confirm Docker works for that user                         |
| UI loads but no traces                             | Open firewall for OTLP (4318/4319); point your app's `OTEL_EXPORTER_OTLP_ENDPOINT` at the server |
| Live feed blank behind a proxy / WS won't connect  | Set `CORS_ORIGINS` to the exact browser origin (with port), and proxy the WS upgrade in nginx    |
| Auth prompt on every route change (basic auth)     | Remove `auth_basic` from the `/ws` location — a browser can't authenticate the WS handshake      |

The remote host does **not** need the git repo or Node.js — only Docker, the compose file,
the collector config, and the loaded image.

## Working docs

- [todo.md](todo.md) — what's done (`[x]`) and the enhancement backlog.
- [docs/](docs/) — detailed docs: [architecture](docs/architecture.md), the
  [event model](docs/event-model.md), and [Shopwave events](docs/shopwave-events.md)
  (per-action message payloads and traces).
- [CLAUDE.md](CLAUDE.md) — short architecture overview and how we work here.
- [docs/plan.md](docs/plan.md) — LiveProbe plan and its Phase 1 contract.
- [docs/plan-testbed.md](docs/plan-testbed.md) — Shopwave testbed plan and contract.
- [IMPLEMENT.md](IMPLEMENT.md) — decision-to-code audit trail.
- [CHANGELOG.md](CHANGELOG.md) — timestamped functional changes.
- [LOOPS.md](LOOPS.md) — engineering principles this project runs under.
