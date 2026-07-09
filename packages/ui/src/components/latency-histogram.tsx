import { LATENCY_BUCKET_LABELS } from "../lib/latency-buckets";

const W = 820;
const H = 200;
const PADL = 44;
const PADR = 14;
const PADT = 12;
const PADB = 52;

// Distribution of request durations across the fixed latency buckets. Reveals shape the
// percentile lines hide — a long tail, or a bimodal split (fast cache hits + slow misses).
export function LatencyHistogram({ histogram }: { histogram: number[] }) {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="muted">No requests to distribute.</div>;

  const n = histogram.length;
  const maxY = Math.max(1, ...histogram);
  const plotW = W - PADL - PADR;
  const plotH = H - PADT - PADB;
  const bw = plotW / n;
  const y = (v: number) => PADT + (1 - v / maxY) * plotH;

  return (
    <svg className="lat-hist" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <line className="axis" x1={PADL} y1={PADT} x2={PADL} y2={H - PADB} />
      <line className="axis" x1={PADL} y1={H - PADB} x2={W - PADR} y2={H - PADB} />
      <text className="axis-label" x={PADL - 6} y={y(maxY) + 4} textAnchor="end">
        {maxY}
      </text>
      <text className="axis-label" x={PADL - 6} y={y(0)} textAnchor="end">
        0
      </text>
      {histogram.map((c, i) => {
        const bx = PADL + i * bw;
        const bh = c === 0 ? 0 : Math.max(1, plotH * (c / maxY));
        const pct = Math.round((c / total) * 100);
        return (
          <g key={i} className="lat-hist-bar">
            <rect x={bx + 2} y={H - PADB - bh} width={Math.max(1, bw - 4)} height={bh}>
              <title>
                {LATENCY_BUCKET_LABELS[i]}: {c} ({pct}%)
              </title>
            </rect>
            {c > 0 && bw > 26 && (
              <text className="lat-hist-count" x={bx + bw / 2} y={H - PADB - bh - 3} textAnchor="middle">
                {c}
              </text>
            )}
            <text
              className="lat-hist-label"
              x={bx + bw / 2}
              y={H - PADB + 12}
              textAnchor="end"
              transform={`rotate(-40 ${bx + bw / 2} ${H - PADB + 12})`}
            >
              {LATENCY_BUCKET_LABELS[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
