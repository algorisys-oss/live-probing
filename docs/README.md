# LiveProbe docs

Detailed docs for the two halves of this repo.

- [architecture.md](architecture.md) — how the whole system fits together: the LiveProbe
  pipeline (ingest → window → projections → UI), the testbed, and how they connect.
- [event-model.md](event-model.md) — the normalized `Event` structure field by field, how
  OTLP spans map onto it, and how the topology and sequence diagrams are derived from it.
- [live-views.md](live-views.md) — what the homepage **Live** tab shows: the flow/topology
  graph as a rolling-window aggregate (nodes, edges, ghost peers, the two edge numbers) vs.
  the per-trace sequence list, and how live differs from the persisted History view.
- [shopwave-events.md](shopwave-events.md) — the e-commerce testbed: every HTTP action, the
  RabbitMQ messages published on each action, their exact payload structure, and the trace
  each user action produces.
- [integrating-your-app.md](integrating-your-app.md) — **start here to wire your own system in.**
  How any app (dockerized or not, Node or polyglot, greenfield or already-instrumented) emits
  into LiveProbe: the OTLP/JSON fact, when you need a collector, and copy-paste recipes.
- [integration-adapters.md](integration-adapters.md) — how to feed client apps into LiveProbe:
  the adapter layer (client format → `Event[]`) and the collector (rabbitmq / stdout sources).
  **MVP built and verified** (see the status note at the top of that doc).
- [implementation-review.md](implementation-review.md) — 2026-07-02 review of the ingest path
  and the zero-instrumentation story (React / Node / Elixir): findings, per-stack intrusion
  floors, and the partial-rollout blind spot. Actionable items mirrored in `todo.md`.

Planning / contract specs (the testable "done" checklists):

- [plan.md](plan.md) — LiveProbe phased plan and the MVP/Phase-1 contract.
- [plan-testbed.md](plan-testbed.md) — the Shopwave testbed plan and its contract.
- [feature-scope.md](feature-scope.md) — near-term feature backlog, scoped (effort, approach, files).

Top-level [CLAUDE.md](../CLAUDE.md) is the short architectural overview; these go deeper.
The rolling project-state and audit docs stay at the repo root: `HANDOFF.md`, `todo.md`,
`IMPLEMENT.md`, `CHANGELOG.md`.
