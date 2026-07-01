import { expect, type APIRequestContext } from "@playwright/test";

// Deterministic trace fixtures posted to LiveProbe's native ingest (POST /v1/events).
// Ingest persists synchronously (window + history store) before returning 200, so
// after seed() resolves the data is visible to every UI page (live, trace, search,
// errors, day/history).

const MS = 1000; // microseconds per millisecond

export interface SeedEvent {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  participant: string;
  peer?: string;
  operation: string;
  kind: "client" | "server" | "producer" | "consumer" | "internal";
  startTime: number; // epoch microseconds
  duration: number; // microseconds
  status: "ok" | "error" | "unset";
  attributes: Record<string, string | number | boolean>;
}

// Operations we assert on by text.
export const OPS = {
  checkout: "POST /checkout",
  cart: "GET /cart",
  catalog: "GET /catalog",
} as const;

export const TRACE_IDS = {
  checkout: "e2e-checkout",
  cart: "e2e-cart",
  catalog: "e2e-catalog",
} as const;

export const GATEWAY = "web-gateway";

// A gateway → downstream call: root server span, an outbound client span (carries
// `peer` for the flow edge), and the downstream server span.
function crossServiceTrace(opts: {
  traceId: string;
  rootOp: string;
  downstream: string;
  downstreamOp: string;
  start: number;
  error?: boolean;
}): SeedEvent[] {
  const { traceId, rootOp, downstream, downstreamOp, start, error } = opts;
  return [
    {
      traceId,
      spanId: `${traceId}-a`,
      participant: GATEWAY,
      operation: rootOp,
      kind: "server",
      startTime: start,
      duration: 60 * MS,
      status: "ok",
      attributes: { "http.route": rootOp },
    },
    {
      traceId,
      spanId: `${traceId}-b`,
      parentSpanId: `${traceId}-a`,
      participant: GATEWAY,
      peer: downstream,
      operation: rootOp,
      kind: "client",
      startTime: start + 2 * MS,
      duration: 50 * MS,
      status: error ? "error" : "ok",
      attributes: {},
    },
    {
      traceId,
      spanId: `${traceId}-c`,
      parentSpanId: `${traceId}-b`,
      participant: downstream,
      operation: downstreamOp,
      kind: "server",
      startTime: start + 3 * MS,
      duration: 45 * MS,
      status: error ? "error" : "ok",
      attributes: error
        ? { "error.type": "PaymentDeclined", "http.status_code": 402 }
        : { "http.status_code": 200 },
    },
  ];
}

export function buildSeedEvents(now: number): SeedEvent[] {
  return [
    ...crossServiceTrace({
      traceId: TRACE_IDS.checkout,
      rootOp: OPS.checkout,
      downstream: "payments",
      downstreamOp: "charge",
      start: now - 3_000_000,
      error: true,
    }),
    ...crossServiceTrace({
      traceId: TRACE_IDS.cart,
      rootOp: OPS.cart,
      downstream: "cart-service",
      downstreamOp: "read",
      start: now - 2_000_000,
    }),
    ...crossServiceTrace({
      traceId: TRACE_IDS.catalog,
      rootOp: OPS.catalog,
      downstream: "catalog",
      downstreamOp: "list",
      start: now - 1_000_000,
    }),
  ];
}

// Post the fixtures. Uses the request context's baseURL (set in playwright.config).
export async function seed(request: APIRequestContext, now = Date.now() * 1000): Promise<SeedEvent[]> {
  const events = buildSeedEvents(now);
  const res = await request.post("/v1/events", { data: { events } });
  expect(res.ok(), `ingest failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return events;
}
