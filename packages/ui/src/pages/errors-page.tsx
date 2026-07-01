import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchErrors } from "../lib/api";
import type { ErrorGroup } from "../lib/types";

function timeOf(micros: number): string {
  return new Date(Math.floor(micros / 1000)).toISOString().slice(11, 19) + " UTC";
}

export function ErrorsPage() {
  const [groups, setGroups] = useState<ErrorGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchErrors(100)
      .then((r) => !cancelled && setGroups(r.groups))
      .catch(() => !cancelled && setError("Failed to load errors"));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page errors-page">
      <h1 className="page-title">Errors</h1>
      {error && <div className="error-msg">{error}</div>}
      {!error && groups === null && <div className="muted">Loading…</div>}
      {groups && groups.length === 0 && <div className="muted">No errored traces recorded. 🎉</div>}
      {groups && groups.length > 0 && (
        <table className="data-table errors-table">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Error</th>
              <th className="num">Count</th>
              <th className="num">Last seen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={`${g.endpoint}|${g.label}`}>
                <td className="mono">{g.endpoint}</td>
                <td>
                  <span className="err-label">{g.label}</span>
                </td>
                <td className="num">{g.count}</td>
                <td className="num muted">{timeOf(g.lastSeen)}</td>
                <td className="num">
                  <Link className="link" to={`/trace/${encodeURIComponent(g.sampleTraceId)}`}>
                    view trace →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
