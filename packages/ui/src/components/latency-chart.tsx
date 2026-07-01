import type { LatencyBucket } from "../lib/types";
import { formatMicros } from "../lib/format";

const W = 820;
const H = 220;
const PADL = 52;
const PADR = 14;
const PADT = 14;
const PADB = 28;

function hhmm(minute: number): string {
  return new Date(minute * 60000).toISOString().slice(11, 16);
}

export function LatencyChart({ buckets, endpoint }: { buckets: LatencyBucket[]; endpoint: string }) {
  if (buckets.length === 0) {
    return <div className="muted">No latency data for {endpoint} on this day.</div>;
  }

  const maxY = Math.max(1, ...buckets.map((b) => b.p99));
  const first = buckets[0]!.minute;
  const last = buckets[buckets.length - 1]!.minute;
  const spanM = Math.max(1, last - first);
  const x = (m: number) => PADL + ((m - first) / spanM) * (W - PADL - PADR);
  const y = (v: number) => PADT + (1 - v / maxY) * (H - PADT - PADB);

  const path = (key: "p50" | "p95" | "p99") =>
    buckets.map((b, i) => `${i === 0 ? "M" : "L"} ${x(b.minute).toFixed(1)} ${y(b[key]).toFixed(1)}`).join(" ");

  return (
    <div className="latency-chart-wrap">
      <div className="latency-legend">
        <span className="lg lg-p50">p50</span>
        <span className="lg lg-p95">p95</span>
        <span className="lg lg-p99">p99</span>
        <span className="muted latency-endpoint">{endpoint}</span>
      </div>
      <svg className="latency-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* axes */}
        <line className="axis" x1={PADL} y1={PADT} x2={PADL} y2={H - PADB} />
        <line className="axis" x1={PADL} y1={H - PADB} x2={W - PADR} y2={H - PADB} />
        {/* y labels */}
        <text className="axis-label" x={PADL - 6} y={y(maxY) + 4} textAnchor="end">
          {formatMicros(maxY)}
        </text>
        <text className="axis-label" x={PADL - 6} y={y(0)} textAnchor="end">
          0
        </text>
        {/* x labels */}
        <text className="axis-label" x={x(first)} y={H - PADB + 16} textAnchor="middle">
          {hhmm(first)}
        </text>
        <text className="axis-label" x={x(last)} y={H - PADB + 16} textAnchor="middle">
          {hhmm(last)}
        </text>
        {/* lines */}
        <path className="lat-line lat-p99" d={path("p99")} />
        <path className="lat-line lat-p95" d={path("p95")} />
        <path className="lat-line lat-p50" d={path("p50")} />
      </svg>
    </div>
  );
}
