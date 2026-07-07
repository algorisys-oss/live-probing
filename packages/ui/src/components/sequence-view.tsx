import { useEffect, useState } from "react";
import { useLiveStore } from "../store/use-live-store";
import { fetchTraceDetail } from "../lib/api";
import { formatMicros } from "../lib/format";
import { sequenceLayout } from "../lib/sequence-layout";
import type { TraceDetail } from "../lib/types";

const COL_W = 170;
const HEADER_H = 56;
const ROW_H = 46;
const MARGIN_X = 40;
const MARGIN_TOP = 20;
const ACT_W = 10; // activation bar width
const ACT_LANE = 6; // x-offset per nested activation on one lifeline

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
  /**
   * When provided, render this already-loaded detail instead of fetching it
   * (lets the trace page share one fetch across the waterfall and sequence).
   */
  detail?: TraceDetail;
  /** Currently selected span id, highlighted on its arrow. */
  selectedSpanId?: string | null;
  /** Called when a message arrow is clicked, with the span it represents. */
  onSelectSpan?: (spanId: string) => void;
}

export function SequenceView({
  traceId,
  showSummary = true,
  detail: providedDetail,
  selectedSpanId = null,
  onSelectSpan,
}: SequenceViewProps = {}) {
  const storeSelectedTraceId = useLiveStore((s) => s.selectedTraceId);
  const selectedTraceId = traceId ?? storeSelectedTraceId;
  const [fetchedDetail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Group ids the viewer has expanded. Repeated-sibling runs collapse to a ×N row by default;
  // opening one reveals its members. Reset when the trace changes (the trace page also remounts
  // via key={traceId}, but the store-driven embed swaps traces without remounting).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => setExpanded(new Set()), [selectedTraceId]);

  useEffect(() => {
    if (providedDetail) return; // detail supplied by the parent — nothing to fetch
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
  }, [selectedTraceId, providedDetail]);

  const detail = providedDetail ?? fetchedDetail;

  if (!providedDetail && !selectedTraceId) {
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
  // Uninstrumented "ghost" peers get a dashed lifeline header.
  const externals = new Set(sequence.externals ?? []);
  const colX = new Map<string, number>();
  participants.forEach((p, i) => {
    colX.set(p, MARGIN_X + COL_W / 2 + i * COL_W);
  });

  // UML call/return layout: each sync call becomes an activation bar spanning its call row to
  // its return row, bracketed by nesting. Rows (call + return) drive the vertical axis.
  const layout = sequenceLayout(sequence, expanded);
  const collapsedGroupIds = new Set(
    layout.groups.filter((g) => !expanded.has(g.id)).map((g) => g.id),
  );
  const toggleGroup = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const rowY = (row: number) => HEADER_H + MARGIN_TOP + row * ROW_H;
  const laneX = (participant: string, depth: number) => (colX.get(participant) ?? 0) + depth * ACT_LANE;

  const svgWidth = MARGIN_X * 2 + participants.length * COL_W;
  const svgHeight = HEADER_H + MARGIN_TOP + Math.max(layout.rows.length, 1) * ROW_H + 40;
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
            {/* open / stick head — UML reply arrow and async (fire-and-forget) messages */}
            <marker
              id="seq-arrow-open"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10" className="seq-arrowhead-open" fill="none" />
            </marker>
            <marker
              id="seq-arrow-open-error"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10" className="seq-arrowhead-open-error" fill="none" />
            </marker>
          </defs>

          {/* lifelines + headers */}
          {participants.map((p) => {
            const x = colX.get(p)!;
            const label = p.length > 18 ? p.slice(0, 17) + "…" : p;
            const ghost = externals.has(p);
            return (
              <g key={p}>
                <rect
                  x={x - COL_W / 2 + 8}
                  y={10}
                  width={COL_W - 16}
                  height={34}
                  rx={6}
                  className={ghost ? "seq-participant seq-participant-external" : "seq-participant"}
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

          {/* activation bars — one per sync call, on the callee lifeline (drawn under arrows) */}
          {layout.activations.map((a) => {
            const x = laneX(a.participant, a.depth);
            const top = rowY(a.fromRow);
            const h = Math.max(rowY(a.toRow) - top, 8);
            const selected = selectedSpanId != null && a.spanId === selectedSpanId;
            const isGroup = collapsedGroupIds.has(a.spanId);
            const cls = [
              "seq-activation",
              a.status === "error" ? "seq-activation-error" : "",
              isGroup ? "seq-activation-group" : "",
              selected ? "seq-activation-selected" : "",
            ]
              .filter(Boolean)
              .join(" ");
            // A collapsed group's bar expands the group; a real span selects it.
            const onActClick = isGroup
              ? () => toggleGroup(a.spanId)
              : onSelectSpan
                ? () => onSelectSpan(a.spanId)
                : undefined;
            return (
              <rect
                key={`act-${a.spanId}`}
                x={x - ACT_W / 2}
                y={top}
                width={ACT_W}
                height={h}
                rx={2}
                className={cls}
                onClick={onActClick}
              />
            );
          })}

          {/* call + return arrows, one per layout row */}
          {layout.rows.map((row, i) => {
            const m = row.message;
            const fromX = colX.get(m.from);
            if (fromX === undefined || colX.get(m.to) === undefined) return null;
            const y = rowY(i);
            const isError = m.status === "error";
            const selfCall = m.from === m.to;
            const selected = selectedSpanId != null && m.spanId === selectedSpanId;
            const clickable = onSelectSpan !== undefined;

            // Group rows: the collapsed ×N header and the expanded lead toggle collapse/expand;
            // an expanded member is a normal row that still selects its own span.
            const g = m.group;
            const isGroupRow = m.groupRole === "collapsed" || m.groupRole === "lead";
            const suspectN1 = g ? !g.concurrent && g.count >= 5 : false;
            const groupClass = [
              "seq-msg",
              clickable || isGroupRow ? "seq-msg-clickable" : "",
              isGroupRow ? "seq-msg-group" : "",
              suspectN1 && m.groupRole === "collapsed" ? "seq-msg-n1" : "",
              selected ? "seq-msg-selected" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const onClick = isGroupRow
              ? () => toggleGroup(g!.id)
              : clickable
                ? () => onSelectSpan!(m.spanId)
                : undefined;
            const rawLabel = m.label.length > 40 ? m.label.slice(0, 39) + "…" : m.label;
            const labelText =
              m.groupRole === "collapsed"
                ? `${suspectN1 ? "⚠ " : "▸ "}${rawLabel} ×${g!.count}`
                : m.groupRole === "lead"
                  ? `▾ ${rawLabel} (×${g!.count})`
                  : rawLabel;
            // Collapsed return row trades the single duration for the cluster's aggregate.
            const groupBadge =
              g && m.groupRole === "collapsed"
                ? `Σ${formatMicros(g.totalDurationMicros)} · ${g.concurrent ? "concurrent" : "sequential"}` +
                  (g.errorCount ? ` · ${g.errorCount} err` : "")
                : null;
            const groupTitle = g
              ? `${g.count} identical calls — ${
                  g.concurrent ? "concurrent (fan-out)" : "sequential" + (suspectN1 ? ", likely N+1" : "")
                }. ` +
                `Σ${formatMicros(g.totalDurationMicros)}, avg ${formatMicros(g.avgDurationMicros)}, ` +
                `max ${formatMicros(g.maxDurationMicros)}` +
                (g.errorCount ? `, ${g.errorCount} error${g.errorCount > 1 ? "s" : ""}` : "") +
                `. Click to ${m.groupRole === "collapsed" ? "expand" : "collapse"}.`
              : undefined;

            // Arrows connect the caller lifeline to the near edge of the callee's activation bar.
            const calleeCenter = laneX(m.to, m.depth);
            const dir = calleeCenter >= fromX ? 1 : -1;
            const calleeEdge = calleeCenter - dir * (ACT_W / 2);
            const midX = (fromX + calleeEdge) / 2;
            const hitX = Math.min(fromX, calleeCenter) - 6;
            const hitW = Math.abs(calleeCenter - fromX) + 12;

            // Self-message: a loop on the call row only (the return is implied).
            if (selfCall) {
              if (row.kind === "return") return null;
              const x = calleeCenter;
              return (
                <g key={i} className={groupClass} onClick={onClick}>
                  {groupTitle && <title>{groupTitle}</title>}
                  <rect x={x - 4} y={y - 16} width={COL_W} height={ROW_H} fill="transparent" />
                  <path
                    d={`M ${x + ACT_W / 2} ${y} h 26 v 16 h -26`}
                    className={isError ? "seq-line seq-line-error" : "seq-line"}
                    markerEnd={isError ? "url(#seq-arrow-error)" : "url(#seq-arrow)"}
                    fill="none"
                  />
                  <text x={x + 32} y={y - 3} className="seq-msg-label" textAnchor="start">
                    {labelText}
                  </text>
                </g>
              );
            }

            if (row.kind === "call") {
              // Sync → filled head; async (fire-and-forget) → open/stick head. Line is solid
              // either way — dashing is reserved for the reply.
              const marker = m.async
                ? isError
                  ? "url(#seq-arrow-open-error)"
                  : "url(#seq-arrow-open)"
                : isError
                  ? "url(#seq-arrow-error)"
                  : "url(#seq-arrow)";
              return (
                <g key={i} className={groupClass} onClick={onClick}>
                  {groupTitle && <title>{groupTitle}</title>}
                  <rect x={hitX} y={y - 18} width={hitW} height={ROW_H} fill="transparent" />
                  <text x={midX} y={y - 6} className="seq-msg-label" textAnchor="middle">
                    {labelText}
                  </text>
                  <line
                    x1={fromX}
                    y1={y}
                    x2={calleeEdge}
                    y2={y}
                    className={isError ? "seq-line seq-line-error" : "seq-line"}
                    markerEnd={marker}
                  />
                </g>
              );
            }

            // Return row: dashed reply from the callee's bar back to the caller (open head),
            // labelled with the call's duration.
            const marker = isError ? "url(#seq-arrow-open-error)" : "url(#seq-arrow-open)";
            return (
              <g key={i} className={groupClass} onClick={onClick}>
                {groupTitle && <title>{groupTitle}</title>}
                <rect x={hitX} y={y - 18} width={hitW} height={ROW_H} fill="transparent" />
                <text
                  x={midX}
                  y={y - 6}
                  className={
                    groupBadge ? "seq-msg-label seq-return-label seq-group-badge" : "seq-msg-label seq-return-label"
                  }
                  textAnchor="middle"
                >
                  {groupBadge ?? (m.durationMicros > 0 ? formatMicros(m.durationMicros) : "")}
                </text>
                <line
                  x1={calleeEdge}
                  y1={y}
                  x2={fromX}
                  y2={y}
                  className={isError ? "seq-return seq-return-error" : "seq-return"}
                  strokeDasharray="4 4"
                  markerEnd={marker}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
