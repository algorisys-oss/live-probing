import type { AssembledTrace, TraceNode } from "@liveprobe/core";
import { criticalPath, sequenceFor, toMermaidSequence, type Sequence } from "@liveprobe/core";

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

// One span, flattened for the waterfall. `depth` is its nesting level in the trace tree.
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

// Depth-first flatten of the trace tree, preserving the assembled child order.
function flattenSpans(trace: AssembledTrace): SpanRow[] {
  const rows: SpanRow[] = [];
  const walk = (node: TraceNode, depth: number) => {
    const e = node.event;
    rows.push({
      spanId: e.spanId,
      parentSpanId: e.parentSpanId,
      depth,
      participant: e.participant,
      operation: e.operation,
      kind: e.kind,
      status: e.status,
      startTime: e.startTime,
      duration: e.duration,
      peer: e.peer,
      attributes: e.attributes,
    });
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of trace.roots) walk(root, 0);
  return rows;
}

export interface TraceDetail {
  summary: TraceSummary;
  sequence: Sequence;
  mermaidSequence: string;
  spans: SpanRow[];
  criticalPath: string[]; // span ids on the critical path (determine the trace's end time)
}

export function detail(trace: AssembledTrace): TraceDetail {
  const sequence = sequenceFor(trace);
  return {
    summary: summarize(trace),
    sequence,
    mermaidSequence: toMermaidSequence(sequence),
    spans: flattenSpans(trace),
    criticalPath: criticalPath(trace),
  };
}
