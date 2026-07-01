# LiveProbe — Plan

Live sequence and flow diagrams of running systems. See `CLAUDE.md` for architecture.

## Goal

A person runs LiveProbe alongside their system, opens a browser, and watches real
requests flow through it as a live sequence diagram (per trace) and a live topology
diagram (aggregate), then exports either to Mermaid or D2.

**Phase 1 success criterion:** with the demo services running, the browser shows live
sequence and flow diagrams that update as traffic flows, and a snapshot exports to valid
Mermaid. Proven programmatically, not by eyeballing.

---

## Phase 1 — MVP vertical slice

TypeScript core, JS SDK, native JSON ingest, live UI with both views, Mermaid export,
demo app. Goal is one thin slice through the whole pipe, not breadth.

### The contract (testable "done", grade against this — rule XXIX)

Normalizer / event model
1. A native event batch maps to `Event[]` with every field populated per the schema.
2. A missing `parentSpanId` marks the span as a trace root; a present one links to parent.
3. Unknown `kind` rejects with a clear error; it does not silently default.
4. `status` derives from the source signal; absent status becomes `unset`, not `ok`.

Window / session manager
5. Events for one `traceId` assemble into a single ordered span tree.
6. Out-of-order arrival (child before parent) still assembles correctly once the parent lands.
7. The rolling window evicts traces older than the configured horizon and frees them.
8. A late event for an evicted trace is dropped, not resurrected into a half tree.

Sequence projection
9. A client span paired with its server child produces one request arrow and one response arrow.
10. An internal span with no peer produces a self-activation, not a phantom participant.
11. Participants are de-duplicated by logical name across a trace.
12. Arrow order follows `startTime`, ties broken deterministically.

Flow / topology projection
13. Repeated calls between the same two participants collapse to one edge with a count.
14. Edge carries error count and a latency stat (at least mean) over the window.
15. A participant that only ever receives still appears as a node.

Transport / live
16. `POST /v1/events` accepts a JSON batch and returns 2xx; malformed body returns 4xx.
17. A connected websocket client receives a delta within one window tick of ingest.
18. Two browser clients connected at once both receive the same deltas.

Export
19. Exporting a trace produces Mermaid `sequenceDiagram` text that parses without error.
20. Exporting the window produces Mermaid or D2 flow text that parses without error.

End to end
21. With demo services running, ingest is non-empty and both views render live.

### Tasks

```
Task: event-model
  Files: packages/core/src/event.ts, packages/core/test/event.test.ts
  Action: define Event type + native-batch normalizer + validation
  Verify: contract 1–4 pass
  Done: normalizer is a pure function with full test coverage of the schema

Task: window-manager
  Files: packages/core/src/window.ts, test/window.test.ts
  Action: assemble spans into trace trees, rolling eviction, topology aggregation
  Verify: contract 5–8, 13–15 pass
  Done: crash-safe in the sense that it holds only the window, no unbounded growth

Task: sequence-projection
  Files: packages/core/src/sequence.ts, test/sequence.test.ts
  Action: trace tree → ordered messages + participants
  Verify: contract 9–12 pass
  Done: pure function trace → sequence model

Task: exporters
  Files: packages/core/src/export/mermaid.ts, export/d2.ts, test/export.test.ts
  Action: sequence model → Mermaid; topology → Mermaid/D2 text
  Verify: contract 19–20 pass (assert output parses)
  Done: round-trip a known trace to known-good text (oracle test)

Task: collector-server
  Files: packages/server/src/index.ts, test/server.test.ts
  Action: http POST /v1/events ingest + ws live server + static UI host
  Verify: contract 16–18 pass
  Done: server starts, ingests, broadcasts deltas, serves the UI bundle

Task: sdk-js
  Files: packages/sdk-js/src/index.ts, test/sdk.test.ts
  Action: trace() wrapper, fetch/http shim, batched emitter to /v1/events
  Verify: wrapping a call emits a well-formed native event batch
  Done: dropping the SDK into a plain function produces spans with no other changes

Task: ui
  Files: packages/ui/src/*, built to packages/server static dir
  Action: live ws client, sequence renderer (SVG lifelines), flow renderer (graph)
  Verify: renders live against the demo; rAF-batched redraw, dirty-region only
  Done: both views update live and stay smooth under demo traffic (rule XXXIX)

Task: demo-services  (SUPERSEDED — see plan-testbed.md)
  The 3–4 service placeholder is replaced by the Shopwave testbed: a real full-stack
  e-commerce order pipeline with Postgres, Redis, RabbitMQ, Jaeger, and an OTel collector.
  It is OTel-instrumented, so LiveProbe consumes it via OTLP (Phase 2). Contract item 21
  is satisfied by Shopwave. See plan-testbed.md.
```

---

## Phase 2 — Ecosystem and polyglot

- OTLP ingest (OTLP/HTTP first, then gRPC): map `ResourceSpans` to `Event[]`. Any
  OpenTelemetry-instrumented app works with zero LiveProbe SDK.
- Python SDK emitting to the same core. This is the proof that "polyglot" is real: the TS
  core renders a Python service's traces with no special-casing.
- Differential test: same logical trace from the JS SDK, the Python SDK, and OTLP should
  normalize to the same `Event[]` (rule XXXVII).

## Phase 3 — Depth

- Replay and persistence: record a window to disk, scrub through it.
- Filtering and search: by participant, operation, error, latency threshold.
- Richer topology metrics: latency percentiles, error rates, throughput per edge.
- Sampling and backpressure for high-volume systems.

---

## Decisions log

- Core + first SDK in TypeScript/Node. Polyglot via OTLP wire format, not multiple core
  runtimes. Revisit only if the core needs to live where JS cannot.
- Native JSON ingest before OTLP: fastest path to a live demo.
- Live-first, snapshot export secondary.
- Custom renderer over a diagram library, for smooth incremental redraws.

## Open questions

- Flow-view layout: force-directed (d3-force) vs layered. Decide when the flow renderer
  is built, against real demo topology.
- Native event wire shape vs OTLP shape: keep them close so the normalizer shares code.
- Window horizon default and per-trace memory cap: set from demo measurements, not guessed.
