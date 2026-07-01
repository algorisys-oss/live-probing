import { useState } from "react";
import type { SpanRow } from "../lib/types";
import { formatMicros, hashString, isDatastore } from "../lib/format";

function serviceColor(name: string): string {
  if (isDatastore(name)) return "var(--datastore)";
  const hue = hashString(name) % 360;
  return `hsl(${hue} 55% 58%)`;
}

function SpanDetail({ span, traceStart }: { span: SpanRow; traceStart: number }) {
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

export function WaterfallView({ spans = [], traceStart, traceDuration }: { spans?: SpanRow[]; traceStart: number; traceDuration: number }) {
  // Land on the failing span when there is one, else the root. `spans` can be undefined for
  // traces recorded before span capture — guard so an old trace never crashes the page.
  const initial = spans.find((s) => s.status === "error")?.spanId ?? spans[0]?.spanId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initial);

  if (spans.length === 0) {
    return (
      <div className="empty-hint">
        Waterfall not available for this trace (recorded before span capture). Try the Sequence tab.
      </div>
    );
  }

  const total = Math.max(traceDuration, 1);
  const selected = spans.find((s) => s.spanId === selectedId) ?? null;

  return (
    <div className="waterfall">
      <div className="wf-rows">
        {spans.map((s) => {
          const leftPct = Math.min(100, Math.max(0, ((s.startTime - traceStart) / total) * 100));
          const widthPct = Math.min(100 - leftPct, Math.max(0.4, (s.duration / total) * 100));
          const color = serviceColor(s.participant);
          const error = s.status === "error";
          return (
            <div
              key={s.spanId}
              className={s.spanId === selectedId ? "wf-row wf-row-selected" : "wf-row"}
              onClick={() => setSelectedId(s.spanId)}
            >
              <div className="wf-label" style={{ paddingLeft: 6 + s.depth * 12 }}>
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
                <span className="wf-bar-dur">{formatMicros(s.duration)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {selected && <SpanDetail span={selected} traceStart={traceStart} />}
    </div>
  );
}
