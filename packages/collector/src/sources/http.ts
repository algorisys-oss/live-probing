import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Plain HTTP receiver source: accepts POSTed JSON — one raw event or an array — on any
// path and hands each document to the adapter. Path-agnostic on purpose: emitters that
// push to per-type endpoints (e.g. POST /v1/event/instrumentation|log|audit) can be
// repointed here unchanged; the event type lives in the payload, not the URL.

const MAX_BODY_BYTES = 5 * 1024 * 1024; // one event per POST; anything bigger is a mistake

export interface HttpSourceHandle {
  port: number;
  close(): Promise<void>;
}

export function httpSource(port: number, onEvent: (raw: unknown) => void): Promise<HttpSourceHandle> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" }).end('{"error":"POST JSON events"}');
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        res.writeHead(413, { "content-type": "application/json" }).end('{"error":"body too large"}');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) return;
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        for (const item of Array.isArray(body) ? body : [body]) onEvent(item);
        res.writeHead(202, { "content-type": "application/json" }).end('{"ok":true}');
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid json"}');
      }
    });
    req.on("error", () => {
      // client hung up mid-body; nothing to do
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
