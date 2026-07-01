# LiveProbe docs

Detailed docs for the two halves of this repo.

- [architecture.md](architecture.md) — how the whole system fits together: the LiveProbe
  pipeline (ingest → window → projections → UI), the testbed, and how they connect.
- [event-model.md](event-model.md) — the normalized `Event` structure field by field, how
  OTLP spans map onto it, and how the topology and sequence diagrams are derived from it.
- [shopwave-events.md](shopwave-events.md) — the e-commerce testbed: every HTTP action, the
  RabbitMQ messages published on each action, their exact payload structure, and the trace
  each user action produces.
- [integration-adapters.md](integration-adapters.md) — how to feed client apps into LiveProbe:
  the adapter layer (client format → `Event[]`) and the collector (rabbitmq / stdout sources).
  **Design, not built yet.**

Top-level [CLAUDE.md](../CLAUDE.md) is the short architectural overview; these go deeper.
