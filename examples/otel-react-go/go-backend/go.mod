// Reference dependency set for the LiveProbe Go integration.
// Run `go mod tidy` in this directory to resolve exact versions.
module example.com/orders-api

go 1.22

require (
	github.com/exaring/otelpgx v0.9.3
	github.com/jackc/pgx/v5 v5.7.5
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.62.0
	go.opentelemetry.io/otel v1.37.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.37.0
	go.opentelemetry.io/otel/sdk v1.37.0
)
