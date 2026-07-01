import { useMemo } from "react";
import type { ThroughputBucket } from "../lib/types";

const WIDTH = 720;
const HEIGHT = 180;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

/** Format an epoch-minutes value as HH:MM in UTC. */
function labelTime(minute: number): string {
  const d = new Date(minute * 60000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function ThroughputChart({
  buckets,
}: {
  buckets: ThroughputBucket[];
}) {
  const chart = useMemo(() => {
    if (buckets.length === 0) return null;

    const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const maxCount = Math.max(1, ...buckets.map((b) => b.count));

    // Bar width: leave a small gap; handle the single-bucket case gracefully.
    const slot = plotW / buckets.length;
    const barW = Math.max(1, Math.min(slot * 0.8, 48));

    const bars = buckets.map((b, i) => {
      const x = PAD_LEFT + slot * i + (slot - barW) / 2;
      const h = (b.count / maxCount) * plotH;
      const errH =
        b.count > 0 ? (Math.min(b.errors, b.count) / maxCount) * plotH : 0;
      const y = PAD_TOP + plotH - h;
      return { x, y, h, errH, barW, bucket: b };
    });

    // Pick a handful of evenly-spaced x ticks.
    const tickCount = Math.min(buckets.length, 6);
    const tickIdxs: number[] = [];
    if (tickCount === 1) {
      tickIdxs.push(0);
    } else {
      for (let t = 0; t < tickCount; t++) {
        tickIdxs.push(Math.round((t * (buckets.length - 1)) / (tickCount - 1)));
      }
    }
    const ticks = Array.from(new Set(tickIdxs)).map((i) => ({
      x: PAD_LEFT + slot * i + slot / 2,
      label: labelTime(buckets[i]!.minute),
    }));

    return { bars, ticks, maxCount, plotH };
  }, [buckets]);

  if (!chart) {
    return <div className="empty-hint">No throughput data.</div>;
  }

  const baselineY = PAD_TOP + chart.plotH;

  return (
    <svg
      className="throughput-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Requests per minute"
    >
      {/* y axis max + baseline labels */}
      <text className="chart-axis-label" x={PAD_LEFT - 6} y={PAD_TOP + 4}>
        {chart.maxCount}
      </text>
      <text className="chart-axis-label" x={PAD_LEFT - 6} y={baselineY}>
        0
      </text>

      <line
        className="chart-baseline"
        x1={PAD_LEFT}
        y1={baselineY}
        x2={WIDTH - PAD_RIGHT}
        y2={baselineY}
      />

      {chart.bars.map((bar, i) => (
        <g key={i}>
          <rect
            className="chart-bar"
            x={bar.x}
            y={bar.y}
            width={bar.barW}
            height={Math.max(0, bar.h)}
          >
            <title>
              {labelTime(bar.bucket.minute)} — {bar.bucket.count} req,{" "}
              {bar.bucket.errors} err
            </title>
          </rect>
          {bar.errH > 0 && (
            <rect
              className="chart-bar-error"
              x={bar.x}
              y={baselineY - bar.errH}
              width={bar.barW}
              height={bar.errH}
            />
          )}
        </g>
      ))}

      {chart.ticks.map((tick, i) => (
        <text
          key={i}
          className="chart-tick"
          x={tick.x}
          y={HEIGHT - 8}
          textAnchor="middle"
        >
          {tick.label}
        </text>
      ))}
    </svg>
  );
}
