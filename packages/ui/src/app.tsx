import { useEffect, useMemo, useState } from "react";
import { useLiveStore } from "./store/use-live-store";
import { WsClient } from "./lib/ws-client";
import { fetchTopology, fetchTraces } from "./lib/api";
import { TraceList } from "./components/trace-list";
import { FlowView } from "./components/flow-view";
import { SequenceView } from "./components/sequence-view";

type Tab = "flow" | "sequence";

export function App() {
  const connected = useLiveStore((s) => s.connected);
  const traces = useLiveStore((s) => s.traces);
  const topology = useLiveStore((s) => s.topology);
  const [tab, setTab] = useState<Tab>("flow");

  const serviceCount = useMemo(() => topology.nodes.length, [topology.nodes]);

  useEffect(() => {
    const store = useLiveStore.getState();

    const client = new WsClient({
      onOpen: () => store.setConnected(true),
      onClose: () => store.setConnected(false),
      onMessage: (msg) => useLiveStore.getState().applyWsMessage(msg),
    });
    client.connect();

    // REST fallback so the UI has data even before the first ws frame.
    fetchTraces(100)
      .then((r) => {
        // only seed if the ws snapshot hasn't populated yet
        if (useLiveStore.getState().traces.length === 0) {
          useLiveStore.getState().applyTraces(r.traces);
        }
      })
      .catch(() => {});
    fetchTopology()
      .then((r) => {
        if (useLiveStore.getState().topology.nodes.length === 0) {
          useLiveStore.getState().applyTopology(r.topology, r.mermaidFlow);
        }
      })
      .catch(() => {});

    return () => client.close();
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo">LiveProbe</span>
          <span
            className={
              connected ? "status status-live" : "status status-offline"
            }
          >
            <span className="status-dot" />
            {connected ? "live" : "offline"}
          </span>
        </div>
        <div className="header-right">
          <span className="counter">
            <strong>{traces.length}</strong> traces
          </span>
          <span className="counter">
            <strong>{serviceCount}</strong> services
          </span>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-title">Live traces</div>
          <TraceList />
        </aside>

        <main className="main">
          <div className="tabs">
            <button
              className={tab === "flow" ? "tab tab-active" : "tab"}
              onClick={() => setTab("flow")}
            >
              Flow
            </button>
            <button
              className={tab === "sequence" ? "tab tab-active" : "tab"}
              onClick={() => setTab("sequence")}
            >
              Sequence
            </button>
          </div>
          <div className="tab-panel">
            {tab === "flow" ? <FlowView /> : <SequenceView />}
          </div>
        </main>
      </div>
    </div>
  );
}
