// The normalized interaction event. Every diagram LiveProbe draws is a projection of a
// stream of these, so this is the single source of truth. One event == one span.

export type SpanKind = "client" | "server" | "producer" | "consumer" | "internal";
export type SpanStatus = "ok" | "error" | "unset";

export interface Event {
  traceId: string;
  spanId: string;
  parentSpanId?: string; // absent for a trace root
  participant: string; // logical name of the side doing this span's work (the service)
  peer?: string; // the other side for client/producer/consumer spans (service or datastore)
  operation: string; // span name / method / route
  kind: SpanKind;
  startTime: number; // epoch microseconds
  duration: number; // microseconds
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
}

// Peers that are infrastructure rather than services. Used to decide when an edge or a
// message points at a datastore node vs another service.
export const DATASTORE_SYSTEMS: ReadonlySet<string> = new Set([
  "postgresql",
  "mysql",
  "redis",
  "rabbitmq",
  "amqp",
  "kafka",
  "mongodb",
  "memcached",
  "elasticsearch",
]);
