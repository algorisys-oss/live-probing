import { DATASTORE_SYSTEMS } from "./event.js";
import type { AssembledTrace } from "./trace-window.js";

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
  // Participants known only as a peer (nothing instrumented on their side) — "ghost"
  // lifelines. Datastores and real participants of the trace are not listed.
  externals: string[];
}

// Project one assembled trace into a time-ordered sequence. A span whose parent runs in a
// different participant is a request arrow (parent -> span). A span that calls a peer —
// a datastore or an uninstrumented "ghost" service — is an arrow to that peer, unless the
// callee reported its own span (then the parent/child arrow already covers the call).
// Same-participant internal work is not drawn.
export function sequenceFor(trace: AssembledTrace): Sequence {
  const byId = new Map(trace.events.map((e) => [e.spanId, e]));
  const messages: Message[] = [];
  const participants: string[] = [];
  const seen = new Set<string>();
  const see = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p);
      participants.push(p);
    }
  };

  // Spans whose callee reported its own span (the other side is instrumented).
  const bridged = new Set<string>();
  const realParticipants = new Set<string>();
  for (const e of trace.events) {
    realParticipants.add(e.participant);
    const parent = e.parentSpanId ? byId.get(e.parentSpanId) : undefined;
    if (parent && parent.participant !== e.participant) bridged.add(parent.spanId);
  }

  const ordered = [...trace.events].sort(
    (a, b) => a.startTime - b.startTime || a.spanId.localeCompare(b.spanId),
  );

  const ghosts = new Set<string>();
  for (const e of ordered) {
    const parent = e.parentSpanId ? byId.get(e.parentSpanId) : undefined;
    if (parent && parent.participant !== e.participant) {
      see(parent.participant);
      see(e.participant);
      messages.push({
        from: parent.participant,
        to: e.participant,
        label: e.operation,
        startTime: e.startTime,
        durationMicros: e.duration,
        status: e.status,
        async: e.kind === "consumer" || parent.kind === "producer",
      });
    } else if (e.peer && e.peer !== e.participant && !bridged.has(e.spanId)) {
      see(e.participant);
      see(e.peer);
      if (!DATASTORE_SYSTEMS.has(e.peer) && !realParticipants.has(e.peer)) ghosts.add(e.peer);
      messages.push({
        from: e.participant,
        to: e.peer,
        label: e.operation,
        startTime: e.startTime,
        durationMicros: e.duration,
        status: e.status,
        async: e.kind === "producer" || e.kind === "consumer",
      });
    }
  }

  return { participants, messages, externals: [...ghosts] };
}
