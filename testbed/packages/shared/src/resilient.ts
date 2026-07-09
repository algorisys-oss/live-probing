// Client-side resilience for the testbed: a drop-in `fetch` wrapper that adds a per-attempt
// timeout, bounded retries with backoff, and a per-host circuit breaker. Paired with chaos.ts on
// the server side, it makes the classic failure story visible in LiveProbe — retries show as
// repeated outbound spans (the ×N fold), a tripped breaker sheds load off a sick dependency.
// Every knob is env-configured and defaults to off, so `resilientFetch(url, init, policy)` with an
// unconfigured policy is exactly one plain `fetch`. Testbed-only.

import { envInt } from "./env.js";

export interface ResiliencePolicy {
  timeoutMs: number; // per-attempt abort; 0 = no timeout
  retries: number; // extra attempts after the first (total = retries + 1)
  backoffMs: number; // base backoff between attempts; doubled each retry
  breakerThreshold: number; // consecutive failures that open the breaker; 0 = breaker off
  breakerResetMs: number; // how long the breaker stays open before a half-open trial
}

export const NO_RESILIENCE: ResiliencePolicy = {
  timeoutMs: 0,
  retries: 0,
  backoffMs: 0,
  breakerThreshold: 0,
  breakerResetMs: 0,
};

// Thrown when the breaker is open and the call is shed without hitting the network. The shared
// error handler maps it to 503 so it surfaces as a retryable failure, not a generic 500.
export class CircuitOpenError extends Error {
  readonly statusCode = 503;
  constructor(host: string) {
    super(`circuit open for ${host}`);
    this.name = "CircuitOpenError";
  }
}

interface BreakerState {
  failures: number;
  openedAt: number | null; // epoch ms the breaker opened, or null when closed
}

export interface ResilienceDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  store?: Map<string, BreakerState>; // breaker state keyed by host; defaults to a module-global
}

// One breaker per host across the process — a sick dependency trips once for every caller in this
// service, which is the point.
const globalStore = new Map<string, BreakerState>();

/** Clear all breaker state (tests). */
export function resetBreakers(): void {
  globalStore.clear();
}

/** Build a policy from `${prefix}_*` env vars; anything unset leaves that knob off. */
export function policyFromEnv(prefix: string): ResiliencePolicy {
  return {
    timeoutMs: envInt(`${prefix}_TIMEOUT_MS`, 0),
    retries: envInt(`${prefix}_RETRIES`, 0),
    backoffMs: envInt(`${prefix}_BACKOFF_MS`, 100),
    breakerThreshold: envInt(`${prefix}_BREAKER_THRESHOLD`, 0),
    breakerResetMs: envInt(`${prefix}_BREAKER_RESET_MS`, 10_000),
  };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function attempt(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  if (timeoutMs <= 0) return fetchImpl(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetch with timeout + retry + circuit breaker. Retries a network error, a timeout, or a 5xx
 * response (never a 4xx — that's the caller's fault, not a flaky dependency). Returns the last
 * response even if it is a 5xx (retries exhausted) so the caller can read the body; throws only on
 * a transport error that never produced a response, or CircuitOpenError when the breaker is open.
 */
export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  policy: ResiliencePolicy = NO_RESILIENCE,
  deps: ResilienceDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const store = deps.store ?? globalStore;
  const host = hostOf(url);
  const breakerOn = policy.breakerThreshold > 0;

  const state = store.get(host) ?? { failures: 0, openedAt: null };
  // Breaker open and still cooling down → shed the call without touching the network.
  if (breakerOn && state.openedAt !== null && now() - state.openedAt < policy.breakerResetMs) {
    throw new CircuitOpenError(host);
  }

  const recordSuccess = () => {
    if (!breakerOn) return;
    store.set(host, { failures: 0, openedAt: null });
  };
  const recordFailure = () => {
    if (!breakerOn) return;
    const failures = state.failures + 1;
    const openedAt = failures >= policy.breakerThreshold ? now() : state.openedAt;
    store.set(host, { failures, openedAt });
  };

  let lastError: unknown;
  let lastResponse: Response | null = null;

  for (let i = 0; i <= policy.retries; i++) {
    if (i > 0) await sleep(policy.backoffMs * 2 ** (i - 1));
    try {
      const res = await attempt(url, init, policy.timeoutMs, fetchImpl);
      if (res.status >= 500) {
        lastResponse = res;
        lastError = undefined;
        continue; // retryable server error
      }
      recordSuccess();
      return res;
    } catch (err) {
      lastError = err;
      lastResponse = null;
    }
  }

  // Retries exhausted. A 5xx counts as a breaker failure but is a real response we hand back.
  recordFailure();
  if (lastResponse) return lastResponse;
  throw lastError;
}
