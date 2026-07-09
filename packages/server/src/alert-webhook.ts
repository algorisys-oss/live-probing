import type { Alert } from "@liveprobe/core";

type FiringAlert = Alert & { since: number };

export interface WebhookOptions {
  // Destination for the POST. When absent the notifier is not created (webhook disabled).
  url: string;
  // Per-attempt request timeout (ms). A slower response is aborted and counts as a failed attempt.
  timeoutMs?: number; // default 5000
  // Extra attempts after the first. total attempts = retries + 1.
  retries?: number; // default 2
  // Base backoff between attempts (ms); doubled each retry (backoff * 2^(n-1)).
  backoffMs?: number; // default 500
  // Minimum gap between firing the *same* alert id again — de-dups a flapping condition so it
  // notifies once, not on every inactive→active bounce. Keyed by alert id.
  cooldownMs?: number; // default 60000
  // Seams for tests / custom transports. Default to the platform globals.
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  // Delivery outcome hooks (best-effort logging by the caller). Never throw from these.
  onError?: (err: unknown, alert: FiringAlert) => void;
  onSent?: (alert: FiringAlert) => void;
}

export interface WebhookNotifier {
  // Fire-and-forget from the caller's view (the server never awaits). Resolves true if the POST
  // was accepted (2xx), false if suppressed by cooldown or if every attempt failed. Never rejects.
  notify(alert: FiringAlert): Promise<boolean>;
}

/**
 * Outbound alert delivery: POST one JSON body per inactive→active alert transition, with a
 * per-attempt timeout, exponential-backoff retries, and a per-alert-id cooldown so a flapping
 * condition doesn't spam the endpoint. Pure of any server state — the caller decides *when* a
 * transition happened; this decides *how* it is delivered.
 */
export function createWebhookNotifier(opts: WebhookOptions): WebhookNotifier {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 500;
  const cooldownMs = opts.cooldownMs ?? 60_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lastFiredAt = new Map<string, number>();

  async function deliver(alert: FiringAlert): Promise<boolean> {
    const body = JSON.stringify({ event: "alert.firing", firedAt: now(), alert });
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(opts.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: controller.signal,
        });
        if (res.ok) {
          opts.onSent?.(alert);
          return true;
        }
        throw new Error(`webhook responded ${res.status}`);
      } catch (err) {
        if (attempt === retries) {
          opts.onError?.(err, alert);
          return false;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return false;
  }

  return {
    notify(alert) {
      const t = now();
      const prev = lastFiredAt.get(alert.id);
      if (prev !== undefined && t - prev < cooldownMs) return Promise.resolve(false);
      lastFiredAt.set(alert.id, t); // hold the cooldown from the moment we start delivering
      return deliver(alert);
    },
  };
}
