import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, fetchTraceDetail } from "../lib/api";
import { formatMicros } from "../lib/format";
import { SequenceView } from "../components/sequence-view";
import { WaterfallView, SpanDetail } from "../components/waterfall-view";
import { copyText } from "../lib/export-diagram";
import type { TraceDetail } from "../lib/types";

type TraceTab = "waterfall" | "sequence";

type LoadState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: TraceDetail };

export function TracePage() {
  const { traceId } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [tab, setTab] = useState<TraceTab>("waterfall");
  // Selected span is shared across both tabs (waterfall rows + sequence arrows).
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) {
      setState({ kind: "not-found" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    setSelectedSpanId(null);
    fetchTraceDetail(traceId)
      .then((detail) => {
        if (cancelled) return;
        setState({ kind: "ready", detail });
        // Deep-link: honor #spanId in the URL if it names a real span; otherwise land on the
        // failing span, else the root.
        const spans = detail.spans ?? [];
        const hashId = window.location.hash.slice(1);
        const initial =
          hashId && spans.some((s) => s.spanId === hashId)
            ? hashId
            : (spans.find((s) => s.status === "error")?.spanId ?? spans[0]?.spanId ?? null);
        setSelectedSpanId(initial);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setState({ kind: "not-found" });
        } else {
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  // Select a span and reflect it in the URL hash (shareable deep-link), without a history entry.
  const selectSpan = useCallback((id: string) => {
    setSelectedSpanId(id);
    if (id) window.history.replaceState(null, "", `#${id}`);
  }, []);

  return (
    <div className="trace-page">
      <div className="trace-page-bar">
        <Link to="/" className="back-link">
          ← Live
        </Link>
        {traceId && (
          <Link to={`/compare?a=${encodeURIComponent(traceId)}`} className="back-link compare-link">
            compare ⇄
          </Link>
        )}
      </div>

      {state.kind === "loading" && (
        <div className="empty-hint">Loading trace…</div>
      )}

      {state.kind === "not-found" && (
        <div className="empty-hint">
          Trace not found — it may have aged out of the live window.
        </div>
      )}

      {state.kind === "error" && (
        <div className="empty-hint error-text">
          Failed to load: {state.message}
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <div className="seq-summary">
            <div className="seq-summary-op">
              {state.detail.summary.rootOperation}
            </div>
            <div className="seq-summary-meta">
              <span>{state.detail.summary.services.length} services</span>
              <span>·</span>
              <span>{state.detail.summary.spanCount} spans</span>
              <span>·</span>
              <span>{formatMicros(state.detail.summary.durationMicros)}</span>
              {state.detail.summary.hasError && (
                <span className="badge badge-error">error</span>
              )}
            </div>
            <div className="seq-summary-services">
              {state.detail.summary.services.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="tabs">
            <button
              className={tab === "waterfall" ? "tab tab-active" : "tab"}
              onClick={() => setTab("waterfall")}
            >
              Waterfall
            </button>
            <button
              className={tab === "sequence" ? "tab tab-active" : "tab"}
              onClick={() => setTab("sequence")}
            >
              Sequence
            </button>
            <button
              className="tab-export"
              title="Copy the sequence diagram as Mermaid"
              onClick={() => copyText(state.detail.mermaidSequence)}
            >
              copy mermaid
            </button>
          </div>

          {(() => {
            const spans = state.detail.spans ?? [];
            const selectedSpan = spans.find((s) => s.spanId === selectedSpanId) ?? null;
            return (
              <div className="trace-body">
                <div className="trace-view">
                  {tab === "waterfall" ? (
                    <WaterfallView
                      key={traceId}
                      spans={spans}
                      traceStart={state.detail.summary.startTime}
                      traceDuration={state.detail.summary.durationMicros}
                      selectedId={selectedSpanId}
                      onSelect={selectSpan}
                      criticalPath={state.detail.criticalPath}
                    />
                  ) : (
                    <SequenceView
                      detail={state.detail}
                      showSummary={false}
                      selectedSpanId={selectedSpanId}
                      onSelectSpan={selectSpan}
                    />
                  )}
                </div>
                {selectedSpan && (
                  <SpanDetail span={selectedSpan} traceStart={state.detail.summary.startTime} />
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
