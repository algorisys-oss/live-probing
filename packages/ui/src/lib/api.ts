import type {
  DayInfo,
  DaySummary,
  ErrorGroup,
  FlameNode,
  LatencyBucket,
  LatencyDistribution,
  ServiceDetail,
  TraceDetail,
  TraceSummary,
  Topology,
} from "./types";

// API/ws origin. Prefer an explicit build-time override; otherwise use the
// origin the app was served from (port-agnostic static deploy). Only in the
// Vite dev server (UI on :5173, API elsewhere) do we fall back to :4319.
export const BASE_URL: string =
  import.meta.env.VITE_LIVEPROBE_URL ??
  (import.meta.env.DEV ? "http://localhost:4319" : window.location.origin);

export function wsUrl(): string {
  const httpBase = BASE_URL.replace(/\/+$/, "");
  const ws = httpBase.replace(/^http/, "ws");
  return `${ws}/ws`;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`GET ${path} failed: ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new ApiError(path, res.status);
  }
  return (await res.json()) as T;
}

export function fetchTraces(limit = 100): Promise<{ traces: TraceSummary[] }> {
  return getJson<{ traces: TraceSummary[] }>(`/api/traces?limit=${limit}`);
}

export function fetchTraceDetail(id: string): Promise<TraceDetail> {
  return getJson<TraceDetail>(`/api/traces/${encodeURIComponent(id)}`);
}

export function fetchDays(): Promise<{ days: DayInfo[] }> {
  return getJson<{ days: DayInfo[] }>(`/api/days`);
}

export function fetchDaySummary(date: string): Promise<DaySummary> {
  return getJson<DaySummary>(`/api/day/${encodeURIComponent(date)}/summary`);
}

export function fetchDayTraces(
  date: string,
  limit = 200,
): Promise<{ traces: TraceSummary[] }> {
  return getJson<{ traces: TraceSummary[] }>(
    `/api/day/${encodeURIComponent(date)}/traces?limit=${limit}`,
  );
}

export function fetchTopology(): Promise<{
  topology: Topology;
  mermaidFlow: string;
}> {
  return getJson<{ topology: Topology; mermaidFlow: string }>(`/api/topology`);
}

export function fetchErrors(limit = 100): Promise<{ groups: ErrorGroup[] }> {
  return getJson<{ groups: ErrorGroup[] }>(`/api/errors?limit=${limit}`);
}

export function fetchService(name: string): Promise<ServiceDetail> {
  return getJson<ServiceDetail>(`/api/service/${encodeURIComponent(name)}`);
}

export function fetchEndpointLatency(
  date: string,
  endpoint: string,
): Promise<{ buckets: LatencyBucket[]; distribution: LatencyDistribution }> {
  return getJson<{ buckets: LatencyBucket[]; distribution: LatencyDistribution }>(
    `/api/day/${encodeURIComponent(date)}/latency?endpoint=${encodeURIComponent(endpoint)}`,
  );
}

export function fetchEndpointFlamegraph(date: string, endpoint: string): Promise<{ flame: FlameNode }> {
  return getJson<{ flame: FlameNode }>(
    `/api/day/${encodeURIComponent(date)}/flamegraph?endpoint=${encodeURIComponent(endpoint)}`,
  );
}

export interface SearchParams {
  q?: string;
  service?: string;
  attr?: string;
  error?: string; // "", "true", "false"
  minMs?: string;
  maxMs?: string;
  minSpans?: string;
  sort?: string; // "recent" | "slowest"
  limit?: number;
}

export function fetchSearch(params: SearchParams): Promise<{ traces: TraceSummary[] }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.service) qs.set("service", params.service);
  if (params.attr) qs.set("attr", params.attr);
  if (params.error) qs.set("error", params.error);
  if (params.minMs) qs.set("minMs", params.minMs);
  if (params.maxMs) qs.set("maxMs", params.maxMs);
  if (params.minSpans) qs.set("minSpans", params.minSpans);
  if (params.sort) qs.set("sort", params.sort);
  qs.set("limit", String(params.limit ?? 200));
  return getJson<{ traces: TraceSummary[] }>(`/api/search?${qs.toString()}`);
}
