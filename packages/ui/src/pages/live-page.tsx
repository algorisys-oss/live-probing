import { useState } from "react";
import { useLiveStore } from "../store/use-live-store";
import { TraceList } from "../components/trace-list";
import { FlowView } from "../components/flow-view";
import { DependencyMatrix } from "../components/dependency-matrix";
import { RedTiles } from "../components/red-tiles";

export function LivePage() {
  const paused = useLiveStore((s) => s.paused);
  const pendingCount = useLiveStore((s) => s.pendingCount);
  const setPaused = useLiveStore((s) => s.setPaused);
  const services = useLiveStore((s) => s.topology.nodes);
  const filterService = useLiveStore((s) => s.filterService);
  const setFilterService = useLiveStore((s) => s.setFilterService);
  // Two projections of the same live window: the node-link graph, or the caller×callee matrix
  // (which scales past the point where the graph turns to spaghetti).
  const [view, setView] = useState<"graph" | "matrix">("graph");

  return (
    <div className="body">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">Live traces</div>
          <button
            className={paused ? "pause-btn pause-btn-active" : "pause-btn"}
            onClick={() => setPaused(!paused)}
            title={paused ? "Resume live feed" : "Pause live feed"}
          >
            {paused
              ? `Paused · ${pendingCount} new`
              : "Pause"}
          </button>
        </div>
        <TraceList />
      </aside>

      <main className="main">
        <RedTiles />
        <div className="live-toolbar">
          <span className="live-toolbar-label">Filter</span>
          <select
            className="live-filter"
            value={filterService ?? ""}
            onChange={(e) => setFilterService(e.target.value || null)}
          >
            <option value="">all services</option>
            {[...services].sort().map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {filterService && (
            <button className="live-filter-clear" onClick={() => setFilterService(null)}>
              clear ✕
            </button>
          )}
          <div className="live-view-toggle" role="group" aria-label="live view">
            <button
              className={view === "graph" ? "seg-btn seg-btn-active" : "seg-btn"}
              onClick={() => setView("graph")}
            >
              Graph
            </button>
            <button
              className={view === "matrix" ? "seg-btn seg-btn-active" : "seg-btn"}
              onClick={() => setView("matrix")}
            >
              Matrix
            </button>
          </div>
        </div>
        <div className="tab-panel">{view === "graph" ? <FlowView /> : <DependencyMatrix />}</div>
      </main>
    </div>
  );
}
