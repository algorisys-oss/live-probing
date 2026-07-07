# The live views

The LiveProbe homepage (the **Live** tab) shows two things side by side, and they answer
different questions. Both are projections of the same event stream (see
[event-model.md](event-model.md)); they differ only in how they slice it.

- **Live Traces list** (left) — individual requests. Each row is one trace: a future
  *sequence* diagram (who called whom, in what order, one request).
- **Flow graph** (center) — the whole system aggregated. Every trace currently in the
  rolling window collapsed into one topology (who calls whom in general, with volume and
  latency).

This doc is mostly about the flow graph, because "what does the changing graph represent?"
is the common question.

## The flow graph: what it represents at any instant

> **An aggregate graph of the whole system, computed fresh from the in-memory rolling
> window — not one trace.**

It says: *across all the traffic I've seen recently, here's who called whom, how many times,
and how fast.* It is built by [`TraceWindow.topology()`](../packages/core/src/trace-window.ts),
which collapses every trace in the window into `participant → peer` edges and overlays them.

### The window *is* the "point in time"

The graph is live and moving because its source is a **rolling window**, not a cumulative
total:

- The window holds recent traces only — default **5-minute horizon**, capped at a max trace
  count (`TraceWindow` constructor: `horizon`, `maxTraces`).
- Traces older than the horizon are **evicted**; excess traces past the cap are dropped.
- As new traces stream in over WebSocket and old ones age out, edge counts and latencies
  shift.

So the graph is a **live moving average of your topology over the last few minutes** — not
an all-time count. Idle for longer than the horizon and edges fade out.

## Reading the elements

| Element | Meaning |
|---|---|
| **Node** | A service / participant (`client`, `hrms.dashboard`, `hrms.login`, …). |
| **Edge** | An aggregated call relationship. Stroke width scales with `log(calls)` — thicker = busier. |
| **Edge top number** | **Call count** in the window (e.g. `client → hrms.login` = `3`). |
| **Edge bottom number** | **Average duration** across those calls (e.g. `1.40s`). |
| **Datastore node** | e.g. `redis` — styled distinctly from services. |
| **Dashed / "ghost" node** | e.g. `database` — an **external/uninstrumented peer**: instrumented services call it, but it never reported spans of its own. Marks a partial-rollout blind spot — you see calls *into* it, not what it does (`externals` in `topology()`). |

## The mental model

```
Live Traces list  ──►  one traceId  ──►  sequence view (per-request order + timing)
Flow graph        ──►  whole window ──►  topology  (system shape + volume + latency)
```

Both come from the same normalized `Event` stream. The sequence view filters to a single
`traceId`; the flow view aggregates the window.

## Caveats

- **Edge latency is a plain average** (`totalDuration / calls`), so a single slow outlier
  skews an edge. There are no percentiles on the live graph.
- **Percentiles (p50/p95/p99) live on the History side only** — those are computed from the
  persisted SQLite history store (per UTC day), not from the live window. See
  [architecture.md](architecture.md) for the live-vs-history split.
- **The live window is in memory and not durable.** Restart the server and the flow graph
  starts empty; only the SQLite history survives (per-trace rows, retained for a rolling N
  days).
