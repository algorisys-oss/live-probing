import { test } from "node:test";
import assert from "node:assert/strict";
import { resilientFetch, policyFromEnv, CircuitOpenError, NO_RESILIENCE } from "./resilient.js";

const res = (status: number) => new Response("", { status });

// A fetch stub that plays a queued script of responses/errors and counts calls.
function stubFetch(script: Array<Response | Error | "hang">) {
  let i = 0;
  let calls = 0;
  const fn = (async (_url: string | URL, init: RequestInit = {}) => {
    calls++;
    const step = script[Math.min(i, script.length - 1)]!;
    i++;
    if (step === "hang") {
      // Resolve only when aborted, mimicking a request that outlives its timeout.
      return await new Promise<Response>((_ok, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

const deps = (fn: typeof fetch, clock = { t: 0 }) => ({
  fetchImpl: fn,
  now: () => clock.t,
  sleep: async () => {},
  store: new Map(),
});

test("default policy is a single plain fetch", async () => {
  const { fn, calls } = stubFetch([res(200)]);
  const r = await resilientFetch("http://svc/a", {}, NO_RESILIENCE, deps(fn));
  assert.equal(r.status, 200);
  assert.equal(calls(), 1);
});

test("retries a 5xx then returns the success", async () => {
  const { fn, calls } = stubFetch([res(503), res(500), res(200)]);
  const r = await resilientFetch("http://svc/a", {}, { ...NO_RESILIENCE, retries: 2 }, deps(fn));
  assert.equal(r.status, 200);
  assert.equal(calls(), 3);
});

test("retries a thrown transport error then succeeds", async () => {
  const { fn, calls } = stubFetch([new Error("ECONNREFUSED"), res(200)]);
  const r = await resilientFetch("http://svc/a", {}, { ...NO_RESILIENCE, retries: 1 }, deps(fn));
  assert.equal(r.status, 200);
  assert.equal(calls(), 2);
});

test("does NOT retry a 4xx — that's the caller's fault", async () => {
  const { fn, calls } = stubFetch([res(404), res(200)]);
  const r = await resilientFetch("http://svc/a", {}, { ...NO_RESILIENCE, retries: 3 }, deps(fn));
  assert.equal(r.status, 404);
  assert.equal(calls(), 1);
});

test("retries exhausted on 5xx returns the last response (body still readable by caller)", async () => {
  const { fn, calls } = stubFetch([res(503)]);
  const r = await resilientFetch("http://svc/a", {}, { ...NO_RESILIENCE, retries: 2 }, deps(fn));
  assert.equal(r.status, 503);
  assert.equal(calls(), 3);
});

test("a per-attempt timeout aborts a hung request and it is retried", async () => {
  const { fn, calls } = stubFetch(["hang", res(200)]);
  const r = await resilientFetch("http://svc/a", {}, { ...NO_RESILIENCE, timeoutMs: 20, retries: 1 }, deps(fn));
  assert.equal(r.status, 200);
  assert.equal(calls(), 2);
});

test("breaker opens after N consecutive failures and then sheds without fetching", async () => {
  const { fn, calls } = stubFetch([res(503)]); // every call 503
  const clock = { t: 1000 };
  const shared = deps(fn, clock);
  const policy = { ...NO_RESILIENCE, retries: 0, breakerThreshold: 3, breakerResetMs: 10_000 };

  // 3 failing calls trip the breaker (threshold reached on the 3rd).
  for (let i = 0; i < 3; i++) {
    const r = await resilientFetch("http://svc/a", {}, policy, shared);
    assert.equal(r.status, 503);
  }
  assert.equal(calls(), 3);

  // Breaker now open → the next call is shed without a fetch.
  await assert.rejects(() => resilientFetch("http://svc/a", {}, policy, shared), CircuitOpenError);
  assert.equal(calls(), 3, "no additional fetch while open");
});

test("breaker half-opens after the reset window and a success closes it", async () => {
  const script: Array<Response | Error> = [res(503), res(503), res(503), res(200)];
  const { fn, calls } = stubFetch(script);
  const clock = { t: 1000 };
  const shared = deps(fn, clock);
  const policy = { ...NO_RESILIENCE, breakerThreshold: 3, breakerResetMs: 5000 };

  for (let i = 0; i < 3; i++) await resilientFetch("http://svc/a", {}, policy, shared); // trip it
  await assert.rejects(() => resilientFetch("http://svc/a", {}, policy, shared), CircuitOpenError);

  clock.t += 6000; // past the reset window → half-open trial allowed
  const r = await resilientFetch("http://svc/a", {}, policy, shared);
  assert.equal(r.status, 200);
  assert.equal(calls(), 4); // the 3 trips + the successful trial

  clock.t += 100; // breaker closed again → normal calls flow (stub keeps returning 200)
  const r2 = await resilientFetch("http://svc/a", {}, policy, shared);
  assert.equal(r2.status, 200);
});

test("breaker is per-host", async () => {
  const { fn } = stubFetch([res(503)]);
  const shared = deps(fn);
  const policy = { ...NO_RESILIENCE, breakerThreshold: 1, breakerResetMs: 10_000 };
  await resilientFetch("http://a-host/x", {}, policy, shared); // trips a-host
  await assert.rejects(() => resilientFetch("http://a-host/x", {}, policy, shared), CircuitOpenError);
  // b-host has its own breaker, still closed.
  const r = await resilientFetch("http://b-host/y", {}, policy, shared);
  assert.equal(r.status, 503);
});

test("policyFromEnv reads the knobs; unset leaves resilience off", () => {
  process.env.TEST_RES_A_RETRIES = "2";
  process.env.TEST_RES_A_TIMEOUT_MS = "1500";
  process.env.TEST_RES_A_BREAKER_THRESHOLD = "8";
  const p = policyFromEnv("TEST_RES_A");
  assert.equal(p.retries, 2);
  assert.equal(p.timeoutMs, 1500);
  assert.equal(p.breakerThreshold, 8);
  const off = policyFromEnv("TEST_RES_UNSET_ZZZ");
  assert.deepEqual(off, { ...NO_RESILIENCE, backoffMs: 100, breakerResetMs: 10_000 });
  for (const k of ["RETRIES", "TIMEOUT_MS", "BREAKER_THRESHOLD"]) delete process.env[`TEST_RES_A_${k}`];
});
