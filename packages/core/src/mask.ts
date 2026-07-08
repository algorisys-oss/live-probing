// PII / secret masking at the narrow waist. Adapters (and the native/OTLP ingest paths) run
// raw client payloads through here before an Event is buffered, persisted (SQLite), and
// rendered (UI). Nothing downstream re-inspects payloads for sensitive data, so this is the
// place to scrub it. See docs/integration-adapters.md ("PII and sensitive data").
//
// Two layers of defense, both conservative to avoid leaking:
//  1. Key-based — attribute keys whose name signals a secret/PII have their value replaced
//     wholesale (works for string, number, and boolean values).
//  2. Value-based — any string (attribute value or identity field) is scanned for embedded
//     emails, bearer tokens, and Luhn-valid card numbers, which are replaced inline.
//
// This is a sane default, not a substitute for a per-client allow-list: an adapter should
// still prefer copying only known-safe keys, then call maskPii() as a backstop.

import type { Event } from "./event.js";

export interface MaskOptions {
  // Replacement token for redacted data.
  placeholder?: string;
  // Extra attribute-key tokens (case-insensitive) to redact, on top of the built-in set.
  redactKeys?: string[];
  // Also scan operation / peer / participant for embedded PII. Default true.
  maskIdentityFields?: boolean;
}

const DEFAULT_PLACEHOLDER = "[redacted]";

// Key tokens matched as a whole word/segment (split on non-alphanumeric). Kept exact to avoid
// false positives like "author" → "auth" or "panel" → "pan".
const SENSITIVE_PARTS: ReadonlySet<string> = new Set([
  "pwd",
  "auth",
  "ssn",
  "sin",
  "cvv",
  "cvc",
  "pin",
  "otp",
  "email",
  "phone",
  "mobile",
  "dob",
  "iban",
  "pan",
  "card",
  "passport",
  "aadhaar",
]);

// Key tokens matched as a substring — specific enough that a substring hit is a true positive.
const SENSITIVE_CONTAINS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "credential",
  "cardnumber",
  "accountnumber",
  "taxid",
];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
// Candidate card: 13–19 digits, optionally grouped by single spaces/hyphens (separators sit
// only between digits, so a trailing space isn't swallowed). Confirmed by Luhn.
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;

function luhnValid(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function isSensitiveKey(key: string, extra: ReadonlySet<string>): boolean {
  const lower = key.toLowerCase();
  for (const token of SENSITIVE_CONTAINS) if (lower.includes(token)) return true;
  for (const token of extra) if (lower.includes(token)) return true;
  const parts = lower.split(/[^a-z0-9]+/);
  for (const part of parts) {
    if (!part) continue;
    if (SENSITIVE_PARTS.has(part) || extra.has(part)) return true;
  }
  return false;
}

// Redact PII patterns embedded in a free-text string. Safe to call on any string.
export function maskString(value: string, placeholder: string = DEFAULT_PLACEHOLDER): string {
  if (!value) return value;
  return value
    .replace(EMAIL, placeholder)
    .replace(BEARER, placeholder)
    .replace(CARD_CANDIDATE, (m) => (luhnValid(m) ? placeholder : m));
}

// Return a masked copy of an event: sensitive attribute values redacted by key name, remaining
// string values (and, by default, the identity fields) scanned for embedded PII. Never mutates
// the input.
export function maskPii(event: Event, options: MaskOptions = {}): Event {
  const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;
  const maskIdentity = options.maskIdentityFields ?? true;
  const extra = new Set((options.redactKeys ?? []).map((k) => k.toLowerCase()));

  const attributes: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(event.attributes)) {
    if (isSensitiveKey(k, extra)) {
      attributes[k] = placeholder;
    } else if (typeof v === "string") {
      attributes[k] = maskString(v, placeholder);
    } else {
      attributes[k] = v;
    }
  }

  const out: Event = { ...event, attributes };
  if (maskIdentity) {
    out.operation = maskString(event.operation, placeholder);
    out.participant = maskString(event.participant, placeholder);
    if (event.peer != null) out.peer = maskString(event.peer, placeholder);
  }
  return out;
}

// Convenience: mask every event in a stream.
export function maskEvents(events: Event[], options?: MaskOptions): Event[] {
  return events.map((e) => maskPii(e, options));
}
