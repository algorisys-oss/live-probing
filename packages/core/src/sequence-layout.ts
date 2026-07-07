import type { Message, Sequence } from "./sequence.js";

// Turns a flat, time-ordered message list into a UML-style call/return layout: each
// synchronous call gets an activation bar on the callee's lifeline (from the call arrow down
// to its return arrow), and rows are bracketed by nesting so a parent's return lands after
// all of its children's. Pure function — the renderer is a projection of this, and the tricky
// bracketing/lane math is unit-tested without a DOM.
//
// Nesting is inferred from *time containment* (a synchronous parent span is active while its
// children run, so it contains them), not from parent ids — which the sequence projection
// doesn't carry. Async messages (producer/consumer) are fire-and-forget: a call row, no
// return, no activation.

export interface LaidOutMessage extends Message {
  callRow: number; // row index of the call arrow
  returnRow: number; // row index of the return arrow (=== callRow for async: no return drawn)
  depth: number; // how many activations are already open on the callee lifeline (x-offset lane)
}

export interface Activation {
  participant: string; // the callee lifeline the bar sits on (message.to)
  spanId: string;
  fromRow: number; // call row
  toRow: number; // return row
  depth: number; // lane offset when activations stack on one lifeline
  status: string; // for error styling
}

export type SequenceRow =
  | { kind: "call"; message: LaidOutMessage }
  | { kind: "return"; message: LaidOutMessage };

export interface SequenceLayout {
  participants: string[];
  externals: string[];
  rows: SequenceRow[]; // ordered; row index → y in the renderer
  activations: Activation[];
  messages: LaidOutMessage[]; // same objects as in `rows`, in call order
}

interface OpenCall {
  message: LaidOutMessage;
  endTime: number;
}

export function sequenceLayout(sequence: Sequence): SequenceLayout {
  const ordered: LaidOutMessage[] = [...sequence.messages]
    .map((m) => ({ ...m, callRow: -1, returnRow: -1, depth: 0 }))
    .sort((a, b) => a.startTime - b.startTime || a.spanId.localeCompare(b.spanId));

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
    // A sync call/return brackets its children: close any open activation that finished before
    // this call starts (a sibling that already returned), innermost first.
    while (open.length > 0 && open[open.length - 1]!.endTime <= m.startTime) closeTop();

    // Lane offset: how many activations are already open on this callee's lifeline.
    m.depth = open.reduce((n, o) => n + (o.message.to === m.to ? 1 : 0), 0);
    m.callRow = rows.length;
    rows.push({ kind: "call", message: m });

    if (m.async) {
      m.returnRow = m.callRow; // fire-and-forget: no return arrow, no activation bar
    } else {
      open.push({ message: m, endTime: m.startTime + m.durationMicros });
    }
  }

  // Close whatever is still open, innermost first (LIFO), so returns nest correctly.
  while (open.length > 0) closeTop();

  return {
    participants: sequence.participants,
    externals: sequence.externals,
    rows,
    activations,
    messages: ordered,
  };
}
