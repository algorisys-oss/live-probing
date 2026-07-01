# Integrating a React + Go app with LiveProbe (OpenTelemetry)

A reference for wiring a **greenfield React frontend + Go backend** into LiveProbe with
OpenTelemetry. These are documented snippets to lift into your own app, not a runnable
demo service.

## The one architectural fact that shapes everything

LiveProbe's OTLP ingest reads **OTLP/JSON** (`packages/server/src/server.ts` `JSON.parse`s
the body). The two sides of your stack therefore integrate differently:

```
React (OTel-web) ──OTLP/JSON──────────────────────────► LiveProbe :4319/v1/traces   ✅ direct
Go (OTel SDK) ──OTLP/protobuf──► OTel Collector ──OTLP/JSON──► LiveProbe :4319       (translated)
```

- The **browser** OTLP/HTTP exporter emits JSON, so it posts straight to LiveProbe.
  CORS is already open (`access-control-allow-origin: *`), no proxy needed.
- The **Go** OTLP/HTTP exporter emits protobuf, which LiveProbe can't parse. So Go
  exports to a local **OpenTelemetry Collector** that re-exports with `encoding: json`.
  This is exactly what the repo's own testbed does — see `testbed/otel/collector-config.yaml`.

## Why traces (not logs)

LiveProbe draws diagrams from causal span structure: `traceId` / `spanId` / `parentSpanId`
/ `kind` / timing. A span with `status=error` is your error signal (renders red);
info-level detail rides along as span **attributes**. Plain log lines have none of that
structure, so they can't feed the diagrams. OpenTelemetry's *tracing* signal is the fit.

## Files here

| File | What it is |
|------|-----------|
| `go-backend/telemetry.go` | OTel init: OTLP exporter → collector, TracerProvider, W3C propagator |
| `go-backend/main.go` | `net/http` + `otelhttp` server, pgx pool with `otelpgx` tracer |
| `go-backend/go.mod` | dependency list (run `go mod tidy` to resolve versions) |
| `otel-collector.yaml` | the protobuf→JSON translation hop for the Go side |
| `react-frontend/tracing.ts` | OTel-web init: fetch/XHR auto-instrumentation → LiveProbe direct |

## Run order (local dev)

1. **LiveProbe**: `./dev.sh` (UI at http://localhost:5173, ingest/ws at :4319).
2. **Collector**: `otelcol --config examples/otel-react-go/otel-collector.yaml`
   (listens OTLP/HTTP on :4318, exports JSON to LiveProbe :4319).
3. **Go backend**: point `OTEL_COLLECTOR=localhost:4318`, run it (serves on :8080).
4. **React**: call `initTracing()` once at startup; set `API_ORIGINS` to your Go origin.

Hit a React page that calls the Go API → open LiveProbe → you should see **one connected
trace** spanning `react-app → orders-api → postgres`, with the DB query nested under the
request. The frontend↔backend join happens via the W3C `traceparent` header, which is why
`propagateTraceHeaderCorsUrls` (React) and the `TraceContext` propagator (Go) must agree.

## Quick sanity check before any SDK

Confirm the pipe with a hand-rolled native event (bypasses OTel entirely):

```bash
curl -X POST http://localhost:4319/v1/events -H 'content-type: application/json' -d '{
  "events": [
    {"traceId":"t1","spanId":"a","participant":"react-app","peer":"orders-api","operation":"GET /orders","kind":"client","startTime":1700000000000000,"duration":8000,"status":"ok","attributes":{}},
    {"traceId":"t1","spanId":"b","parentSpanId":"a","participant":"orders-api","operation":"GET /orders","kind":"server","startTime":1700000000001000,"duration":6000,"status":"ok","attributes":{}}
  ]
}'
```

`startTime` is epoch **microseconds**, `duration` is microseconds.
