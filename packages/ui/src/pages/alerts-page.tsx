import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveStore } from "../store/use-live-store";
import { isDatastore } from "../lib/format";
import type { Alert } from "../lib/types";

function firingFor(sinceMs: number, now: number): string {
  const s = Math.max(0, Math.round((now - sinceMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function AlertRow({ a, now }: { a: Alert; now: number }) {
  // Error-rate alerts name a service (link to its page); latency alerts name an edge (no page).
  const service = a.kind === "service" ? a.target : null;
  const linkable = service !== null && !isDatastore(service);
  return (
    <li className={`alert-row alert-row-${a.severity}`}>
      <span className={`alert-dot alert-dot-${a.severity}`} />
      <div className="alert-body">
        <div className="alert-msg">{a.message}</div>
        <div className="alert-meta">
          <span className="alert-metric">{a.metric}</span>
          <span>firing {firingFor(a.since, now)}</span>
          {linkable && (
            <Link className="link" to={`/service/${encodeURIComponent(service!)}`}>
              {service} →
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

export function AlertsPage() {
  const alerts = useLiveStore((s) => s.alerts);
  const connected = useLiveStore((s) => s.connected);
  // Tick once a second so "firing for" counts up live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page alerts-page">
      <h1 className="page-title">Alerts</h1>
      {alerts.length === 0 ? (
        <div className="muted">
          {connected ? "No active alerts — all services within thresholds. 🎉" : "Connecting…"}
        </div>
      ) : (
        <ul className="alert-list">
          {alerts.map((a) => (
            <AlertRow key={a.id} a={a} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
