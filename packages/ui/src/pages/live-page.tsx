import { useLiveStore } from "../store/use-live-store";
import { TraceList } from "../components/trace-list";
import { FlowView } from "../components/flow-view";

export function LivePage() {
  const paused = useLiveStore((s) => s.paused);
  const pendingCount = useLiveStore((s) => s.pendingCount);
  const setPaused = useLiveStore((s) => s.setPaused);

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
        <div className="tab-panel">
          <FlowView />
        </div>
      </main>
    </div>
  );
}
