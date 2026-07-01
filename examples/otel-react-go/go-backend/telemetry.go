package main

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// initTracer wires an OTLP/HTTP exporter to the local OpenTelemetry Collector,
// which re-exports to LiveProbe as OTLP/JSON. It returns a shutdown func to
// flush pending spans on exit.
//
// collectorEndpoint is host:port of the collector's OTLP/HTTP receiver
// (e.g. "localhost:4318") — NOT LiveProbe. The Go exporter speaks protobuf;
// LiveProbe reads JSON, so the collector translates between them.
func initTracer(ctx context.Context, serviceName, collectorEndpoint string) (func(context.Context) error, error) {
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint(collectorEndpoint),
		otlptracehttp.WithInsecure(), // plain HTTP for local dev; drop for TLS
	)
	if err != nil {
		return nil, err
	}

	// service.name becomes the participant node in LiveProbe's flow graph.
	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(serviceName)),
	)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter, sdktrace.WithBatchTimeout(time.Second)),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	// W3C trace-context + baggage so the React frontend's `traceparent` header
	// continues into this process — frontend and backend spans share one trace.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp.Shutdown, nil
}
