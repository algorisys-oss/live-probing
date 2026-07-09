import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFault, faultFromEnv, faultActive, InjectedFault, NO_FAULT } from "./chaos.js";

test("an inert config does nothing: no sleep, no throw", async () => {
  let slept = false;
  await applyFault(NO_FAULT, { sleep: async () => void (slept = true), random: () => 0 });
  assert.equal(slept, false);
});

test("failRate 1 throws an InjectedFault carrying the configured status", async () => {
  const cfg = { ...NO_FAULT, failRate: 1, failStatus: 503 };
  await assert.rejects(
    () => applyFault(cfg, { random: () => 0.5 }),
    (err: unknown) => err instanceof InjectedFault && err.statusCode === 503,
  );
});

test("failRate gates on the random draw", async () => {
  const cfg = { ...NO_FAULT, failRate: 0.5 };
  await assert.doesNotReject(() => applyFault(cfg, { random: () => 0.9 })); // 0.9 >= 0.5 → pass
  await assert.rejects(() => applyFault(cfg, { random: () => 0.1 }), InjectedFault); // 0.1 < 0.5 → fail
});

test("latency sleeps for latencyMs plus jitter, before any failure", async () => {
  const cfg = { ...NO_FAULT, latencyMs: 800, latencyJitterMs: 400, latencyRate: 1 };
  let sleptMs = 0;
  await applyFault(cfg, { sleep: async (ms) => void (sleptMs = ms), random: () => 0.5 });
  assert.equal(sleptMs, 800 + 0.5 * 400); // 1000
});

test("latency and failure compose: it sleeps, then throws", async () => {
  const cfg = { ...NO_FAULT, latencyMs: 100, latencyRate: 1, failRate: 1 };
  let sleptMs = 0;
  await assert.rejects(
    () => applyFault(cfg, { sleep: async (ms) => void (sleptMs = ms), random: () => 0 }),
    InjectedFault,
  );
  assert.equal(sleptMs, 100);
});

test("faultFromEnv reads and clamps the env knobs; unset = inert", () => {
  const prefix = "TEST_FAULT_A";
  process.env[`${prefix}_LATENCY_MS`] = "300";
  process.env[`${prefix}_FAIL_RATE`] = "2"; // clamps to 1
  process.env[`${prefix}_FAIL_STATUS`] = "500";
  const cfg = faultFromEnv(prefix);
  assert.equal(cfg.latencyMs, 300);
  assert.equal(cfg.failRate, 1);
  assert.equal(cfg.failStatus, 500);
  assert.equal(faultActive(cfg), true);

  const inert = faultFromEnv("TEST_FAULT_UNSET_ZZZ");
  assert.equal(faultActive(inert), false);
  for (const k of Object.keys(process.env)) if (k.startsWith(prefix)) delete process.env[k];
});
