import { useNavigate } from "react-router-dom";
import { useLiveStore } from "../store/use-live-store";
import { formatMicros, isDatastore } from "../lib/format";
import type { RedMetric } from "../lib/types";

// Reuse the same error-rate thresholds as the topology health colouring so the strip and the
// graph agree on what "red" means.
function health(m: RedMetric): "ok" | "warn" | "error" {
  if (m.errorRate >= 0.05) return "error";
  if (m.errorRate >= 0.01) return "warn";
  return "ok";
}

function fmtRate(r: number): string {
  if (r >= 100) return `${Math.round(r)}/s`;
  if (r >= 10) return `${r.toFixed(0)}/s`;
  return `${r.toFixed(1)}/s`;
}

// RED (Rate · Errors · Duration) tiles: one per instrumented service in the live window, the
// at-a-glance triage strip above the flow graph. Sorted by traffic (server sends it that way).
export function RedTiles() {
  const red = useLiveStore((s) => s.red);
  const navigate = useNavigate();

  if (red.length === 0) return null;

  return (
    <div className="red-tiles" role="list">
      {red.map((m) => {
        const h = health(m);
        const clickable = !isDatastore(m.service);
        return (
          <button
            key={m.service}
            role="listitem"
            className={`red-tile red-tile-${h}`}
            disabled={!clickable}
            onClick={clickable ? () => navigate(`/service/${encodeURIComponent(m.service)}`) : undefined}
            title={`${m.service} — ${m.calls} calls, ${m.errors} errors, p95 ${formatMicros(m.p95Micros)}`}
          >
            <div className="red-tile-name">{m.service}</div>
            <div className="red-tile-metrics">
              <span className="red-metric" title="request rate">
                {fmtRate(m.ratePerSec)}
              </span>
              <span className={m.errorRate > 0 ? "red-metric red-metric-err" : "red-metric red-metric-muted"} title="error rate">
                {(m.errorRate * 100).toFixed(m.errorRate >= 0.1 ? 0 : 1)}%
              </span>
              <span className="red-metric" title="p95 latency">
                {formatMicros(m.p95Micros)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
