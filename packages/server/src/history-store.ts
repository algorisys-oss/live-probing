import { DatabaseSync } from "node:sqlite";
import type { AssembledTrace } from "@liveprobe/core";
import { detail, summarize, type TraceDetail, type TraceSummary } from "./summary.js";

// Persists trace summaries + detail, partitioned by UTC day, so LiveProbe can answer
// "what happened on this day" after traces have aged out of the live window. Uses Node's
// built-in SQLite (no external dependency).

export interface DayInfo {
  day: string;
  requests: number;
  errors: number;
}

export interface EndpointRollup {
  operation: string;
  calls: number;
  errors: number;
  avgMicros: number;
  maxMicros: number;
}

export interface ThroughputBucket {
  minute: number; // epoch minutes (UTC)
  count: number;
  errors: number;
}

export interface DaySummary {
  day: string;
  requests: number;
  errors: number;
  errorRate: number;
  p50Micros: number;
  p95Micros: number;
  p99Micros: number;
  throughput: ThroughputBucket[];
  topEndpoints: EndpointRollup[];
  slowest: TraceSummary[];
}

const SUMMARY_COLS =
  "trace_id, root_operation, services, span_count, start_time, duration_micros, has_error";

function rowToSummary(r: Record<string, unknown>): TraceSummary {
  return {
    traceId: String(r["trace_id"]),
    rootOperation: String(r["root_operation"]),
    services: JSON.parse(String(r["services"])) as string[],
    spanCount: Number(r["span_count"]),
    startTime: Number(r["start_time"]),
    durationMicros: Number(r["duration_micros"]),
    hasError: Number(r["has_error"]) === 1,
  };
}

function dayOf(startMicros: number): string {
  return new Date(Math.floor(startMicros / 1000)).toISOString().slice(0, 10);
}

export class HistoryStore {
  private db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        trace_id        TEXT PRIMARY KEY,
        day             TEXT NOT NULL,
        start_time      INTEGER NOT NULL,
        duration_micros INTEGER NOT NULL,
        root_operation  TEXT NOT NULL,
        span_count      INTEGER NOT NULL,
        service_count   INTEGER NOT NULL,
        has_error       INTEGER NOT NULL,
        services        TEXT NOT NULL,
        detail_json     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_traces_day ON traces(day, start_time);
      CREATE INDEX IF NOT EXISTS idx_traces_day_dur ON traces(day, duration_micros);
      CREATE INDEX IF NOT EXISTS idx_traces_day_op ON traces(day, root_operation);
    `);
  }

  // A trace grows as spans stream in, so upsert the latest snapshot each time.
  upsertMany(traces: AssembledTrace[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO traces (trace_id, day, start_time, duration_micros, root_operation,
                          span_count, service_count, has_error, services, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trace_id) DO UPDATE SET
        day=excluded.day, start_time=excluded.start_time, duration_micros=excluded.duration_micros,
        root_operation=excluded.root_operation, span_count=excluded.span_count,
        service_count=excluded.service_count, has_error=excluded.has_error,
        services=excluded.services, detail_json=excluded.detail_json
    `);
    this.db.exec("BEGIN");
    try {
      for (const t of traces) {
        const d: TraceDetail = detail(t);
        const s = d.summary;
        stmt.run(
          s.traceId,
          dayOf(s.startTime),
          s.startTime,
          s.durationMicros,
          s.rootOperation,
          s.spanCount,
          s.services.length,
          s.hasError ? 1 : 0,
          JSON.stringify(s.services),
          JSON.stringify(d),
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  days(): DayInfo[] {
    return this.db
      .prepare("SELECT day, count(*) requests, sum(has_error) errors FROM traces GROUP BY day ORDER BY day DESC")
      .all()
      .map((r) => ({ day: String(r["day"]), requests: Number(r["requests"]), errors: Number(r["errors"]) }));
  }

  getDetail(traceId: string): TraceDetail | null {
    const row = this.db.prepare("SELECT detail_json FROM traces WHERE trace_id = ?").get(traceId);
    return row ? (JSON.parse(String(row["detail_json"])) as TraceDetail) : null;
  }

  dayTraces(day: string, limit: number): TraceSummary[] {
    return this.db
      .prepare(`SELECT ${SUMMARY_COLS} FROM traces WHERE day = ? ORDER BY start_time DESC LIMIT ?`)
      .all(day, limit)
      .map(rowToSummary);
  }

  private percentile(day: string, count: number, p: number): number {
    if (count === 0) return 0;
    const offset = Math.min(count - 1, Math.floor(count * p));
    const row = this.db
      .prepare("SELECT duration_micros FROM traces WHERE day = ? ORDER BY duration_micros ASC LIMIT 1 OFFSET ?")
      .get(day, offset);
    return row ? Number(row["duration_micros"]) : 0;
  }

  daySummary(day: string): DaySummary {
    const totals = this.db
      .prepare("SELECT count(*) requests, sum(has_error) errors FROM traces WHERE day = ?")
      .get(day);
    const requests = Number(totals?.["requests"] ?? 0);
    const errors = Number(totals?.["errors"] ?? 0);

    const throughput = this.db
      .prepare(
        "SELECT (start_time/60000000) minute, count(*) count, sum(has_error) errors FROM traces WHERE day = ? GROUP BY minute ORDER BY minute",
      )
      .all(day)
      .map((r) => ({ minute: Number(r["minute"]), count: Number(r["count"]), errors: Number(r["errors"]) }));

    const topEndpoints = this.db
      .prepare(
        `SELECT root_operation operation, count(*) calls, sum(has_error) errors,
                avg(duration_micros) avgMicros, max(duration_micros) maxMicros
         FROM traces WHERE day = ? GROUP BY root_operation ORDER BY calls DESC LIMIT 15`,
      )
      .all(day)
      .map((r) => ({
        operation: String(r["operation"]),
        calls: Number(r["calls"]),
        errors: Number(r["errors"]),
        avgMicros: Math.round(Number(r["avgMicros"])),
        maxMicros: Number(r["maxMicros"]),
      }));

    const slowest = this.db
      .prepare(`SELECT ${SUMMARY_COLS} FROM traces WHERE day = ? ORDER BY duration_micros DESC LIMIT 15`)
      .all(day)
      .map(rowToSummary);

    return {
      day,
      requests,
      errors,
      errorRate: requests > 0 ? errors / requests : 0,
      p50Micros: this.percentile(day, requests, 0.5),
      p95Micros: this.percentile(day, requests, 0.95),
      p99Micros: this.percentile(day, requests, 0.99),
      throughput,
      topEndpoints,
      slowest,
    };
  }

  close(): void {
    this.db.close();
  }
}
