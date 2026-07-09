// Fault injection for the testbed — deliberately makes services slow or fail so LiveProbe's
// health colouring, RED tiles, alerts, and dependency matrix have real red/amber to show. Every
// knob is env-configured and defaults to zero, so with no config the testbed behaves exactly as
// before. Testbed-only; never ship this in a real service.

import { envInt } from "./env.js";

export interface FaultConfig {
  latencyMs: number; // added latency when a latency fault hits
  latencyJitterMs: number; // uniform extra 0..jitter on top of latencyMs
  latencyRate: number; // 0..1 probability a request takes the latency hit
  failRate: number; // 0..1 probability a request is failed outright
  failStatus: number; // HTTP status an injected failure maps to (default 503, a retryable one)
}

export const NO_FAULT: FaultConfig = {
  latencyMs: 0,
  latencyJitterMs: 0,
  latencyRate: 0,
  failRate: 0,
  failStatus: 503,
};

// A failure this module injected on purpose. The shared error handler maps it to its statusCode
// so a handler only has to `await applyFault(...)` — no try/catch at the call site.
export class InjectedFault extends Error {
  readonly statusCode: number;
  constructor(statusCode: number) {
    super(`injected fault (${statusCode})`);
    this.name = "InjectedFault";
    this.statusCode = statusCode;
  }
}

function rate(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/**
 * Build a fault config from `${prefix}_*` env vars, e.g. faultFromEnv("ORDER_FAULT") reads
 * ORDER_FAULT_LATENCY_MS / _LATENCY_JITTER_MS / _LATENCY_RATE / _FAIL_RATE / _FAIL_STATUS.
 * Anything unset is zero, so the returned config is inert unless explicitly configured.
 */
export function faultFromEnv(prefix: string): FaultConfig {
  return {
    latencyMs: envInt(`${prefix}_LATENCY_MS`, 0),
    latencyJitterMs: envInt(`${prefix}_LATENCY_JITTER_MS`, 0),
    latencyRate: rate(`${prefix}_LATENCY_RATE`),
    failRate: rate(`${prefix}_FAIL_RATE`),
    failStatus: envInt(`${prefix}_FAIL_STATUS`, 503),
  };
}

/** True if the config would ever do anything — handy for a one-line startup log. */
export function faultActive(cfg: FaultConfig): boolean {
  return (cfg.latencyRate > 0 && cfg.latencyMs > 0) || cfg.failRate > 0;
}

export interface FaultDeps {
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Apply a fault to the current request: maybe add latency, then maybe throw an InjectedFault.
 * Latency comes first so a request that is both slow and failed spends the time before failing
 * (matches a real timeout/5xx from an overloaded dependency). Pure of any framework — call it at
 * the top of a handler.
 */
export async function applyFault(cfg: FaultConfig, deps: FaultDeps = {}): Promise<void> {
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? defaultSleep;

  if (cfg.latencyMs > 0 && cfg.latencyRate > 0 && random() < cfg.latencyRate) {
    const jitter = cfg.latencyJitterMs > 0 ? random() * cfg.latencyJitterMs : 0;
    await sleep(cfg.latencyMs + jitter);
  }
  if (cfg.failRate > 0 && random() < cfg.failRate) {
    throw new InjectedFault(cfg.failStatus);
  }
}
