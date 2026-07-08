# PII / secret masking (`maskPii`)

LiveProbe ships a shared masking helper so an adapter (or any ingest path) can scrub
PII and secrets out of an `Event` before it is buffered, POSTed to `/v1/events`,
persisted to SQLite, and rendered in the UI. Nothing downstream re-inspects payloads for
sensitive data, so masking happens **at the narrow waist** — the moment raw client data
becomes a normalized `Event`.

- Code: `packages/core/src/mask.ts` (exported from `@liveprobe/core`).
- Tests: `packages/core/src/mask.test.ts`.
- Where to call it: see "Usage" below and the PII section of `integration-adapters.md`.

## API

```ts
import { maskPii, maskEvents, maskString, type MaskOptions } from "@liveprobe/core";

maskPii(event: Event, opts?: MaskOptions): Event      // masked copy of one event
maskEvents(events: Event[], opts?: MaskOptions): Event[]  // map maskPii over a stream
maskString(value: string, placeholder?: string): string  // value-level scrubber, standalone
```

```ts
interface MaskOptions {
  placeholder?: string;        // replacement token, default "[redacted]"
  redactKeys?: string[];       // extra attribute-key tokens to treat as sensitive
  maskIdentityFields?: boolean; // also scan operation/peer/participant, default true
}
```

`maskPii` **never mutates its input** — it returns a new event with a new `attributes`
object. `traceId`, `spanId`, `parentSpanId`, `kind`, `startTime`, `duration`, and `status`
are copied through untouched (they carry no free text).

## How it works — two layers of defense

PII hides in two places: the **name** of a field and the **value** of a field. `maskPii`
handles both.

### Layer 1 — key-based redaction

Every `attributes` entry is checked by `isSensitiveKey(key)`. If the key *name* signals a
secret/PII, the value is replaced wholesale — regardless of type (so `cvv: 123`, a number,
is still redacted). You never scan a value you already know is sensitive.

Matching balances recall against false positives two ways:

- **Substring match** for tokens specific enough to be safe anywhere in the key:
  `password`, `passwd`, `secret`, `token`, `apikey` / `api_key`, `authorization`,
  `credential`, `cardnumber`, `accountnumber`, `taxid` (`SENSITIVE_CONTAINS`).
- **Whole-segment match** for short/ambiguous tokens: the key is split on non-alphanumerics
  (`user.email` → `["user", "email"]`) and each segment is compared against
  `SENSITIVE_PARTS`: `pwd`, `auth`, `ssn`, `sin`, `cvv`, `cvc`, `pin`, `otp`, `email`,
  `phone`, `mobile`, `dob`, `iban`, `pan`, `card`, `passport`, `aadhaar`.

The segment rule is why `auth` matches a key named `auth` but **not** `author` — `author`
is a single segment that isn't equal to `auth`. Caller-supplied `redactKeys` are folded
into both checks (lower-cased).

### Layer 2 — value-based redaction (`maskString`)

For string values under an innocent-looking key — and, by default, for the identity fields
`operation` / `peer` / `participant` — the *text itself* is scanned for embedded PII and
redacted inline:

| Pattern | Example matched | Notes |
|---|---|---|
| Email | `jane.doe@acme.com` | `-` is a valid local-part char, so `svc-carol@acme.com` is matched whole |
| Bearer token | `Bearer abc.def.ghi` | matches the `Bearer ` prefix + token |
| Card number | `4242 4242 4242 4242` | 13–19 digits, spaces/hyphens allowed **between** digits |

The card rule is guarded by a **Luhn checksum**: a 13–19 digit run is only redacted if it
passes Luhn (the checksum real card numbers satisfy). This is deliberate — a 16-digit
*order id* that fails Luhn is left intact, so the helper doesn't over-redact ordinary long
numbers. The card regex also keeps separators *between* digits only, so a trailing space
after a number isn't swallowed.

So `note: "ping bob@shop.io asap"` (innocent key, PII value) → `"ping [redacted] asap"`,
and a route `GET /users/jane@acme.com` in `operation` → `GET /users/[redacted]`.

## Usage — a backstop, not the primary control

`maskPii` is the **catch-all**, not the whole strategy. An adapter should still prefer an
**allow-list**: copy only the known-safe keys out of the raw payload, then run the result
through `maskEvents` before returning, so anything that slipped through is scrubbed.

```ts
export function myAdapter(raw: unknown): Event[] {
  const event = /* map raw → Event, copying only known-safe attribute keys */;
  return maskEvents([event]); // backstop
}
```

Custom placeholder / extra keys:

```ts
maskPii(event, { placeholder: "***", redactKeys: ["name", "customer_id"] });
maskPii(event, { maskIdentityFields: false }); // leave operation/peer/participant alone
```

## Limitations (know these)

- Layer 2 covers **emails, bearer tokens, and Luhn-valid cards** only. Phone numbers,
  national IDs, and free-form names have no reliable value signature, so they are **not**
  caught by value scanning — they rely on Layer 1 matching the key name (or a caller
  `redactKeys` / allow-list). Conservative by design, not a guarantee every PII value is caught.
- Masking is a copy-time transform on the `Event`. If a client already persists the raw
  payload elsewhere, that copy is out of scope — this only protects what enters LiveProbe.
- Not yet wired into the shipped adapters (`adapter-id-1`, `algo-instrumentation`); it is
  opt-in per client so verified adapter output doesn't change. Wiring is tracked in `todo.md`.
