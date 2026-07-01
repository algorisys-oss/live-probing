import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchService } from "../lib/api";
import { formatMicros } from "../lib/format";
import type { ServiceDetail } from "../lib/types";

export function ServicePage() {
  const { name = "" } = useParams();
  const [svc, setSvc] = useState<ServiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvc(null);
    setError(null);
    fetchService(name)
      .then((s) => !cancelled && setSvc(s))
      .catch(() => !cancelled && setError("Failed to load service"));
    return () => {
      cancelled = true;
    };
  }, [name]);

  const deps = (label: string, names: string[]) => (
    <div className="svc-deps">
      <span className="svc-deps-label">{label}</span>
      {names.length === 0 ? (
        <span className="muted">none</span>
      ) : (
        names.map((n) => (
          <Link key={n} to={`/service/${encodeURIComponent(n)}`} className="chip chip-link">
            {n}
          </Link>
        ))
      )}
    </div>
  );

  return (
    <div className="page service-page">
      <div className="trace-page-bar">
        <Link to="/" className="back-link">
          ← Live
        </Link>
      </div>
      <h1 className="page-title mono">{name}</h1>
      {error && <div className="error-msg">{error}</div>}
      {!error && !svc && <div className="muted">Loading…</div>}
      {svc && (
        <>
          <div className="cards">
            <div className="card">
              <div className="card-value">{svc.spans}</div>
              <div className="card-label">Spans (live window)</div>
            </div>
            <div className="card">
              <div className="card-value">{(svc.errorRate * 100).toFixed(1)}%</div>
              <div className="card-label">Error rate</div>
            </div>
            <div className="card">
              <div className="card-value">{svc.errors}</div>
              <div className="card-label">Errored spans</div>
            </div>
          </div>

          {deps("calls in from", svc.inbound)}
          {deps("calls out to", svc.outbound)}

          <h2 className="section-title">Operations</h2>
          {svc.operations.length === 0 ? (
            <div className="muted">No operations observed in the live window.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Operation</th>
                  <th className="num">Calls</th>
                  <th className="num">Errors</th>
                  <th className="num">Avg</th>
                </tr>
              </thead>
              <tbody>
                {svc.operations.map((o) => (
                  <tr key={o.operation}>
                    <td className="mono">{o.operation}</td>
                    <td className="num">{o.calls}</td>
                    <td className={o.errors > 0 ? "num err-text" : "num"}>{o.errors}</td>
                    <td className="num muted">{formatMicros(o.avgMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
