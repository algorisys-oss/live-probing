import { create } from "zustand";
import type { Topology, TraceSummary, WsMessage } from "../lib/types";

const MAX_TRACES = 200;

/**
 * Sort a Map of traces newest-first and cap to MAX_TRACES.
 * Returns a fresh array (the render-facing view).
 */
function toSortedCapped(map: Map<string, TraceSummary>): TraceSummary[] {
  const arr = Array.from(map.values());
  arr.sort((a, b) => b.startTime - a.startTime);
  if (arr.length > MAX_TRACES) arr.length = MAX_TRACES;
  return arr;
}

interface LiveState {
  traces: TraceSummary[];
  topology: Topology;
  mermaidFlow: string;
  connected: boolean;
  selectedTraceId: string | null;

  // internal hot-path map (kept off the render surface)
  _traceMap: Map<string, TraceSummary>;

  setConnected: (connected: boolean) => void;
  selectTrace: (id: string | null) => void;
  applyWsMessage: (msg: WsMessage) => void;
  applyTraces: (traces: TraceSummary[]) => void;
  applyTopology: (topology: Topology, mermaidFlow: string) => void;
  applySnapshot: (
    traces: TraceSummary[],
    topology: Topology,
    mermaidFlow: string,
  ) => void;
}

const emptyTopology: Topology = { nodes: [], edges: [] };

export const useLiveStore = create<LiveState>((set, get) => ({
  traces: [],
  topology: emptyTopology,
  mermaidFlow: "",
  connected: false,
  selectedTraceId: null,
  _traceMap: new Map<string, TraceSummary>(),

  setConnected: (connected) => set({ connected }),

  selectTrace: (id) => set({ selectedTraceId: id }),

  applyTraces: (incoming) => {
    const map = get()._traceMap;
    for (const t of incoming) {
      map.set(t.traceId, t);
    }
    // cap the underlying map too, so it doesn't grow unbounded
    if (map.size > MAX_TRACES) {
      const sorted = Array.from(map.values()).sort(
        (a, b) => b.startTime - a.startTime,
      );
      map.clear();
      for (let i = 0; i < Math.min(sorted.length, MAX_TRACES); i++) {
        const s = sorted[i]!;
        map.set(s.traceId, s);
      }
    }
    set({ traces: toSortedCapped(map) });
  },

  applyTopology: (topology, mermaidFlow) => set({ topology, mermaidFlow }),

  applySnapshot: (traces, topology, mermaidFlow) => {
    const map = new Map<string, TraceSummary>();
    for (const t of traces) map.set(t.traceId, t);
    set({
      _traceMap: map,
      traces: toSortedCapped(map),
      topology,
      mermaidFlow,
    });
  },

  applyWsMessage: (msg) => {
    switch (msg.type) {
      case "snapshot":
        get().applySnapshot(msg.traces, msg.topology, msg.mermaidFlow);
        break;
      case "traces":
        get().applyTraces(msg.traces);
        break;
      case "topology":
        get().applyTopology(msg.topology, msg.mermaidFlow);
        break;
    }
  },
}));
