import { LATENCY_BUCKET_LABELS } from "../lib/latency-buckets";
import type { LatencyDistribution } from "../lib/types";

const W = 820;
const PADL = 66;
const PADR = 14;
const PADT = 10;
const PADB = 26;
const ROW_H = 15;

function hhmm(minute: number): string {
  return new Date(minute * 60000).toISOString().slice(11, 16);
}

// Time (x, one column per minute) × latency bucket (y, slowest on top). Cell brightness scales
// with request count, so a band shifting upward — or a hot cell appearing in a slow bucket — is
// the visual signature of a latency regression as it happens.
export function LatencyHeatmap({ heatmap }: { heatmap: LatencyDistribution["heatmap"] }) {
  if (heatmap.length === 0) return <div className="muted">No requests to plot.</div>;

  const nBuckets = LATENCY_BUCKET_LABELS.length;
  const H = PADT + PADB + nBuckets * ROW_H;
  const cols = heatmap.length;
  const plotW = W - PADL - PADR;
  const cw = plotW / cols;
  const maxCount = Math.max(1, ...heatmap.flatMap((m) => m.counts));

  // Slowest bucket (highest index) at the top.
  const rowY = (bucket: number) => PADT + (nBuckets - 1 - bucket) * ROW_H;

  return (
    <svg className="lat-heatmap" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {/* y labels: every other bucket to avoid crowding */}
      {LATENCY_BUCKET_LABELS.map((label, b) =>
        b % 2 === 0 ? (
          <text key={b} className="axis-label" x={PADL - 6} y={rowY(b) + ROW_H - 4} textAnchor="end">
            {label}
          </text>
        ) : null,
      )}
      {/* cells */}
      {heatmap.map((col, ci) =>
        col.counts.map((c, b) =>
          c === 0 ? null : (
            <rect
              key={`${ci}-${b}`}
              className="heat-cell"
              x={PADL + ci * cw}
              y={rowY(b)}
              width={Math.max(1, cw - 0.5)}
              height={ROW_H - 0.5}
              style={{ opacity: 0.12 + 0.88 * (c / maxCount) }}
            >
              <title>
                {hhmm(col.minute)} · {LATENCY_BUCKET_LABELS[b]}: {c}
              </title>
            </rect>
          ),
        ),
      )}
      {/* x labels: first + last minute */}
      <text className="axis-label" x={PADL} y={H - PADB + 18} textAnchor="middle">
        {hhmm(heatmap[0]!.minute)}
      </text>
      <text className="axis-label" x={PADL + plotW} y={H - PADB + 18} textAnchor="middle">
        {hhmm(heatmap[heatmap.length - 1]!.minute)}
      </text>
    </svg>
  );
}
