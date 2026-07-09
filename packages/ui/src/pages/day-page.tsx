import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, fetchDaySummary, fetchEndpointLatency, fetchEndpointFlamegraph } from "../lib/api";
import { formatMicros } from "../lib/format";
import { ThroughputChart } from "../components/throughput-chart";
import { LatencyChart } from "../components/latency-chart";
import { LatencyHistogram } from "../components/latency-histogram";
import { LatencyHeatmap } from "../components/latency-heatmap";
import { FlamegraphView } from "../components/flamegraph-view";
import type { DaySummary, LatencyBucket, LatencyDistribution, FlameNode } from "../lib/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error"; message: string }
  | { kind: "ready"; summary: DaySummary };

function RollupCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rollup-card">
      <div className="rollup-value">{value}</div>
      <div className="rollup-label">{label}</div>
    </div>
  );
}

export function DayPage() {
  const { date } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [latEndpoint, setLatEndpoint] = useState<string | null>(null);
  const [latBuckets, setLatBuckets] = useState<LatencyBucket[] | null>(null);
  const [latDist, setLatDist] = useState<LatencyDistribution | null>(null);
  const [flame, setFlame] = useState<FlameNode | null>(null);

  const selectEndpoint = (op: string) => {
    if (!date) return;
    setLatEndpoint(op);
    setLatBuckets(null);
    setLatDist(null);
    setFlame(null);
    fetchEndpointLatency(date, op)
      .then((r) => {
        setLatBuckets(r.buckets);
        setLatDist(r.distribution);
      })
      .catch(() => {
        setLatBuckets([]);
        setLatDist({ histogram: [], heatmap: [] });
      });
    fetchEndpointFlamegraph(date, op)
      .then((r) => setFlame(r.flame))
      .catch(() => setFlame({ operation: "", participant: "", totalMicros: 0, selfMicros: 0, count: 0, children: [] }));
  };

  useEffect(() => {
    if (!date) {
      setState({ kind: "not-found" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchDaySummary(date)
      .then((summary) => {
        if (!cancelled) setState({ kind: "ready", summary });
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
  }, [date]);

  return (
    <div className="day-page">
      <div className="trace-page-bar">
        <Link to="/history" className="back-link">
          ← History
        </Link>
      </div>

      {state.kind === "loading" && (
        <div className="empty-hint">Loading summary…</div>
      )}

      {state.kind === "not-found" && (
        <div className="empty-hint">No summary for this day.</div>
      )}

      {state.kind === "error" && (
        <div className="empty-hint error-text">
          Failed to load: {state.message}
        </div>
      )}

      {state.kind === "ready" && (
        <div className="day-scroll">
          <h1 className="page-title">{state.summary.day}</h1>

          <div className="rollup-grid">
            <RollupCard
              label="Requests"
              value={state.summary.requests.toLocaleString()}
            />
            <RollupCard
              label="Error rate"
              value={`${(state.summary.errorRate * 100).toFixed(1)}%`}
            />
            <RollupCard
              label="p50"
              value={formatMicros(state.summary.p50Micros)}
            />
            <RollupCard
              label="p95"
              value={formatMicros(state.summary.p95Micros)}
            />
            <RollupCard
              label="p99"
              value={formatMicros(state.summary.p99Micros)}
            />
          </div>

          <section className="day-section">
            <h2 className="section-title">Throughput</h2>
            <div className="chart-card">
              <ThroughputChart buckets={state.summary.throughput} />
            </div>
          </section>

          <section className="day-section">
            <h2 className="section-title">Top endpoints</h2>
            {state.summary.topEndpoints.length === 0 ? (
              <div className="empty-hint">No endpoints.</div>
            ) : (
              <div className="day-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Operation</th>
                      <th className="num">Calls</th>
                      <th className="num">Errors</th>
                      <th className="num">Avg</th>
                      <th className="num">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.summary.topEndpoints.map((e) => (
                      <tr
                        key={e.operation}
                        className={
                          "row-clickable" + (e.operation === latEndpoint ? " row-selected" : "")
                        }
                        onClick={() => selectEndpoint(e.operation)}
                      >
                        <td className="op-cell" title={e.operation}>
                          {e.operation}
                        </td>
                        <td className="num">{e.calls.toLocaleString()}</td>
                        <td className={e.errors > 0 ? "num error-text" : "num"}>
                          {e.errors.toLocaleString()}
                        </td>
                        <td className="num">{formatMicros(e.avgMicros)}</td>
                        <td className="num">{formatMicros(e.maxMicros)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="day-section">
            <h2 className="section-title">Latency over time</h2>
            {latEndpoint === null ? (
              <div className="muted">Click an endpoint above to see its p50 / p95 / p99 over the day.</div>
            ) : latBuckets === null ? (
              <div className="muted">Loading…</div>
            ) : (
              <div className="chart-card">
                <LatencyChart buckets={latBuckets} endpoint={latEndpoint} />
              </div>
            )}
          </section>

          {latEndpoint !== null && latDist !== null && (
            <section className="day-section">
              <h2 className="section-title">Latency distribution — {latEndpoint}</h2>
              <div className="chart-card">
                <div className="chart-subtitle">Distribution (how requests spread across latency)</div>
                <LatencyHistogram histogram={latDist.histogram} />
                <div className="chart-subtitle chart-subtitle-spaced">
                  Heatmap over time (slowest on top — a rising band is a regression)
                </div>
                <LatencyHeatmap heatmap={latDist.heatmap} />
              </div>
            </section>
          )}

          {latEndpoint !== null && flame !== null && flame.children.length > 0 && (
            <section className="day-section">
              <h2 className="section-title">Where time goes — {latEndpoint}</h2>
              <div className="chart-card">
                <div className="chart-subtitle">
                  Aggregate flamegraph over the endpoint's recent traces (width = share of time)
                </div>
                <FlamegraphView root={flame} />
              </div>
            </section>
          )}

          <section className="day-section">
            <h2 className="section-title">Slowest traces</h2>
            {state.summary.slowest.length === 0 ? (
              <div className="empty-hint">No traces.</div>
            ) : (
              <ul className="trace-list day-trace-list">
                {state.summary.slowest.map((t) => (
                  <li key={t.traceId} className="trace-row">
                    <Link
                      to={`/trace/${encodeURIComponent(t.traceId)}`}
                      className="day-trace-link"
                    >
                      <div className="trace-row-top">
                        <span className="trace-op" title={t.rootOperation}>
                          {t.rootOperation}
                        </span>
                        {t.hasError && (
                          <span className="dot dot-error" title="error" />
                        )}
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
          </section>
        </div>
      )}
    </div>
  );
}
