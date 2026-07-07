import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOtlp,
  TraceWindow,
  sequenceFor,
  toMermaidSequence,
  toMermaidFlow,
  type Event,
  type OtlpPayload,
} from "./index.js";

// A gateway -> catalog -> postgres/redis trace, in OTLP/HTTP JSON shape.
function attr(key: string, value: string) {
  return { key, value: { stringValue: value } };
}
function span(
  spanId: string,
  name: string,
  kind: number,
  startNano: number,
  endNano: number,
  opts: { parent?: string; attrs?: Array<{ key: string; value: { stringValue: string } }>; error?: boolean } = {},
) {
  return {
    traceId: "trace-1",
    spanId,
    parentSpanId: opts.parent,
    name,
    kind,
    startTimeUnixNano: String(startNano),
    endTimeUnixNano: String(endNano),
    attributes: opts.attrs ?? [],
    status: opts.error ? { code: 2 } : { code: 0 },
  };
}

const NS = 1_000_000_000;
const fixture: OtlpPayload = {
  resourceSpans: [
    {
      resource: { attributes: [attr("service.name", "gateway")] },
      scopeSpans: [
        {
          spans: [
            span("g1", "POST /api/products/:id", 2, NS + 0, NS + 50_000_000),
            span("g2", "GET", 3, NS + 5_000_000, NS + 45_000_000, {
              parent: "g1",
              attrs: [attr("server.address", "catalog")],
            }),
          ],
        },
      ],
    },
    {
      resource: { attributes: [attr("service.name", "catalog")] },
      scopeSpans: [
        {
          spans: [
            span("c1", "GET /products/:id", 2, NS + 10_000_000, NS + 40_000_000, { parent: "g2" }),
            span("c2", "pg.query:SELECT", 3, NS + 15_000_000, NS + 30_000_000, {
              parent: "c1",
              attrs: [attr("db.system", "postgresql")],
              error: true,
            }),
            span("c3", "get", 3, NS + 31_000_000, NS + 35_000_000, {
              parent: "c1",
              attrs: [attr("db.system", "redis")],
            }),
          ],
        },
      ],
    },
  ],
};

test("normalizeOtlp maps spans to normalized events", () => {
  const events = normalizeOtlp(fixture);
  assert.equal(events.length, 5);

  const g1 = events.find((e) => e.spanId === "g1")!;
  assert.equal(g1.participant, "gateway");
  assert.equal(g1.kind, "server");
  assert.equal(g1.parentSpanId, undefined); // root
  assert.equal(g1.startTime, 1_000_000); // 1e9 ns -> 1e6 us
  assert.equal(g1.duration, 50_000);
  assert.equal(g1.peer, undefined); // server spans have no peer

  const c2 = events.find((e) => e.spanId === "c2")!;
  assert.equal(c2.participant, "catalog");
  assert.equal(c2.kind, "client");
  assert.equal(c2.peer, "postgresql");
  assert.equal(c2.status, "error");

  const c3 = events.find((e) => e.spanId === "c3")!;
  assert.equal(c3.peer, "redis");
  assert.equal(c3.status, "unset");
});

test("normalizeOtlp rebuilds a real endpoint name from bare-method HTTP spans", () => {
  const payload: OtlpPayload = {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "gateway")] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: "t",
                spanId: "s",
                name: "POST",
                kind: 2,
                startTimeUnixNano: String(NS),
                endTimeUnixNano: String(NS + 1),
                attributes: [attr("http.method", "POST"), attr("http.target", "/api/cart/items?x=1")],
                status: { code: 0 },
              },
            ],
          },
        ],
      },
    ],
  };
  const [e] = normalizeOtlp(payload);
  assert.equal(e!.operation, "POST /api/cart/items"); // method + path, query stripped
});

test("normalizeOtlp falls back to the real path when http.route is a wildcard", () => {
  // Catch-all frameworks (Remix/SPA) report http.route="*", which would hide every URL
  // behind "GET *". Prefer the concrete request path (http.target/url.path) in that case.
  const payload: OtlpPayload = {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "hrms")] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: "t",
                spanId: "s",
                name: "GET *",
                kind: 2,
                startTimeUnixNano: String(NS),
                endTimeUnixNano: String(NS + 1),
                attributes: [
                  attr("http.method", "GET"),
                  attr("http.route", "*"),
                  attr("http.target", "/permissions/4"),
                ],
                status: { code: 0 },
              },
            ],
          },
        ],
      },
    ],
  };
  const [e] = normalizeOtlp(payload);
  assert.equal(e!.operation, "GET /permissions/4"); // wildcard route ignored in favor of the path
});

test("TraceWindow assembles the tree even when spans arrive out of order", () => {
  const events = normalizeOtlp(fixture);
  const w = new TraceWindow();
  // reverse: children before parents
  w.add([...events].reverse());

  const t = w.assemble("trace-1")!;
  assert.equal(t.roots.length, 1);
  assert.equal(t.roots[0]!.event.spanId, "g1");
  assert.equal(t.roots[0]!.children[0]!.event.spanId, "g2");
  const c1 = t.roots[0]!.children[0]!.children[0]!;
  assert.equal(c1.event.spanId, "c1");
  // children sorted by startTime: c2 (15ms) before c3 (31ms)
  assert.deepEqual(
    c1.children.map((n) => n.event.spanId),
    ["c2", "c3"],
  );
});

test("topology aggregates service and datastore edges with errors", () => {
  const w = new TraceWindow();
  w.add(normalizeOtlp(fixture));
  const topo = w.topology();

  assert.deepEqual(new Set(topo.nodes), new Set(["gateway", "catalog", "postgresql", "redis"]));
  const edge = (from: string, to: string) => topo.edges.find((e) => e.from === from && e.to === to);
  assert.ok(edge("gateway", "catalog"), "gateway -> catalog");
  assert.ok(edge("catalog", "postgresql"), "catalog -> postgresql");
  assert.ok(edge("catalog", "redis"), "catalog -> redis");
  assert.equal(edge("catalog", "postgresql")!.errors, 1); // c2 errored
  assert.equal(edge("gateway", "catalog")!.errors, 0);
});

test("sequenceFor orders messages and lists participants by first appearance", () => {
  const w = new TraceWindow();
  w.add(normalizeOtlp(fixture));
  const seq = sequenceFor(w.assemble("trace-1")!);

  assert.deepEqual(seq.participants, ["gateway", "catalog", "postgresql", "redis"]);
  assert.deepEqual(
    seq.messages.map((m) => `${m.from}->${m.to}:${m.label}`),
    ["gateway->catalog:GET /products/:id", "catalog->postgresql:pg.query:SELECT", "catalog->redis:get"],
  );
});

test("sequenceFor tags each message with the span it represents", () => {
  const w = new TraceWindow();
  w.add(ghostFixture());
  const seq = sequenceFor(w.assemble("t-ghost")!);
  // request arrow -> the callee's server span; peer arrow -> the client span
  assert.deepEqual(
    seq.messages.map((m) => `${m.from}->${m.to}:${m.spanId}`),
    ["gateway->catalog:s", "gateway->legacy-api:g"],
  );
});

test("mermaid exporters produce valid-looking text", () => {
  const w = new TraceWindow();
  w.add(normalizeOtlp(fixture));
  const seqText = toMermaidSequence(sequenceFor(w.assemble("trace-1")!));
  assert.match(seqText, /^sequenceDiagram/);
  assert.match(seqText, /participant gateway as gateway/);
  assert.match(seqText, /gateway->>catalog: GET \/products\/:id/);

  const flowText = toMermaidFlow(w.topology());
  assert.match(flowText, /^graph LR/);
  assert.match(flowText, /catalog\["catalog"\]/);
  assert.match(flowText, /gateway -->\|1\| catalog/);
});

// A trace where gateway calls an instrumented service (catalog reports its own server
// span) and an uninstrumented one (legacy-api exists only as the client span's peer).
function ghostFixture(): Event[] {
  const base = {
    traceId: "t-ghost",
    status: "unset" as const,
    attributes: {},
    duration: 10,
  };
  return [
    { ...base, spanId: "r", participant: "gateway", operation: "GET /home", kind: "server", startTime: 1_000 },
    // instrumented callee: client span + the callee's own server span
    { ...base, spanId: "c", parentSpanId: "r", participant: "gateway", peer: "catalog", operation: "GET /products", kind: "client", startTime: 1_100 },
    { ...base, spanId: "s", parentSpanId: "c", participant: "catalog", operation: "GET /products", kind: "server", startTime: 1_200 },
    // uninstrumented callee: only the client span, peer never reports
    { ...base, spanId: "g", parentSpanId: "r", participant: "gateway", peer: "legacy-api", operation: "GET /legacy", kind: "client", startTime: 1_300 },
  ];
}

test("topology draws ghost edges to uninstrumented peers, once per call", () => {
  const w = new TraceWindow();
  w.add(ghostFixture());
  const topo = w.topology();

  // the uninstrumented peer becomes a node with an edge, flagged external
  assert.ok(topo.nodes.includes("legacy-api"));
  const ghost = topo.edges.find((e) => e.from === "gateway" && e.to === "legacy-api");
  assert.ok(ghost, "gateway -> legacy-api ghost edge");
  assert.equal(ghost!.calls, 1);
  assert.deepEqual(topo.externals, ["legacy-api"]);

  // the instrumented callee is NOT double-counted (parent/child edge only)
  const real = topo.edges.find((e) => e.from === "gateway" && e.to === "catalog");
  assert.equal(real!.calls, 1);
});

test("topology externals excludes datastores and instrumented participants", () => {
  const w = new TraceWindow();
  w.add(normalizeOtlp(fixture)); // postgresql/redis peers + bridged catalog peer
  const topo = w.topology();
  assert.deepEqual(topo.externals, []);
});

test("sequenceFor draws messages to uninstrumented peers and flags them external", () => {
  const w = new TraceWindow();
  w.add(ghostFixture());
  const seq = sequenceFor(w.assemble("t-ghost")!);

  assert.deepEqual(
    seq.messages.map((m) => `${m.from}->${m.to}:${m.label}`),
    ["gateway->catalog:GET /products", "gateway->legacy-api:GET /legacy"],
  );
  assert.deepEqual(seq.participants, ["gateway", "catalog", "legacy-api"]);
  assert.deepEqual(seq.externals, ["legacy-api"]);
});

test("mermaid flow styles external nodes dashed", () => {
  const w = new TraceWindow();
  w.add(ghostFixture());
  const flowText = toMermaidFlow(w.topology());
  assert.match(flowText, /classDef external/);
  assert.match(flowText, /class legacy_api external/);

  // no externals -> no classDef noise
  const clean = new TraceWindow();
  clean.add(normalizeOtlp(fixture));
  assert.doesNotMatch(toMermaidFlow(clean.topology()), /classDef external/);
});

test("window evicts traces older than the horizon and past the cap", () => {
  const w = new TraceWindow({ horizonMicros: 100 });
  const old: Event = {
    traceId: "old",
    spanId: "o1",
    participant: "svc",
    operation: "x",
    kind: "server",
    startTime: 1_000_000,
    duration: 10,
    status: "ok",
    attributes: {},
  };
  w.add([old]);
  assert.equal(w.size(), 1);
  // a much newer trace pushes the horizon past the old one
  w.add([{ ...old, traceId: "new", spanId: "n1", startTime: 5_000_000 }]);
  assert.deepEqual(w.traceIds(), ["new"]);

  const capped = new TraceWindow({ maxTraces: 2 });
  for (let i = 0; i < 3; i++) {
    capped.add([{ ...old, traceId: `t${i}`, spanId: `s${i}`, startTime: 1_000_000 + i }]);
  }
  assert.equal(capped.size(), 2);
});
