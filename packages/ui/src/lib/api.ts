import type {
  DayInfo,
  DaySummary,
  TraceDetail,
  TraceSummary,
  Topology,
} from "./types";

export const BASE_URL: string =
  import.meta.env.VITE_LIVEPROBE_URL ?? "http://localhost:4319";

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

export interface SearchParams {
  q?: string;
  service?: string;
  error?: string; // "", "true", "false"
  minMs?: string;
  limit?: number;
}

export function fetchSearch(params: SearchParams): Promise<{ traces: TraceSummary[] }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.service) qs.set("service", params.service);
  if (params.error) qs.set("error", params.error);
  if (params.minMs) qs.set("minMs", params.minMs);
  qs.set("limit", String(params.limit ?? 200));
  return getJson<{ traces: TraceSummary[] }>(`/api/search?${qs.toString()}`);
}
