import { DatabaseSync } from "node:sqlite";
import type { AssembledTrace, Event } from "@liveprobe/core";
import { detail, summarize, type TraceDetail, type TraceSummary } from "./summary.js";

export interface ErrorGroup {
  endpoint: string; // the trace's root operation
  label: string; // "<service>: <exception|HTTP status|operation>"
  count: number;
  lastSeen: number; // micros
  sampleTraceId: string;
}

export interface LatencyBucket {
  minute: number; // epoch minutes (UTC)
  count: number;
  p50: number;
  p95: number;
  p99: number;
}

// A compact, searchable projection of a trace's span attributes: the distinct "key=value"
// pairs across all spans. Enables attribute search (e.g. "http.status_code=500", "42abc").
function attrsTextFor(events: Event[]): string {
  const pairs = new Set<string>();
  for (const e of events) {
    for (const [k, v] of Object.entries(e.attributes)) {
      pairs.add(`${k}=${v}`);
      if (pairs.size >= 400) return [...pairs].join(" | "); // bound row size
    }
  }
  return [...pairs].join(" | ");
}

// A human error label from the first errored span: prefer an exception type, then an HTTP
// status, else the failing operation.
function errorLabelFor(events: Event[]): string | null {
  const err = events.find((e) => e.status === "error");
  if (!err) return null;
  const a = err.attributes;
  const exc = a["exception.type"] ?? a["exception_name"] ?? a["error.type"];
  const status = a["http.status_code"] ?? a["http.response.status_code"];
  if (typeof exc === "string" && exc) return `${err.participant}: ${exc}`;
  if (status !== undefined && Number(status) >= 400) return `${err.participant}: HTTP ${status}`;
  return `${err.participant}: ${err.operation}`;
}

// Persists trace summaries + detail, partitioned by UTC day, so LiveProbe can answer
// "what happened on this day" after traces have aged out of the live window. Uses Node's
// built-in SQLite (no external dependency).

export interface DayInfo {
  day: string;
  requests: number;
  errors: number;
}

export interface SearchOptions {
  q?: string; // substring of the operation/endpoint
  service?: string; // trace involves this service
  attr?: string; // matches a span attribute: "key=value" (precise) or any value substring
  error?: boolean; // only errored / only clean
  minMicros?: number; // duration floor
  maxMicros?: number; // duration ceiling
  minSpans?: number; // at least this many spans
  traceId?: string; // exact id
  sort?: "recent" | "slowest"; // default recent
  limit?: number;
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

// UTC day partition ("YYYY-MM-DD") for an epoch-microsecond timestamp. Ingest clamps
// timestamps into range, but this is the last line before `Date.toISOString()` — which
// throws `RangeError` on an out-of-range value — so it never trusts its input: an invalid
// date falls back to the epoch day rather than crashing the writer (and, via the flush
// timer, the whole process).
function dayOf(startMicros: number): string {
  const d = new Date(Math.floor(startMicros / 1000));
  if (Number.isNaN(d.getTime())) return "1970-01-01";
  return d.toISOString().slice(0, 10);
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
    // Added after the fact; ALTER for existing DBs (idempotent).
    this.ensureColumn("traces", "error_label", "TEXT");
    this.ensureColumn("traces", "attrs_text", "TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_traces_error ON traces(has_error, start_time)");
  }

  private ensureColumn(table: string, col: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all().map((r) => String(r["name"]));
    if (!cols.includes(col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }

  // A trace grows as spans stream in, so upsert the latest snapshot each time.
  upsertMany(traces: AssembledTrace[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO traces (trace_id, day, start_time, duration_micros, root_operation,
                          span_count, service_count, has_error, services, detail_json, error_label, attrs_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trace_id) DO UPDATE SET
        day=excluded.day, start_time=excluded.start_time, duration_micros=excluded.duration_micros,
        root_operation=excluded.root_operation, span_count=excluded.span_count,
        service_count=excluded.service_count, has_error=excluded.has_error,
        services=excluded.services, detail_json=excluded.detail_json, error_label=excluded.error_label,
        attrs_text=excluded.attrs_text
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
          s.hasError ? errorLabelFor(t.events) : null,
          attrsTextFor(t.events),
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // Drop whole day-partitions older than the retention window (the N most recent UTC days,
  // including today). retentionDays <= 0 disables. Returns rows deleted; VACUUMs when rows
  // were dropped so the database file actually shrinks (deletes alone only free pages).
  prune(retentionDays: number, nowMicros = Date.now() * 1000): number {
    if (retentionDays <= 0) return 0;
    const cutoff = dayOf(nowMicros - (retentionDays - 1) * 86_400_000_000);
    const { changes } = this.db.prepare("DELETE FROM traces WHERE day < ?").run(cutoff);
    const deleted = Number(changes);
    if (deleted > 0) this.db.exec("VACUUM");
    return deleted;
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

  // Errored traces grouped by endpoint + error label, with a sample trace to jump to.
  errorGroups(limit: number): ErrorGroup[] {
    return this.db
      .prepare(
        `SELECT root_operation AS endpoint,
                COALESCE(error_label, 'error') AS label,
                count(*) AS count,
                max(start_time) AS lastSeen,
                (SELECT s.trace_id FROM traces s
                 WHERE s.has_error = 1 AND s.root_operation = traces.root_operation
                   AND IFNULL(s.error_label, '') = IFNULL(traces.error_label, '')
                 ORDER BY s.start_time DESC LIMIT 1) AS sampleTraceId
         FROM traces
         WHERE has_error = 1
         GROUP BY root_operation, error_label
         ORDER BY count DESC
         LIMIT ?`,
      )
      .all(limit)
      .map((r) => ({
        endpoint: String(r["endpoint"]),
        label: String(r["label"]),
        count: Number(r["count"]),
        lastSeen: Number(r["lastSeen"]),
        sampleTraceId: String(r["sampleTraceId"]),
      }));
  }

  // p50/p95/p99 per minute for one endpoint on a day (percentiles computed in JS).
  endpointLatency(day: string, endpoint: string): LatencyBucket[] {
    const rows = this.db
      .prepare(
        "SELECT (start_time/60000000) AS minute, duration_micros AS d FROM traces WHERE day = ? AND root_operation = ? ORDER BY minute",
      )
      .all(day, endpoint);
    const byMinute = new Map<number, number[]>();
    for (const r of rows) {
      const m = Number(r["minute"]);
      let list = byMinute.get(m);
      if (!list) {
        list = [];
        byMinute.set(m, list);
      }
      list.push(Number(r["d"]));
    }
    const pct = (arr: number[], p: number): number => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    };
    return [...byMinute.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([minute, ds]) => ({
        minute,
        count: ds.length,
        p50: pct(ds, 0.5),
        p95: pct(ds, 0.95),
        p99: pct(ds, 0.99),
      }));
  }

  // Search across all persisted traces. Every filter is optional and ANDed together.
  search(opts: SearchOptions): TraceSummary[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.q) {
      where.push("root_operation LIKE ?");
      params.push(`%${opts.q}%`);
    }
    if (opts.service) {
      // services is a JSON array of strings; match the quoted name
      where.push("services LIKE ?");
      params.push(`%"${opts.service}"%`);
    }
    if (opts.attr) {
      // attrs_text holds "key=value" pairs; "key=value" matches precisely, a bare word matches
      // any value/key containing it.
      where.push("attrs_text LIKE ?");
      params.push(`%${opts.attr}%`);
    }
    if (opts.error !== undefined) {
      where.push("has_error = ?");
      params.push(opts.error ? 1 : 0);
    }
    if (opts.minMicros !== undefined) {
      where.push("duration_micros >= ?");
      params.push(opts.minMicros);
    }
    if (opts.maxMicros !== undefined) {
      where.push("duration_micros <= ?");
      params.push(opts.maxMicros);
    }
    if (opts.minSpans !== undefined) {
      where.push("span_count >= ?");
      params.push(opts.minSpans);
    }
    if (opts.traceId) {
      where.push("trace_id = ?");
      params.push(opts.traceId);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const orderBy = opts.sort === "slowest" ? "duration_micros DESC" : "start_time DESC";
    const limit = opts.limit ?? 100;
    return this.db
      .prepare(`SELECT ${SUMMARY_COLS} FROM traces ${clause} ORDER BY ${orderBy} LIMIT ?`)
      .all(...params, limit)
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
