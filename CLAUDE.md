# LiveProbe

Live sequence and flow diagrams of running systems.

Working name is **LiveProbe** (matches the directory). Renaming is cheap right now, so
if a better name lands, do it before the package is published.

## What this is

A tool that watches a *running* system and draws *live* diagrams of how it actually
behaves: sequence diagrams (who called whom, in what order, with timing) and flow /
topology diagrams (components as nodes, calls as edges, aggregated over a time window).

The core principle: **observed behavior, not parsed source.** Static tools read your
code and guess the call graph. LiveProbe shows what the system actually did at runtime,
including the paths that only appear under real load, real data, and real failures.

## Core model

Everything flows through one normalized event. Both diagram types are projections of
the same event stream, so there is exactly one source of truth.

```
Event {
  traceId       string
  spanId        string
  parentSpanId  string?        // absent for a root
  participant   string         // logical name of the side doing this span's work
  peer          string?        // the other side (set on client/producer spans)
  operation     string         // span name / method / route
  kind          "client" | "server" | "producer" | "consumer" | "internal"
  startTime     number         // epoch microseconds
  duration      number         // microseconds
  status        "ok" | "error" | "unset"
  attributes    Record<string, string | number | boolean>
}
```

- **Sequence view** (single trace): rebuild the span tree from parentSpanId, order by
  startTime, pair client and server spans into request/response arrows, render
  participants as lifelines.
- **Flow view** (aggregate window): collapse events into participant to peer edges that
  carry call counts, error rates, and latency, animated as new events arrive.

OpenTelemetry span semantics are the reference oracle for how `kind` maps to arrow
direction (LOOPS rule XXXVII). Map to OTel, do not invent a parallel taxonomy.

## Pipeline

```
  SDK (JS)  ─┐
  OTel app  ─┼─► Collector ─► Normalizer ─► Window/Session ─┬─► WebSocket ─► Browser UI
  (OTLP)    ─┘   (ingest)     (→ Event)      manager        │   (live)       ├─ sequence
                                              │             │                └─ flow/topology
                                              └─ topology ───┘
                                                 aggregator
                                                            └─► Exporters (Mermaid / D2)
```

## Key decisions (and why)

- **Core + first SDK in TypeScript / Node.** The live UI is JavaScript in the browser
  no matter what, so one language for collector, server, SDK, and UI keeps the MVP small.
- **Polyglot lives in the wire format, not four runtimes.** We speak OTLP so any
  OpenTelemetry-instrumented app in any language works. A Python SDK in Phase 2 proves it.
- **Hybrid ingest.** Native JSON events for a zero-instrumentation quick start, OTLP for
  the ecosystem. Native lands first (fastest path to a live demo), OTLP second.
- **Live-first delivery.** WebSocket pushes event and topology deltas to the browser and
  the diagram redraws in place. Snapshot export (Mermaid / D2) is the secondary path.
- **Custom renderer, not a diagram library.** Live update needs smooth incremental
  redraws. Under continuous input, performance is correctness (LOOPS rule XXXIX): batch
  to requestAnimationFrame, redraw the dirty region, never relayout per event.
- **Minimal dependencies.** Node built-in `http` for the server, `ws` for websockets,
  `node:test` for tests. A graph-layout dep (d3-force or similar) for the flow view is
  justified and called out explicitly. Nothing else without a written reason (rule VIII).

## Target layout

MVP builds a subset. Do not scaffold empty directories ahead of the code that fills them.

```
packages/
  core/     event model, window/session manager, topology aggregator, exporters
  server/   collector (native + OTLP ingest), live websocket server, static UI host
  sdk-js/   tiny JS/TS SDK: trace wrapper, fetch/http shim, event emitter
  ui/       browser app: sequence renderer, flow renderer, live client
examples/
  demo-services/  small multi-service app that generates live traffic to watch
```

## How we work here

`LOOPS.md` is the governing engineering doctrine for this project. Read it. It is the
system prompt, not a suggestion. The load-bearing rules for this codebase:

- **Scope lock (IV).** Only touch what the task requires. It is the #1 rule.
- **TDD (V, XII).** Tests first, failing then green. The normalized event model and the
  exporters are pure functions, so there is no excuse to skip them.
- **Contract first (XXIX).** `plan.md` holds the testable "done" checklist. Grade against
  it, do not rubber-stamp.
- **Disk, not context (XXX).** State lives in `plan.md`, `IMPLEMENT.md`, `CHANGELOG.md`.
- **Reference oracle (XXXVII).** OTel span semantics decide arrow direction.
- **Continuous input is correctness (XXXIX).** The renderer batches to rAF.

## Where to look

- `plan.md` — phased plan and the MVP contract (the testable success criteria).
- `IMPLEMENT.md` — decision-to-code audit trail. Start here to see what was decided.
- `CHANGELOG.md` — timestamped functional changes (starts with the first code).
- `LOOPS.md` — engineering principles and agent-loop doctrine.

## Commands

Filled in as they exist. Nothing to run yet; Phase 1 is not built.
