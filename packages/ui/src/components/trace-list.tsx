import { useEffect, useRef, useState } from "react";
import { useLiveStore } from "../store/use-live-store";
import { formatMicros } from "../lib/format";

/** Track which trace ids are brand-new so we can flash them briefly. */
function useNewFlags(ids: string[]): Set<string> {
  const seenRef = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const firstRun = useRef(true);

  useEffect(() => {
    const seen = seenRef.current;
    if (firstRun.current) {
      // Don't flash the initial snapshot.
      for (const id of ids) seen.add(id);
      firstRun.current = false;
      return;
    }
    const newlyAdded: string[] = [];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        newlyAdded.push(id);
      }
    }
    if (newlyAdded.length === 0) return;

    setFresh((prev) => {
      const next = new Set(prev);
      for (const id of newlyAdded) next.add(id);
      return next;
    });

    const timer = setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const id of newlyAdded) next.delete(id);
        return next;
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [ids]);

  return fresh;
}

export function TraceList() {
  const traces = useLiveStore((s) => s.traces);
  const selectedTraceId = useLiveStore((s) => s.selectedTraceId);
  const selectTrace = useLiveStore((s) => s.selectTrace);

  const ids = traces.map((t) => t.traceId);
  const fresh = useNewFlags(ids);

  if (traces.length === 0) {
    return <div className="trace-list-empty">No traces yet…</div>;
  }

  return (
    <ul className="trace-list">
      {traces.map((t) => {
        const selected = t.traceId === selectedTraceId;
        const isNew = fresh.has(t.traceId);
        return (
          <li
            key={t.traceId}
            className={[
              "trace-row",
              selected ? "trace-row-selected" : "",
              isNew ? "trace-row-new" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => selectTrace(t.traceId)}
          >
            <div className="trace-row-top">
              <span className="trace-op" title={t.rootOperation}>
                {t.rootOperation}
              </span>
              {t.hasError && <span className="dot dot-error" title="error" />}
            </div>
            <div className="trace-row-meta">
              <span>{t.services.length} svc</span>
              <span>·</span>
              <span>{t.spanCount} spans</span>
              <span>·</span>
              <span>{formatMicros(t.durationMicros)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
