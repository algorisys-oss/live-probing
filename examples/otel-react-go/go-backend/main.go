// Command orders-api is a reference OpenTelemetry-instrumented Go backend that
// feeds LiveProbe (via a local OTel Collector). Stdlib net/http + pgx.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {
	ctx := context.Background()

	// 1. Telemetry. Export to the local collector (protobuf), which forwards
	//    JSON to LiveProbe. See telemetry.go.
	shutdown, err := initTracer(ctx, "orders-api", envOr("OTEL_COLLECTOR", "localhost:4318"))
	if err != nil {
		log.Fatalf("init tracer: %v", err)
	}
	defer func() { _ = shutdown(context.Background()) }()

	// 2. Postgres via pgx, with an OTel tracer so every query is a child span.
	//    The DB then appears as a `peer` node under the request in LiveProbe.
	cfg, err := pgxpool.ParseConfig(envOr("DATABASE_URL", "postgres://localhost:5432/app"))
	if err != nil {
		log.Fatalf("parse db config: %v", err)
	}
	cfg.ConnConfig.Tracer = otelpgx.NewTracer()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	// 3. Routes. Plain net/http (Go 1.22+ method+pattern mux).
	mux := http.NewServeMux()
	mux.HandleFunc("GET /orders", func(w http.ResponseWriter, r *http.Request) {
		// Pass r.Context() — it carries the active server span, so the query
		// nests beneath the request instead of starting a detached trace.
		var count int
		if err := pool.QueryRow(r.Context(), "SELECT count(*) FROM orders").Scan(&count); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("content-type", "application/json")
		fmt.Fprintf(w, `{"orders":%d}`, count)
	})

	// otelhttp wraps the mux: every request becomes a server-kind span, and
	// incoming `traceparent` headers are extracted via the propagator set above.
	handler := otelhttp.NewHandler(mux, "orders-api")

	srv := &http.Server{Addr: ":8080", Handler: handler}
	go func() {
		log.Println("orders-api listening on :8080")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	// Graceful shutdown so batched spans flush.
	sig, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	<-sig.Done()
	_ = srv.Shutdown(context.Background())
}

// For outbound calls to OTHER services, give the http.Client an otelhttp
// transport so they emit client-kind spans (the arrows in the flow graph):
//
//	client := &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
//	req, _ := http.NewRequestWithContext(ctx, "GET", "http://payments/charge", nil)
//	resp, _ := client.Do(req)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
