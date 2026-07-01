import { useEffect, useState } from "react";
import { useLiveStore } from "../store/use-live-store";
import { fetchTraceDetail } from "../lib/api";
import { formatMicros } from "../lib/format";
import type { TraceDetail } from "../lib/types";

const COL_W = 170;
const HEADER_H = 56;
const ROW_H = 46;
const MARGIN_X = 40;
const MARGIN_TOP = 20;

interface SequenceViewProps {
  /**
   * When provided, render this trace's sequence instead of reading
   * `selectedTraceId` from the store (used by the dedicated trace page).
   */
  traceId?: string;
  /**
   * When false, the built-in summary header is not rendered (the trace page
   * shows its own header). Defaults to true.
   */
  showSummary?: boolean;
}

export function SequenceView({
  traceId,
  showSummary = true,
}: SequenceViewProps = {}) {
  const storeSelectedTraceId = useLiveStore((s) => s.selectedTraceId);
  const selectedTraceId = traceId ?? storeSelectedTraceId;
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedTraceId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTraceDetail(selectedTraceId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTraceId]);

  if (!selectedTraceId) {
    return (
      <div className="empty-hint">
        Select a trace from the list to view its sequence diagram.
      </div>
    );
  }

  if (loading && !detail) {
    return <div className="empty-hint">Loading trace…</div>;
  }

  if (error) {
    return <div className="empty-hint error-text">Failed to load: {error}</div>;
  }

  if (!detail) {
    return <div className="empty-hint">No detail available.</div>;
  }

  const { summary, sequence } = detail;
  const participants = sequence.participants;
  const colX = new Map<string, number>();
  participants.forEach((p, i) => {
    colX.set(p, MARGIN_X + COL_W / 2 + i * COL_W);
  });

  const svgWidth = MARGIN_X * 2 + participants.length * COL_W;
  const svgHeight =
    HEADER_H + MARGIN_TOP + sequence.messages.length * ROW_H + 40;
  const lifelineTop = HEADER_H;
  const lifelineBottom = svgHeight - 20;

  return (
    <div className="seq-container">
      {showSummary && (
        <div className="seq-summary">
          <div className="seq-summary-op">{summary.rootOperation}</div>
          <div className="seq-summary-meta">
            <span>{summary.services.length} services</span>
            <span>·</span>
            <span>{summary.spanCount} spans</span>
            <span>·</span>
            <span>{formatMicros(summary.durationMicros)}</span>
            {summary.hasError && (
              <span className="badge badge-error">error</span>
            )}
          </div>
          <div className="seq-summary-services">
            {summary.services.map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="seq-scroll">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="seq-svg"
        >
          <defs>
            <marker
              id="seq-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="seq-arrowhead" />
            </marker>
            <marker
              id="seq-arrow-error"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                className="seq-arrowhead-error"
              />
            </marker>
          </defs>

          {/* lifelines + headers */}
          {participants.map((p) => {
            const x = colX.get(p)!;
            const label = p.length > 18 ? p.slice(0, 17) + "…" : p;
            return (
              <g key={p}>
                <rect
                  x={x - COL_W / 2 + 8}
                  y={10}
                  width={COL_W - 16}
                  height={34}
                  rx={6}
                  className="seq-participant"
                />
                <text x={x} y={32} className="seq-participant-label">
                  {label}
                </text>
                <line
                  x1={x}
                  y1={lifelineTop}
                  x2={x}
                  y2={lifelineBottom}
                  className="seq-lifeline"
                />
              </g>
            );
          })}

          {/* messages */}
          {sequence.messages.map((m, i) => {
            const fromX = colX.get(m.from);
            const toX = colX.get(m.to);
            if (fromX === undefined || toX === undefined) return null;
            const y = HEADER_H + MARGIN_TOP + i * ROW_H;
            const isError = m.status === "error";
            const selfCall = m.from === m.to;
            const labelText =
              m.label.length > 40 ? m.label.slice(0, 39) + "…" : m.label;

            if (selfCall) {
              const x = fromX;
              return (
                <g key={i} className="seq-msg">
                  <path
                    d={`M ${x} ${y} h 26 v 16 h -26`}
                    className={
                      isError ? "seq-line seq-line-error" : "seq-line"
                    }
                    strokeDasharray={m.async ? "5 4" : undefined}
                    markerEnd={
                      isError
                        ? "url(#seq-arrow-error)"
                        : "url(#seq-arrow)"
                    }
                    fill="none"
                  />
                  <text
                    x={x + 32}
                    y={y - 3}
                    className="seq-msg-label"
                    textAnchor="start"
                  >
                    {labelText}
                  </text>
                </g>
              );
            }

            const midX = (fromX + toX) / 2;
            return (
              <g key={i} className="seq-msg">
                <text
                  x={midX}
                  y={y - 6}
                  className="seq-msg-label"
                  textAnchor="middle"
                >
                  {labelText}
                  {m.durationMicros > 0
                    ? `  (${formatMicros(m.durationMicros)})`
                    : ""}
                </text>
                <line
                  x1={fromX}
                  y1={y}
                  x2={toX}
                  y2={y}
                  className={isError ? "seq-line seq-line-error" : "seq-line"}
                  strokeDasharray={m.async ? "6 4" : undefined}
                  markerEnd={
                    isError ? "url(#seq-arrow-error)" : "url(#seq-arrow)"
                  }
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
