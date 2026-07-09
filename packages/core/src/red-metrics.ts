import type { AssembledTrace } from "./trace-window.js";

// RED (Rate, Errors, Duration) per service, from the live window — the classic triage triad:
// how much traffic a service handles, how much of it fails, and how slow it is (p95). Computed
// from server-kind spans, since those are the requests a service actually handled (a client span
// is an outbound call, not the service's own work; datastores/ghosts have no server span and are
// omitted — they aren't handlers you'd RED-monitor).
export interface RedMetric {
  service: string;
  ratePerSec: number;
  errorRate: number; // 0..1
  p95Micros: number;
  calls: number;
  errors: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

/**
 * Per-service RED metrics over a set of assembled traces (the live window). Pure and
 * order-independent. Rate uses a shared denominator — the observed span time range — so
 * services are comparable and a quiet service doesn't show an inflated rate.
 */
export function redMetrics(traces: AssembledTrace[]): RedMetric[] {
  const byService = new Map<string, { durations: number[]; errors: number }>();
  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const t of traces) {
    for (const e of t.events) {
      if (e.kind !== "server") continue;
      let s = byService.get(e.participant);
      if (!s) {
        s = { durations: [], errors: 0 };
        byService.set(e.participant, s);
      }
      s.durations.push(e.duration);
      if (e.status === "error") s.errors++;
      if (e.startTime < minStart) minStart = e.startTime;
      if (e.startTime + e.duration > maxEnd) maxEnd = e.startTime + e.duration;
    }
  }

  const windowSec = Number.isFinite(minStart) ? Math.max(1, (maxEnd - minStart) / 1_000_000) : 1;

  return [...byService.entries()]
    .map(([service, s]): RedMetric => {
      const sorted = [...s.durations].sort((a, b) => a - b);
      const calls = sorted.length;
      return {
        service,
        calls,
        errors: s.errors,
        errorRate: calls > 0 ? s.errors / calls : 0,
        p95Micros: percentile(sorted, 0.95),
        ratePerSec: calls / windowSec,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}
