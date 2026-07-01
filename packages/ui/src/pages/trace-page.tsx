import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, fetchTraceDetail } from "../lib/api";
import { formatMicros } from "../lib/format";
import { SequenceView } from "../components/sequence-view";
import { WaterfallView } from "../components/waterfall-view";
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

  useEffect(() => {
    if (!traceId) {
      setState({ kind: "not-found" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchTraceDetail(traceId)
      .then((detail) => {
        if (!cancelled) setState({ kind: "ready", detail });
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

  return (
    <div className="trace-page">
      <div className="trace-page-bar">
        <Link to="/" className="back-link">
          ← Live
        </Link>
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
          </div>

          {tab === "waterfall" ? (
            <WaterfallView
              spans={state.detail.spans}
              traceStart={state.detail.summary.startTime}
              traceDuration={state.detail.summary.durationMicros}
            />
          ) : (
            <SequenceView traceId={traceId} showSummary={false} />
          )}
        </>
      )}
    </div>
  );
}
