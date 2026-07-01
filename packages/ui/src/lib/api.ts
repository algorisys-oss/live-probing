import type { TraceDetail, TraceSummary, Topology } from "./types";

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

export function fetchTopology(): Promise<{
  topology: Topology;
  mermaidFlow: string;
}> {
  return getJson<{ topology: Topology; mermaidFlow: string }>(`/api/topology`);
}
