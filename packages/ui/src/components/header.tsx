import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useLiveStore } from "../store/use-live-store";

export function Header() {
  const connected = useLiveStore((s) => s.connected);
  const traces = useLiveStore((s) => s.traces);
  const topology = useLiveStore((s) => s.topology);

  const serviceCount = useMemo(() => topology.nodes.length, [topology.nodes]);

  return (
    <header className="header">
      <div className="header-left">
        <Link to="/" className="logo logo-link">
          LiveProbe
        </Link>
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
  );
}
