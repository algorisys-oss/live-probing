import type { AssembledTrace, TraceNode } from "./trace-window.js";

// The critical path is the chain of spans that determines the trace's end time: shortening a
// span *on* it shortens the whole trace, shortening one *off* it (work that ran concurrently in
// another span's shadow) does not. Computed by sweeping backward from each node's end — the
// last child to finish is on the path, then the last child to finish before *that* one started,
// and so on; the gaps between them are the node's own (self-time) contribution.

const endOf = (n: TraceNode): number => n.event.startTime + n.event.duration;

function walk(node: TraceNode, set: Set<string>): void {
  set.add(node.event.spanId);
  // Latest-ending child first; cursor starts at this node's end and marches backward.
  const kids = [...node.children].sort((a, b) => endOf(b) - endOf(a));
  let cursor = endOf(node);
  for (const child of kids) {
    // A child is on the path only if it finished at/before the cursor (i.e. it wasn't running
    // concurrently inside an already-critical sibling's span).
    if (endOf(child) <= cursor) {
      walk(child, set);
      cursor = child.event.startTime;
    }
  }
}

export function criticalPath(trace: AssembledTrace): string[] {
  const set = new Set<string>();
  for (const root of trace.roots) walk(root, set);
  return [...set];
}
