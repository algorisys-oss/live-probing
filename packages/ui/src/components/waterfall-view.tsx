import type { SpanRow } from "../lib/types";
import { formatMicros, hashString, isDatastore } from "../lib/format";

const LABEL_W = 280; // keep in sync with .wf-label width in styles.css

function serviceColor(name: string): string {
  if (isDatastore(name)) return "var(--datastore)";
  const hue = hashString(name) % 360;
  return `hsl(${hue} 55% 58%)`;
}

export function SpanDetail({ span, traceStart }: { span: SpanRow; traceStart: number }) {
  const attrs = Object.entries(span.attributes).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="wf-detail">
      <div className="wf-detail-op" title={span.operation}>
        {span.operation}
      </div>
      <div className="wf-detail-meta">
        <span className="chip" style={{ borderColor: serviceColor(span.participant) }}>
          {span.participant}
        </span>
        <span>{span.kind}</span>
        {span.peer && <span>→ {span.peer}</span>}
        {span.status === "error" && <span className="badge badge-error">error</span>}
      </div>
      <div className="wf-detail-rows">
        <div className="wf-kv">
          <span className="wf-k">duration</span>
          <span className="wf-v">{formatMicros(span.duration)}</span>
        </div>
        <div className="wf-kv">
          <span className="wf-k">start +</span>
          <span className="wf-v">{formatMicros(span.startTime - traceStart)}</span>
        </div>
        <div className="wf-kv">
          <span className="wf-k">status</span>
          <span className="wf-v">{span.status}</span>
        </div>
      </div>
      <div className="wf-detail-attrs-title">attributes</div>
      {attrs.length === 0 ? (
        <div className="muted">no attributes</div>
      ) : (
        <div className="wf-detail-rows">
          {attrs.map(([k, v]) => (
            <div className="wf-kv" key={k}>
              <span className="wf-k" title={k}>
                {k}
              </span>
              <span className="wf-v" title={String(v)}>
                {String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Evenly-spaced tick offsets (micros) across the trace duration, for the time axis + grid.
function axisTicks(total: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (total * i) / count);
}

export function WaterfallView({
  spans = [],
  traceStart,
  traceDuration,
  selectedId,
  onSelect,
}: {
  spans?: SpanRow[];
  traceStart: number;
  traceDuration: number;
  selectedId: string | null;
  onSelect: (spanId: string) => void;
}) {
  if (spans.length === 0) {
    return (
      <div className="empty-hint">
        Waterfall not available for this trace (recorded before span capture). Try the Sequence tab.
      </div>
    );
  }

  const total = Math.max(traceDuration, 1);
  const ticks = axisTicks(total, 4);

  return (
    <div className="waterfall">
      {/* time axis, aligned over the track column */}
      <div className="wf-axis">
        <div className="wf-axis-gutter" style={{ width: LABEL_W }} />
        <div className="wf-axis-track">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="wf-tick-label"
              style={{ left: `${(t / total) * 100}%` }}
            >
              {formatMicros(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="wf-body">
        {/* vertical gridlines behind the rows (x-fixed, so they ignore vertical scroll) */}
        <div className="wf-grid" style={{ left: LABEL_W }}>
          {ticks.map((t, i) => (
            <span key={i} className="wf-gridline" style={{ left: `${(t / total) * 100}%` }} />
          ))}
        </div>

        <div className="wf-rows">
          {spans.map((s) => {
            const leftPct = Math.min(100, Math.max(0, ((s.startTime - traceStart) / total) * 100));
            const widthPct = Math.min(100 - leftPct, Math.max(0.4, (s.duration / total) * 100));
            const color = serviceColor(s.participant);
            const error = s.status === "error";
            // Show the duration outside the bar when the bar is too narrow to hold it.
            const durInside = widthPct > 12;
            return (
              <div
                key={s.spanId}
                className={s.spanId === selectedId ? "wf-row wf-row-selected" : "wf-row"}
                onClick={() => onSelect(s.spanId)}
              >
                <div className="wf-label" style={{ paddingLeft: 6 + s.depth * 12 }}>
                  {/* depth rails — one vertical guide per ancestor level */}
                  {Array.from({ length: s.depth }).map((_, d) => (
                    <span key={d} className="wf-rail" style={{ left: 6 + d * 12 }} />
                  ))}
                  <span className="wf-dot" style={{ background: color }} />
                  <span className="wf-label-op" title={`${s.participant} · ${s.operation}`}>
                    {s.operation}
                  </span>
                </div>
                <div className="wf-track">
                  <div
                    className={error ? "wf-bar wf-bar-error" : "wf-bar"}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: error ? undefined : color }}
                  />
                  <span
                    className="wf-bar-dur"
                    style={durInside ? { left: `${leftPct}%`, right: "auto", marginLeft: 4 } : { left: `${leftPct + widthPct}%`, right: "auto", marginLeft: 4 }}
                  >
                    {formatMicros(s.duration)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
