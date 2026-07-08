import { test } from "node:test";
import assert from "node:assert/strict";
import { maskString, maskPii, maskEvents } from "./mask.js";
import type { Event } from "./event.js";

const base: Event = {
  traceId: "t1",
  spanId: "s1",
  participant: "orders-api",
  operation: "GET /orders",
  kind: "server",
  startTime: 0,
  duration: 0,
  status: "ok",
  attributes: {},
};

test("maskString redacts an email in free text", () => {
  assert.equal(maskString("GET /users/jane.doe@acme.com"), "GET /users/[redacted]");
});

test("maskString redacts a Luhn-valid card number but leaves other digit runs", () => {
  assert.equal(maskString("card 4242 4242 4242 4242 done"), "card [redacted] done");
  // 16 digits that fail Luhn stay put (e.g. an order id), so we don't over-redact.
  assert.equal(maskString("order 1234567812345678"), "order 1234567812345678");
});

test("maskString redacts a bearer token", () => {
  assert.equal(maskString("Authorization: Bearer abc.def.ghi"), "Authorization: [redacted]");
});

test("maskString leaves clean text untouched", () => {
  assert.equal(maskString("GET /orders/42"), "GET /orders/42");
});

test("maskPii redacts sensitive attribute keys by name", () => {
  const e = maskPii({
    ...base,
    attributes: {
      password: "hunter2",
      api_key: "sk-live-xyz",
      authorization: "Bearer t",
      "user.email": "a@b.com",
      cvv: 123,
      order_id: "ORD-1", // not sensitive
      retries: 3, // not sensitive
    },
  });
  assert.equal(e.attributes["password"], "[redacted]");
  assert.equal(e.attributes["api_key"], "[redacted]");
  assert.equal(e.attributes["authorization"], "[redacted]");
  assert.equal(e.attributes["user.email"], "[redacted]");
  assert.equal(e.attributes["cvv"], "[redacted]"); // numeric value still redacted by key
  assert.equal(e.attributes["order_id"], "ORD-1");
  assert.equal(e.attributes["retries"], 3);
});

test("maskPii redacts PII values even under a non-sensitive key", () => {
  const e = maskPii({ ...base, attributes: { note: "ping customer bob@shop.io asap" } });
  assert.equal(e.attributes["note"], "ping customer [redacted] asap");
});

test("maskPii masks identity fields (operation/peer/participant) by default", () => {
  const e = maskPii({
    ...base,
    operation: "GET /users/jane@acme.com",
    peer: "carol@acme.com",
    participant: "orders-api",
  });
  assert.equal(e.operation, "GET /users/[redacted]");
  assert.equal(e.peer, "[redacted]");
  assert.equal(e.participant, "orders-api"); // clean, untouched
});

test("maskPii can leave identity fields alone when asked", () => {
  const e = maskPii(
    { ...base, operation: "GET /users/jane@acme.com" },
    { maskIdentityFields: false },
  );
  assert.equal(e.operation, "GET /users/jane@acme.com");
});

test("maskPii honors caller-supplied extra keys and a custom placeholder", () => {
  const e = maskPii(
    { ...base, attributes: { customer_name: "Jane Doe", note: "ok" } },
    { redactKeys: ["name"], placeholder: "***" },
  );
  assert.equal(e.attributes["customer_name"], "***");
  assert.equal(e.attributes["note"], "ok");
});

test("maskPii does not mutate the input event", () => {
  const input: Event = { ...base, attributes: { password: "hunter2" } };
  const out = maskPii(input);
  assert.equal(input.attributes["password"], "hunter2"); // original untouched
  assert.equal(out.attributes["password"], "[redacted]");
  assert.notEqual(out, input);
});

test("maskEvents masks every event in an array", () => {
  const out = maskEvents([
    { ...base, attributes: { token: "x" } },
    { ...base, attributes: { pwd: "y" } },
  ]);
  assert.equal(out[0]!.attributes["token"], "[redacted]");
  assert.equal(out[1]!.attributes["pwd"], "[redacted]");
});
