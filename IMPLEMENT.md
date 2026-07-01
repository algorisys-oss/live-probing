# IMPLEMENT

Decision-to-code audit trail (LOOPS rule XXV). Newest first.

## [2026-07-01] Testbed (Shopwave) planned and committed

**Discussed:** a full-featured full-stack app to test LiveProbe against, "as real as
possible," using Docker for Postgres, Redis, and RabbitMQ.

**Decided (via four confirmed forks):**
- Domain: e-commerce order pipeline.
- Frontend: lean but real React SPA (core journey, no admin/polish).
- Service breadth: full 8-service pipeline in the first build.
- Language: all services Node/TS. Instrumented with standard OpenTelemetry, not our SDK,
  so the testbed is an honest, independent trace source.
- Stack also runs Jaeger (reference oracle, rule XXXVII) and an OTel collector, so adding
  LiveProbe as a trace target later is a one-line config change.

**Implemented so far:** planning only.
- `plan-testbed.md` — architecture, services, infra, 14-item contract, phased tasks T0–T5.
- `plan.md` — `demo-services` task marked superseded by the testbed.

**Status:** planned and committed to git (genesis commit). Not built. Testbed T0 (infra +
gateway/catalog end to end in Jaeger) and LiveProbe `event-model` are the two independent
starting points.

**Files created/changed:** plan-testbed.md, plan.md, IMPLEMENT.md, CHANGELOG.md, .gitignore.

## [2026-07-01] Project shape and Phase 1 scope decided

**Discussed:** a utility to create realtime sequence and flow diagrams of running
systems. Brainstormed the design space and chose the direction.

**Decided:**
- Observe behavior at runtime, do not parse source.
- Data source: hybrid — OTLP wire format for the OpenTelemetry ecosystem plus a tiny
  drop-in SDK for systems with no tracing yet.
- Delivery: live-first (websocket to a browser UI), snapshot export secondary.
- Language: core and first SDK in TypeScript/Node. Polyglot achieved through the OTLP
  wire format, not multiple core runtimes. Python SDK in Phase 2 proves it.
- Diagrams: both sequence (per trace) and flow/topology (aggregate window), as two
  projections of one normalized event model.
- Renderer: custom, for smooth incremental redraws under continuous input.

**Implemented so far:** documentation only.
- `CLAUDE.md` — architecture, core event model, decisions, layout, working rules.
- `plan.md` — phased plan and the Phase 1 contract (21 testable criteria).
- `IMPLEMENT.md` — this file.

**Status:** planning complete, Phase 1 not started. Next task per `plan.md` is
`event-model` (the normalized Event type + native-batch normalizer, TDD).

**Files created:** CLAUDE.md, plan.md, IMPLEMENT.md.
