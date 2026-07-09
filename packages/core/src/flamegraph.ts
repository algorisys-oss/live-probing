// Minimal span shape the aggregator needs — satisfied by both a normalized Event and a
// stored SpanRow, so it can fold either the live window or history without adapters.
export interface FlameSpan {
  spanId: string;
  parentSpanId?: string;
  operation: string;
  participant: string;
  duration: number; // micros
}

// One node of the aggregate flamegraph: the same operation-path merged across every trace,
// with total time, self time (total minus what its children cover), and how many traces hit it.
export interface FlameNode {
  operation: string;
  participant: string;
  totalMicros: number;
  selfMicros: number;
  count: number;
  children: FlameNode[];
}

// In-memory key for merging same participant+operation siblings. Unit-separator delimiter is
// safe here (in-memory Map key only — never written to disk, unlike the edge-separator trap).
const key = (s: FlameSpan) => `${s.participant}␟${s.operation}`;

function emptyNode(operation: string, participant: string): FlameNode {
  return { operation, participant, totalMicros: 0, selfMicros: 0, count: 0, children: [] };
}

/**
 * Aggregate many traces of one endpoint into a single flamegraph: where does this endpoint
 * spend its time on average, not in one waterfall. Spans are merged by their path (each node's
 * position under its parent chain), so the same operation called under different parents stays
 * distinct. Pure — a projection of the span trees, order-independent.
 */
export function aggregateFlamegraph(traces: FlameSpan[][]): FlameNode {
  const root = emptyNode("", "");

  const addSpan = (
    parentNode: FlameNode,
    span: FlameSpan,
    childrenOf: Map<string, FlameSpan[]>,
    childIndex: Map<FlameNode, Map<string, FlameNode>>,
  ) => {
    let index = childIndex.get(parentNode);
    if (!index) {
      index = new Map();
      childIndex.set(parentNode, index);
    }
    const k = key(span);
    let node = index.get(k);
    if (!node) {
      node = emptyNode(span.operation, span.participant);
      index.set(k, node);
      parentNode.children.push(node);
    }
    node.totalMicros += Math.max(0, span.duration);
    node.count += 1;
    for (const child of childrenOf.get(span.spanId) ?? []) {
      addSpan(node, child, childrenOf, childIndex);
    }
  };

  const childIndex = new Map<FlameNode, Map<string, FlameNode>>();
  for (const spans of traces) {
    const ids = new Set(spans.map((s) => s.spanId));
    const childrenOf = new Map<string, FlameSpan[]>();
    for (const s of spans) {
      if (s.parentSpanId && ids.has(s.parentSpanId)) {
        const list = childrenOf.get(s.parentSpanId);
        if (list) list.push(s);
        else childrenOf.set(s.parentSpanId, [s]);
      }
    }
    // A trace's roots: spans with no parent, or whose parent isn't in this trace.
    const roots = spans.filter((s) => !s.parentSpanId || !ids.has(s.parentSpanId));
    for (const r of roots) addSpan(root, r, childrenOf, childIndex);
  }

  // Self time = a node's total minus the total its children cover.
  const finalizeSelf = (node: FlameNode) => {
    let childTotal = 0;
    for (const c of node.children) {
      finalizeSelf(c);
      childTotal += c.totalMicros;
    }
    node.selfMicros = Math.max(0, node.totalMicros - childTotal);
  };
  for (const c of root.children) finalizeSelf(c);

  return root;
}
