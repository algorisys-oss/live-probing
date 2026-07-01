import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchTraceDetail } from "../lib/api";
import { useLiveStore } from "../store/use-live-store";
import { formatMicros } from "../lib/format";
import type { SpanRow, TraceDetail } from "../lib/types";

// Total duration per participant:operation across a trace's spans.
function opStats(spans: SpanRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of spans ?? []) {
    const k = `${s.participant}: ${s.operation}`;
    m.set(k, (m.get(k) ?? 0) + s.duration);
  }
  return m;
}

function SummaryHead({ d, label }: { d: TraceDetail; label: string }) {
  const s = d.summary;
  return (
    <div className="cmp-head">
      <span className="cmp-badge">{label}</span>
      <span className="mono cmp-op">{s.rootOperation}</span>
      <span className="muted">
        {s.services.length} svc · {s.spanCount} spans · {formatMicros(s.durationMicros)}
      </span>
      {s.hasError && <span className="badge badge-error">error</span>}
    </div>
  );
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const recent = useLiveStore((s) => s.traces);

  const [da, setDa] = useState<TraceDetail | null>(null);
  const [db, setDb] = useState<TraceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ a, b });
  useEffect(() => setForm({ a, b }), [a, b]);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setDa(null);
    setDb(null);
    if (a) fetchTraceDetail(a).then((d) => !cancelled && setDa(d)).catch(() => !cancelled && setErr("Trace A not found."));
    if (b) fetchTraceDetail(b).then((d) => !cancelled && setDb(d)).catch(() => !cancelled && setErr("Trace B not found."));
    return () => {
      cancelled = true;
    };
  }, [a, b]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.a.trim()) next.a = form.a.trim();
    if (form.b.trim()) next.b = form.b.trim();
    setParams(next);
  };

  let diff: { k: string; av: number; bv: number; delta: number }[] | null = null;
  if (da && db) {
    const sa = opStats(da.spans ?? []);
    const sb = opStats(db.spans ?? []);
    const keys = new Set([...sa.keys(), ...sb.keys()]);
    diff = [...keys]
      .map((k) => {
        const av = sa.get(k) ?? 0;
        const bv = sb.get(k) ?? 0;
        return { k, av, bv, delta: bv - av };
      })
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  }

  return (
    <div className="page compare-page">
      <div className="trace-page-bar">
        <Link to="/" className="back-link">
          ← Live
        </Link>
      </div>
      <h1 className="page-title">Compare traces</h1>

      <form className="search-form" onSubmit={submit}>
        <input
          className="search-input search-input-wide"
          list="recent-traces"
          placeholder="trace A id"
          value={form.a}
          onChange={(e) => setForm({ ...form, a: e.target.value })}
        />
        <input
          className="search-input search-input-wide"
          list="recent-traces"
          placeholder="trace B id"
          value={form.b}
          onChange={(e) => setForm({ ...form, b: e.target.value })}
        />
        <datalist id="recent-traces">
          {recent.map((t) => (
            <option key={t.traceId} value={t.traceId}>
              {t.rootOperation}
            </option>
          ))}
        </datalist>
        <button className="btn btn-accent" type="submit">
          Compare
        </button>
      </form>

      {err && <div className="error-msg">{err}</div>}
      {!a && !b && (
        <div className="muted">Pick two traces (paste ids or choose from recent) to diff their structure and timing.</div>
      )}

      {(da || db) && (
        <div className="cmp-summaries">
          <div className="cmp-col">{da ? <SummaryHead d={da} label="A" /> : <div className="muted">loading A…</div>}</div>
          <div className="cmp-col">{db ? <SummaryHead d={db} label="B" /> : <div className="muted">loading B…</div>}</div>
        </div>
      )}

      {diff && (
        <>
          <h2 className="section-title">Operation timing (total duration per operation)</h2>
          <table className="data-table cmp-table">
            <thead>
              <tr>
                <th>Operation</th>
                <th className="num">A</th>
                <th className="num">B</th>
                <th className="num">Δ (B−A)</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((r) => (
                <tr key={r.k}>
                  <td className="mono">{r.k}</td>
                  <td className="num">{r.av ? formatMicros(r.av) : "—"}</td>
                  <td className="num">{r.bv ? formatMicros(r.bv) : "—"}</td>
                  <td className={"num " + (r.delta > 0 ? "err-text" : r.delta < 0 ? "good-text" : "muted")}>
                    {r.delta === 0 ? "0" : (r.delta > 0 ? "+" : "−") + formatMicros(Math.abs(r.delta))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
