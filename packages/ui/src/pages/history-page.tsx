import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDays } from "../lib/api";
import type { DayInfo } from "../lib/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; days: DayInfo[] };

export function HistoryPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchDays()
      .then((r) => {
        if (!cancelled) setState({ kind: "ready", days: r.days });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="history-page">
      <div className="history-head">
        <h1 className="page-title">History</h1>
      </div>

      {state.kind === "loading" && (
        <div className="empty-hint">Loading days…</div>
      )}

      {state.kind === "error" && (
        <div className="empty-hint error-text">
          Failed to load: {state.message}
        </div>
      )}

      {state.kind === "ready" && state.days.length === 0 && (
        <div className="empty-hint">No history yet.</div>
      )}

      {state.kind === "ready" && state.days.length > 0 && (
        <div className="day-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Requests</th>
                <th className="num">Errors</th>
              </tr>
            </thead>
            <tbody>
              {state.days.map((d) => (
                <tr key={d.day}>
                  <td>
                    <Link
                      to={`/day/${encodeURIComponent(d.day)}`}
                      className="day-link"
                    >
                      {d.day}
                    </Link>
                  </td>
                  <td className="num">{d.requests.toLocaleString()}</td>
                  <td className={d.errors > 0 ? "num error-text" : "num"}>
                    {d.errors.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
