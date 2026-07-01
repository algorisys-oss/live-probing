# Handoff

Current state and how to resume. Rolling doc — reflects the latest, not history (that's
`CHANGELOG.md`). Updated after every task.

## Last task
Added the handoff-doc convention to `CLAUDE.md` and created this file. Prior task: flow-graph
zoom-to-fit + pan/zoom, richer search filters, and hot-reload-by-default in `dev.sh`.
Latest commit: `cd6d250` (todo.md). All work is on `origin/main`.

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
See `todo.md` for the full backlog. Recommended next picks:
1. Span waterfall + attribute drill-down on the trace page.
2. Clickable service nodes → a service page.
3. Search by span attribute (userId, productId, http.status).

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
