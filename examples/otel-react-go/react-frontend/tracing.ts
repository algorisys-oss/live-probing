// LiveProbe browser tracing for a React app.
//
// The browser OTLP/HTTP exporter emits JSON, and LiveProbe reads JSON, so we
// post directly to LiveProbe's /v1/traces — no collector on the frontend.
// LiveProbe already sends `access-control-allow-origin: *`, so CORS is fine.
//
// Call initTracing() ONCE, before your app makes any fetch/XHR calls (e.g. at
// the top of main.tsx, before ReactDOM.render).
//
// Packages (OpenTelemetry JS 2.x):
//   npm i @opentelemetry/sdk-trace-web @opentelemetry/sdk-trace-base \
//         @opentelemetry/exporter-trace-otlp-http @opentelemetry/context-zone \
//         @opentelemetry/instrumentation @opentelemetry/instrumentation-fetch \
//         @opentelemetry/instrumentation-xml-http-request \
//         @opentelemetry/resources @opentelemetry/semantic-conventions \
//         @opentelemetry/core

import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

// LiveProbe ingest (native OTLP/JSON traces endpoint).
const LIVEPROBE_URL = "http://localhost:4319/v1/traces";

// Your Go API origin(s). The W3C `traceparent` header is only injected on
// requests matching these, so frontend spans stitch into the backend trace.
// Widen/narrow to match where your API actually lives.
const API_ORIGINS = [/^http:\/\/localhost:8080/];

export function initTracing(serviceName = "react-app"): void {
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: LIVEPROBE_URL })),
    ],
  });

  provider.register({
    // ZoneContextManager keeps span context across async boundaries in the browser.
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({ propagateTraceHeaderCorsUrls: API_ORIGINS }),
      new XMLHttpRequestInstrumentation({ propagateTraceHeaderCorsUrls: API_ORIGINS }),
    ],
  });
}
