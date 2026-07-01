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

export interface TraceDetail {
  summary: TraceSummary;
  sequence: Sequence;
  mermaidSequence: string;
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
