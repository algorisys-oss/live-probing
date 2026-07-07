import type { Message, Sequence } from "./types";

// Browser mirror of `packages/core/src/sequence-layout.ts` (the tested source of truth — keep
// the two in sync). The UI deliberately stays decoupled from the core package and mirrors its
// shapes here; this function is pure and has no runtime imports, so mirroring it is cheap.
//
// Turns a flat, time-ordered message list into a UML-style call/return layout: each
// synchronous call gets an activation bar on the callee's lifeline (from the call arrow down to
// its return), and rows are bracketed by nesting so a parent's return lands after its children.
// Nesting is inferred from time containment (a sync parent is active while its children run).
// Async messages are fire-and-forget: a call row, no return, no activation.

export interface LaidOutMessage extends Message {
  callRow: number;
  returnRow: number; // === callRow for async (no return drawn)
  depth: number; // activations already open on the callee lifeline (x-offset lane)
  group?: SequenceGroup; // set on a collapsed synthetic row and on an expanded group's lead row
  groupRole?: "collapsed" | "lead" | "member"; // how the renderer should treat this row's group
}

// A run of repeated sibling *leaf* calls with the same signature (same from→to, label, async).
// This is the shape an N+1 query (or any hot loop) makes in a trace: the same call fired N times.
// Collapsing it into one ×N row keeps the diagram readable AND names the problem — the fold is the
// finding, so it carries the count and aggregate timing rather than hiding them. Derived purely
// from the message stream; never persisted (it is a view projection, not an observed Event).
export interface SequenceGroup {
  id: string; // stable id (the earliest member's spanId), also used as the synthetic row's spanId
  signature: string; // from|to|label|async — what makes the members "the same call"
  from: string;
  to: string;
  label: string;
  async: boolean;
  count: number;
  spanIds: string[]; // members in start-time order (for expand + selection)
  totalDurationMicros: number; // sum of member durations — the work done in the loop
  spanMicros: number; // wall-clock: max(end) - min(start) across members
  minDurationMicros: number;
  maxDurationMicros: number;
  avgDurationMicros: number;
  errorCount: number; // members with status "error" — never silently folded away
  concurrent: boolean; // members overlap in time (fan-out) vs. strictly sequential (N+1 shape)
}

// Fold repeated sibling leaf calls into groups. A call that strictly contains another is a parent
// (it brackets children) and is never folded — only leaf runs collapse, so nesting is never hidden.
const GROUP_MIN = 3; // fewer than this reads fine as individual rows; don't fold pairs

function sig(m: Message): string {
  return `${m.from} ${m.to} ${m.label} ${m.async ? "a" : "s"}`;
}

function detectGroups(ordered: LaidOutMessage[]): SequenceGroup[] {
  const end = (m: LaidOutMessage) => m.startTime + m.durationMicros;
  // A message is a non-leaf if it strictly contains another (equal intervals contain neither).
  const isLeaf = ordered.map((m, i) =>
    !ordered.some((n, j) => {
      if (i === j) return false;
      const contains = m.startTime <= n.startTime && end(n) <= end(m);
      const strict = m.startTime < n.startTime || end(n) < end(m);
      return contains && strict;
    }),
  );

  const groups: SequenceGroup[] = [];
  // Walk maximal runs of consecutive leaf messages; within each run bucket by signature so an
  // interleaved cluster (dept/emp/dept/emp…) still yields one group per distinct call.
  let i = 0;
  while (i < ordered.length) {
    if (!isLeaf[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < ordered.length && isLeaf[j]) j++;
    const buckets = new Map<string, LaidOutMessage[]>();
    for (let k = i; k < j; k++) {
      const m = ordered[k]!;
      const key = sig(m);
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m);
    }
    for (const members of buckets.values()) {
      if (members.length < GROUP_MIN) continue;
      groups.push(summarize(members));
    }
    i = j;
  }
  return groups;
}

function summarize(members: LaidOutMessage[]): SequenceGroup {
  const byStart = [...members].sort((a, b) => a.startTime - b.startTime || a.spanId.localeCompare(b.spanId));
  const lead = byStart[0]!;
  const durs = byStart.map((m) => m.durationMicros);
  const total = durs.reduce((s, d) => s + d, 0);
  const wallStart = Math.min(...byStart.map((m) => m.startTime));
  const wallEnd = Math.max(...byStart.map((m) => m.startTime + m.durationMicros));
  // Concurrent if any member starts before an earlier member has finished.
  let concurrent = false;
  let maxEnd = -Infinity;
  for (const m of byStart) {
    if (m.startTime < maxEnd) {
      concurrent = true;
      break;
    }
    maxEnd = Math.max(maxEnd, m.startTime + m.durationMicros);
  }
  return {
    id: lead.spanId,
    signature: sig(lead),
    from: lead.from,
    to: lead.to,
    label: lead.label,
    async: lead.async,
    count: byStart.length,
    spanIds: byStart.map((m) => m.spanId),
    totalDurationMicros: total,
    spanMicros: wallEnd - wallStart,
    minDurationMicros: Math.min(...durs),
    maxDurationMicros: Math.max(...durs),
    avgDurationMicros: Math.round(total / byStart.length),
    errorCount: byStart.filter((m) => m.status === "error").length,
    concurrent,
  };
}

export interface Activation {
  participant: string; // callee lifeline (message.to)
  spanId: string;
  fromRow: number;
  toRow: number;
  depth: number;
  status: string;
}

export type SequenceRow =
  | { kind: "call"; message: LaidOutMessage }
  | { kind: "return"; message: LaidOutMessage };

export interface SequenceLayout {
  participants: string[];
  externals: string[];
  rows: SequenceRow[];
  activations: Activation[];
  messages: LaidOutMessage[];
  groups: SequenceGroup[]; // repeated-sibling runs, whether collapsed or expanded this render
}

interface OpenCall {
  message: LaidOutMessage;
  endTime: number;
}

// `expanded` = group ids the viewer has opened; every other group renders collapsed (the default).
export function sequenceLayout(sequence: Sequence, expanded?: ReadonlySet<string>): SequenceLayout {
  const sorted: LaidOutMessage[] = [...sequence.messages]
    .map((m) => ({ ...m, callRow: -1, returnRow: -1, depth: 0 }))
    .sort((a, b) => a.startTime - b.startTime || a.spanId.localeCompare(b.spanId));

  const groups = detectGroups(sorted);

  // Build the message list the bracketing runs over: a collapsed group becomes one synthetic call
  // spanning its wall-clock window; an expanded group keeps its members (its lead row carries the
  // group so the renderer can offer "collapse"). Non-grouped messages pass through untouched.
  const memberOf = new Map<string, SequenceGroup>();
  for (const g of groups) for (const id of g.spanIds) memberOf.set(id, g);
  const emitted = new Set<string>();
  const ordered: LaidOutMessage[] = [];
  for (const m of sorted) {
    const g = memberOf.get(m.spanId);
    if (!g) {
      ordered.push(m);
      continue;
    }
    const isExpanded = expanded?.has(g.id) ?? false;
    if (isExpanded) {
      m.group = g;
      m.groupRole = m.spanId === g.id ? "lead" : "member";
      ordered.push(m);
    } else if (!emitted.has(g.id)) {
      // We iterate in start order, so the first member we reach is the lead (earliest start).
      emitted.add(g.id);
      ordered.push({
        ...m,
        spanId: g.id,
        durationMicros: g.spanMicros, // synthetic call spans the whole cluster's wall-clock window
        status: g.errorCount > 0 ? "error" : m.status,
        callRow: -1,
        returnRow: -1,
        depth: 0,
        group: g,
        groupRole: "collapsed",
      });
    }
  }
  ordered.sort((a, b) => a.startTime - b.startTime || a.spanId.localeCompare(b.spanId));

  const rows: SequenceRow[] = [];
  const activations: Activation[] = [];
  const open: OpenCall[] = [];

  const closeTop = (): void => {
    const finished = open.pop()!;
    finished.message.returnRow = rows.length;
    activations.push({
      participant: finished.message.to,
      spanId: finished.message.spanId,
      fromRow: finished.message.callRow,
      toRow: rows.length,
      depth: finished.message.depth,
      status: finished.message.status,
    });
    rows.push({ kind: "return", message: finished.message });
  };

  for (const m of ordered) {
    while (open.length > 0 && open[open.length - 1]!.endTime <= m.startTime) closeTop();

    m.depth = open.reduce((n, o) => n + (o.message.to === m.to ? 1 : 0), 0);
    m.callRow = rows.length;
    rows.push({ kind: "call", message: m });

    if (m.async) {
      m.returnRow = m.callRow;
    } else {
      open.push({ message: m, endTime: m.startTime + m.durationMicros });
    }
  }

  while (open.length > 0) closeTop();

  return {
    participants: sequence.participants,
    externals: sequence.externals ?? [],
    rows,
    activations,
    messages: ordered,
    groups,
  };
}
