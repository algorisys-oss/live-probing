# Handoff

Current state and how to resume. Rolling doc — reflects the latest, not history (that's
`CHANGELOG.md`). Updated after every task.

## Last task
Built **span waterfall + attribute drill-down** on the trace page. Server: `detail()` now
includes `spans` (flattened trace tree with timing + attributes) — `packages/server/src/summary.ts`.
UI: `waterfall-view.tsx` (Gantt bars nested by depth, colored per service, red on error) with a
click-to-open span-detail panel (attributes/kind/status/timing); trace page gained
Waterfall/Sequence tabs. Typecheck + 10 tests pass, UI builds. **Not yet browser-verified against
real spans** — needs a fresh trace (span capture is new, so only traces ingested after a server
restart carry spans).

## Current state
LiveProbe is a working MVP, end to end, verified against the live testbed.

- **LiveProbe** (`packages/`): OTLP ingest → in-memory window + SQLite history → REST + ws →
  React UI. Views: live flow (zoom-to-fit) + trace list, dedicated trace page, daily dashboard
  (`/history`, `/day/:date`), and search (`/search` + header box). Pause control on the feed.
- **Testbed** (`testbed/`): 8-service e-commerce (gateway, auth, catalog, cart, order +
  payment/inventory/notification workers) over Postgres/Redis/RabbitMQ, OTel-instrumented; a
  checkout is one connected trace across all of it. Collector fans OTLP to Jaeger + LiveProbe.
- **Tests**: 10 (core + server) pass; typecheck clean. UI verified in a headless browser.
- Nothing known broken.

## How to run / verify
```bash
./dev.sh              # hot reload; open http://localhost:5173  (API/ws on :4319)
./dev.sh --static     # build + serve the UI from the server at http://localhost:4319
npm test              # core + server tests
./stop.sh             # tear down (--wipe drops data)
```
Ports and details: `README.md`. Jaeger (reference) at http://localhost:16687. Sample login:
`alice@shopwave.test` / `password123`.

## Next
**In progress (continuing later): client integration via adapters.** Design is written up in
`docs/integration-adapters.md` — read it first. Summary: client apps (polyglot) emit a
client-specific instrumentation format over a transport (client-1 → RabbitMQ, another →
stdout). Plan is a collector with pluggable **sources** (rabbitmq / stdout / http) × **adapters**
(per client format, e.g. `adapter-id-1`) that map `raw → Event[]` and POST to a new native
`/v1/events` ingest. MVP to build: (1) `POST /v1/events`, (2) collector with rabbitmq + stdout
sources, (3) `adapter-id-1` mapping, (4) verify end to end. Open questions listed in that doc
(message granularity, sidecar vs single collector, whether to include per-span duration in v1).

Other backlog (see `todo.md`): span waterfall + attribute drill-down on the trace page;
clickable service nodes → a service page; search by span attribute.

## Gotchas
- **ioredis / amqplib** in the testbed are loaded via `createRequire` because OTel only hooks
  the CommonJS require path, not ESM import — otherwise their spans vanish.
- **OTLP ingest is gzip-aware**: the `otlphttp` exporter compresses by default; the server
  gunzips. Don't remove that.
- **T5 wiring**: the collector reaches the host via `host.docker.internal` (host-gateway added
  to the collector). LiveProbe runs on the host, testbed in Docker — kept decoupled.
- **Host ports** use a private range (55432/56379/55672/15673/16687/24317-8) to avoid clashing
  with other stacks on the machine.
- **Two SQLite writers**: only run one LiveProbe server against `packages/server/data`.
