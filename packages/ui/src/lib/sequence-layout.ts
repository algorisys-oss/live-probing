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
  };
}
