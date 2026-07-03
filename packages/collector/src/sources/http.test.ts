import { test } from "node:test";
import assert from "node:assert/strict";
import { httpSource } from "./http.js";

async function withSource(fn: (port: number, received: unknown[]) => Promise<void>): Promise<void> {
  const received: unknown[] = [];
  const handle = await httpSource(0, (raw) => received.push(raw));
  try {
    await fn(handle.port, received);
  } finally {
    await handle.close();
  }
}

test("httpSource accepts a POSTed JSON event on any path", async () => {
  await withSource(async (port, received) => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/event/instrumentation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "e1", eventType: "instrumentation" }),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(received, [{ eventId: "e1", eventType: "instrumentation" }]);
  });
});

test("httpSource fans out a POSTed JSON array to one raw event each", async () => {
  await withSource(async (port, received) => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/event/log`, {
      method: "POST",
      body: JSON.stringify([{ eventId: "a" }, { eventId: "b" }]),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(received, [{ eventId: "a" }, { eventId: "b" }]);
  });
});

test("httpSource rejects invalid JSON with 400 and drops it", async () => {
  await withSource(async (port, received) => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/event/audit`, { method: "POST", body: "{not json" });
    assert.equal(res.status, 400);
    assert.equal(received.length, 0);
  });
});

test("httpSource answers GET /healthz and rejects other methods", async () => {
  await withSource(async (port) => {
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/event/log`)).status, 405);
  });
});
