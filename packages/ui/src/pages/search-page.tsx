import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, fetchSearch } from "../lib/api";
import { useLiveStore } from "../store/use-live-store";
import type { TraceSummary } from "../lib/types";
import { formatMicros } from "../lib/format";

// Search all recorded traces. Filters live in the URL so a search is shareable and the
// back button works.
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const knownServices = useLiveStore((s) => s.topology.nodes);
  const q = params.get("q") ?? "";
  const service = params.get("service") ?? "";
  const attr = params.get("attr") ?? "";
  const error = params.get("error") ?? "";
  const minMs = params.get("minMs") ?? "";
  const maxMs = params.get("maxMs") ?? "";
  const minSpans = params.get("minSpans") ?? "";
  const sort = params.get("sort") ?? "recent";
  const hasQuery = Boolean(q || service || attr || error || minMs || maxMs || minSpans);

  const [form, setForm] = useState({ q, service, attr, error, minMs, maxMs, minSpans, sort });
  useEffect(
    () => setForm({ q, service, attr, error, minMs, maxMs, minSpans, sort }),
    [q, service, attr, error, minMs, maxMs, minSpans, sort],
  );

  const [results, setResults] = useState<TraceSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!hasQuery) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchSearch({ q, service, attr, error, minMs, maxMs, minSpans, sort })
      .then((r) => !cancelled && setResults(r.traces))
      .catch((e) => !cancelled && setErr(e instanceof ApiError ? `Error ${e.status}` : "Search failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [q, service, attr, error, minMs, maxMs, minSpans, sort, hasQuery]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.q.trim()) next.q = form.q.trim();
    if (form.service.trim()) next.service = form.service.trim();
    if (form.attr.trim()) next.attr = form.attr.trim();
    if (form.error) next.error = form.error;
    if (form.minMs) next.minMs = form.minMs;
    if (form.maxMs) next.maxMs = form.maxMs;
    if (form.minSpans) next.minSpans = form.minSpans;
    if (form.sort && form.sort !== "recent") next.sort = form.sort;
    setParams(next);
  };

  return (
    <div className="page search-page">
      <h1 className="page-title">Search traces</h1>

      <form className="search-form" onSubmit={submit}>
        <input
          className="search-input"
          placeholder="endpoint contains… (e.g. /checkout)"
          value={form.q}
          onChange={(e) => setForm({ ...form, q: e.target.value })}
        />
        <input
          className="search-input"
          placeholder="service (e.g. payment-worker)"
          list="known-services"
          value={form.service}
          onChange={(e) => setForm({ ...form, service: e.target.value })}
        />
        <datalist id="known-services">
          {knownServices.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <input
          className="search-input search-input-wide"
          placeholder="attribute: key=value or value (e.g. http.status_code=500)"
          value={form.attr}
          onChange={(e) => setForm({ ...form, attr: e.target.value })}
        />
        <select
          className="search-input"
          value={form.error}
          onChange={(e) => setForm({ ...form, error: e.target.value })}
        >
          <option value="">any status</option>
          <option value="true">errors only</option>
          <option value="false">no errors</option>
        </select>
        <input
          className="search-input search-input-num"
          type="number"
          min="0"
          placeholder="min ms"
          value={form.minMs}
          onChange={(e) => setForm({ ...form, minMs: e.target.value })}
        />
        <input
          className="search-input search-input-num"
          type="number"
          min="0"
          placeholder="max ms"
          value={form.maxMs}
          onChange={(e) => setForm({ ...form, maxMs: e.target.value })}
        />
        <input
          className="search-input search-input-num"
          type="number"
          min="0"
          placeholder="min spans"
          value={form.minSpans}
          onChange={(e) => setForm({ ...form, minSpans: e.target.value })}
        />
        <select
          className="search-input"
          value={form.sort}
          onChange={(e) => setForm({ ...form, sort: e.target.value })}
          title="Sort order"
        >
          <option value="recent">newest first</option>
          <option value="slowest">slowest first</option>
        </select>
        <button type="submit" className="btn btn-accent">
          Search
        </button>
      </form>

      {!hasQuery && <div className="muted">Enter a filter above to search all recorded traces.</div>}
      {loading && <div className="muted">Searching…</div>}
      {err && <div className="error-msg">{err}</div>}

      {results && !loading && (
        <>
          <div className="muted search-count">
            {results.length} result{results.length === 1 ? "" : "s"}
          </div>
          {results.length === 0 ? (
            <div className="muted">No traces match those filters.</div>
          ) : (
            <ul className="trace-list search-results">
              {results.map((t) => (
                <li key={t.traceId} className="trace-row">
                  <Link className="trace-row-link" to={`/trace/${encodeURIComponent(t.traceId)}`}>
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
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
