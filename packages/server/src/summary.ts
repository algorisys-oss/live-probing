import type { AssembledTrace } from "@liveprobe/core";
import { sequenceFor, toMermaidSequence, type Sequence } from "@liveprobe/core";

export interface TraceSummary {
  traceId: string;
  rootOperation: string;
  services: string[];
  spanCount: number;
  startTime: number; // micros
  durationMicros: number;
  hasError: boolean;
}

export function summarize(trace: AssembledTrace): TraceSummary {
  const services = new Set<string>();
  let hasError = false;
  for (const e of trace.events) {
    services.add(e.participant);
    if (e.status === "error") hasError = true;
  }
  return {
    traceId: trace.traceId,
    rootOperation: trace.roots[0]?.event.operation ?? "",
    services: [...services],
    spanCount: trace.events.length,
    startTime: trace.start,
    durationMicros: trace.end - trace.start,
    hasError,
  };
}

export interface TraceDetail {
  summary: TraceSummary;
  sequence: Sequence;
  mermaidSequence: string;
}

export function detail(trace: AssembledTrace): TraceDetail {
  const sequence = sequenceFor(trace);
  return {
    summary: summarize(trace),
    sequence,
    mermaidSequence: toMermaidSequence(sequence),
  };
}
