export interface TraceSummary {
  traceId: string;
  rootOperation: string;
  services: string[];
  spanCount: number;
  startTime: number;
  durationMicros: number;
  hasError: boolean;
}

export interface Edge {
  from: string;
  to: string;
  calls: number;
  errors: number;
  avgDurationMicros: number;
}

export interface Topology {
  nodes: string[];
  edges: Edge[];
}

export interface Message {
  from: string;
  to: string;
  label: string;
  startTime: number;
  durationMicros: number;
  status: string;
  async: boolean;
}

export interface Sequence {
  participants: string[];
  messages: Message[];
}

export interface SpanRow {
  spanId: string;
  parentSpanId?: string;
  depth: number;
  participant: string;
  operation: string;
  kind: string;
  status: string;
  startTime: number; // absolute micros
  duration: number; // micros
  peer?: string;
  attributes: Record<string, string | number | boolean>;
}

export interface TraceDetail {
  summary: TraceSummary;
  sequence: Sequence;
  mermaidSequence: string;
  spans: SpanRow[];
}

export interface DayInfo {
  day: string;
  requests: number;
  errors: number;
}

export interface EndpointRollup {
  operation: string;
  calls: number;
  errors: number;
  avgMicros: number;
  maxMicros: number;
}

export interface ThroughputBucket {
  minute: number;
  count: number;
  errors: number;
}

export interface DaySummary {
  day: string;
  requests: number;
  errors: number;
  errorRate: number;
  p50Micros: number;
  p95Micros: number;
  p99Micros: number;
  throughput: ThroughputBucket[];
  topEndpoints: EndpointRollup[];
  slowest: TraceSummary[];
}

export type WsMessage =
  | {
      type: "snapshot";
      traces: TraceSummary[];
      topology: Topology;
      mermaidFlow: string;
    }
  | { type: "traces"; traces: TraceSummary[] }
  | { type: "topology"; topology: Topology; mermaidFlow: string };

export interface ErrorGroup {
  endpoint: string;
  label: string;
  count: number;
  lastSeen: number; // micros
  sampleTraceId: string;
}

export interface ServiceOperation {
  operation: string;
  calls: number;
  errors: number;
  avgMicros: number;
}

export interface ServiceDetail {
  name: string;
  spans: number;
  errors: number;
  errorRate: number;
  inbound: string[];
  outbound: string[];
  operations: ServiceOperation[];
}

export interface LatencyBucket {
  minute: number; // epoch minutes (UTC)
  count: number;
  p50: number;
  p95: number;
  p99: number;
}
