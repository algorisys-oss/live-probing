import type { DayInfo } from "../lib/types";

const W = 820;
const H = 200;
const PADL = 56;
const PADR = 14;
const PADT = 14;
const PADB = 28;

// Requests per day as bars, with the errored portion overlaid in red.
export function TrendsChart({ days }: { days: DayInfo[] }) {
  if (days.length === 0) return null;
  const ordered = [...days].reverse(); // oldest -> newest, left -> right
  const maxReq = Math.max(1, ...ordered.map((d) => d.requests));
  const slot = (W - PADL - PADR) / ordered.length;
  const barW = Math.min(48, slot * 0.6);
  const y = (v: number) => PADT + (1 - v / maxReq) * (H - PADT - PADB);
  const base = y(0);

  return (
    <svg className="trends-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <line className="axis" x1={PADL} y1={base} x2={W - PADR} y2={base} />
      <text className="axis-label" x={PADL - 6} y={y(maxReq) + 4} textAnchor="end">
        {maxReq.toLocaleString()}
      </text>
      <text className="axis-label" x={PADL - 6} y={base} textAnchor="end">
        0
      </text>
      {ordered.map((d, i) => {
        const cx = PADL + i * slot + slot / 2;
        const top = y(d.requests);
        const errFrac = d.requests > 0 ? d.errors / d.requests : 0;
        const errH = (base - top) * errFrac;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.requests.toLocaleString()} requests, ${d.errors.toLocaleString()} errors`}</title>
            <rect className="trend-bar" x={cx - barW / 2} y={top} width={barW} height={Math.max(0, base - top)} />
            {errH > 0 && <rect className="trend-bar-err" x={cx - barW / 2} y={base - errH} width={barW} height={errH} />}
            <text className="axis-label" x={cx} y={H - PADB + 16} textAnchor="middle">
              {d.day.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
