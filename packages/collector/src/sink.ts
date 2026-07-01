import type { Event } from "@liveprobe/core";

export interface Sink {
  push: (events: Event[]) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

// Buffers normalized events and POSTs them to LiveProbe's native ingest in batches.
export function createSink(baseUrl: string, batchSize = 50, flushMs = 1000): Sink {
  const endpoint = baseUrl.replace(/\/+$/, "") + "/v1/events";
  let buffer: Event[] = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) console.error(`[collector] ingest returned ${res.status}`);
    } catch (err) {
      console.error("[collector] ingest failed:", (err as Error).message);
    }
  };

  const timer = setInterval(() => void flush(), flushMs);
  timer.unref();

  return {
    push: (events) => {
      if (events.length === 0) return;
      buffer.push(...events);
      if (buffer.length >= batchSize) void flush();
    },
    flush,
    close: async () => {
      clearInterval(timer);
      await flush();
    },
  };
}
