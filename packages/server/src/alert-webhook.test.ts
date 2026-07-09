import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebhookNotifier } from "./alert-webhook.js";
import type { Alert } from "@liveprobe/core";

type FiringAlert = Alert & { since: number };

const alert = (id: string, over: Partial<FiringAlert> = {}): FiringAlert => ({
  id,
  kind: "service",
  target: "order",
  metric: "error-rate",
  severity: "error",
  value: 0.2,
  threshold: 0.05,
  message: "order error rate 20% (20/100)",
  since: 1000,
  ...over,
});

const ok = () => new Response("", { status: 200 });
const fail = (status = 500) => new Response("", { status });

// A fetch stub that records calls and returns queued responses (or throws queued errors).
function stubFetch(script: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const step = script[Math.min(i, script.length - 1)]!;
    i++;
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("notify POSTs the alert as JSON to the configured url", async () => {
  const { fn, calls } = stubFetch([ok()]);
  const n = createWebhookNotifier({ url: "http://hook.test/a", fetchImpl: fn, now: () => 5000 });
  const delivered = await n.notify(alert("service:order:error-rate"));

  assert.equal(delivered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://hook.test/a");
  assert.equal(calls[0]!.init.method, "POST");
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.event, "alert.firing");
  assert.equal(body.firedAt, 5000);
  assert.equal(body.alert.id, "service:order:error-rate");
  assert.equal(body.alert.severity, "error");
});

test("retries on a rejected fetch, then succeeds; backs off between attempts", async () => {
  const { fn, calls } = stubFetch([new Error("ECONNREFUSED"), new Error("ECONNREFUSED"), ok()]);
  const sleeps: number[] = [];
  const n = createWebhookNotifier({
    url: "http://hook.test",
    fetchImpl: fn,
    retries: 2,
    backoffMs: 100,
    sleep: async (ms) => void sleeps.push(ms),
  });
  const delivered = await n.notify(alert("a"));

  assert.equal(delivered, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [100, 200]); // exponential: 100 * 2^0, 100 * 2^1
});

test("gives up after exhausting retries and reports the error without throwing", async () => {
  const { fn, calls } = stubFetch([new Error("down")]);
  const errors: unknown[] = [];
  const n = createWebhookNotifier({
    url: "http://hook.test",
    fetchImpl: fn,
    retries: 2,
    sleep: async () => {},
    onError: (e) => errors.push(e),
  });
  const delivered = await n.notify(alert("a"));

  assert.equal(delivered, false);
  assert.equal(calls.length, 3); // 1 + 2 retries
  assert.equal(errors.length, 1);
});

test("a non-2xx response is retried and can eventually fail", async () => {
  const { fn, calls } = stubFetch([fail(503), fail(500), fail(500)]);
  const n = createWebhookNotifier({ url: "http://hook.test", fetchImpl: fn, retries: 2, sleep: async () => {} });
  const delivered = await n.notify(alert("a"));

  assert.equal(delivered, false);
  assert.equal(calls.length, 3);
});

test("cooldown suppresses re-firing the same alert id, then allows it after the window", async () => {
  const { fn, calls } = stubFetch([ok(), ok()]);
  let clock = 0;
  const n = createWebhookNotifier({
    url: "http://hook.test",
    fetchImpl: fn,
    cooldownMs: 60_000,
    now: () => clock,
    sleep: async () => {},
  });

  clock = 1000;
  assert.equal(await n.notify(alert("service:order:error-rate")), true);
  clock = 30_000; // within cooldown
  assert.equal(await n.notify(alert("service:order:error-rate")), false);
  assert.equal(calls.length, 1); // suppressed

  clock = 70_000; // past the 60s cooldown from the first fire
  assert.equal(await n.notify(alert("service:order:error-rate")), true);
  assert.equal(calls.length, 2);
});

test("cooldown is per alert id — distinct alerts fire independently", async () => {
  const { fn, calls } = stubFetch([ok(), ok()]);
  const n = createWebhookNotifier({ url: "http://hook.test", fetchImpl: fn, now: () => 1000, sleep: async () => {} });

  assert.equal(await n.notify(alert("service:order:error-rate")), true);
  assert.equal(await n.notify(alert("edge:gw->order:latency", { kind: "edge", metric: "latency" })), true);
  assert.equal(calls.length, 2);
});

test("each attempt carries an abort signal and aborts a hung request within the timeout", async () => {
  let sawSignal = false;
  const hangThenAbort = (async (_url: string | URL, init: RequestInit = {}) => {
    const signal = init.signal as AbortSignal;
    sawSignal = signal instanceof AbortSignal;
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as unknown as typeof fetch;

  const n = createWebhookNotifier({
    url: "http://hook.test",
    fetchImpl: hangThenAbort,
    timeoutMs: 20,
    retries: 0,
    sleep: async () => {},
  });
  const delivered = await n.notify(alert("a"));

  assert.equal(sawSignal, true);
  assert.equal(delivered, false); // the hung request was aborted → treated as a failed attempt
});
