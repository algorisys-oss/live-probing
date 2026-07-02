import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rabbitmqSource,
  type ChannelLike,
  type ConnLike,
  type MsgLike,
} from "./rabbitmq.js";

// A fake amqp connection/channel that records calls and lets the test drive the consumer.
function makeFake() {
  const calls = {
    assertExchange: [] as unknown[][],
    checkExchange: [] as unknown[][],
    assertQueue: [] as unknown[][],
    bindQueue: [] as unknown[][],
    prefetch: [] as number[],
    channelClosed: false,
    connClosed: false,
  };
  let onMsg: ((msg: MsgLike | null) => void) | undefined;
  const acked: MsgLike[] = [];
  const nacked: Array<{ msg: MsgLike; allUpTo: boolean; requeue: boolean }> = [];

  const channel: ChannelLike = {
    assertExchange: async (x, t, o) => void calls.assertExchange.push([x, t, o]),
    checkExchange: async (x) => void calls.checkExchange.push([x]),
    assertQueue: async (q, o) => void calls.assertQueue.push([q, o]),
    bindQueue: async (q, x, k) => void calls.bindQueue.push([q, x, k]),
    prefetch: (n) => void calls.prefetch.push(n),
    consume: async (_q, cb) => {
      onMsg = cb;
    },
    ack: (msg) => void acked.push(msg),
    nack: (msg, allUpTo, requeue) => void nacked.push({ msg, allUpTo, requeue }),
    close: async () => void (calls.channelClosed = true),
  };
  const conn: ConnLike = {
    createChannel: async () => channel,
    close: async () => void (calls.connClosed = true),
  };
  const connect = async (_url: string) => conn;
  const deliver = (obj: unknown) =>
    onMsg?.({ content: new TextEncoder().encode(JSON.stringify(obj)) });
  const deliverRaw = (text: string) =>
    onMsg?.({ content: new TextEncoder().encode(text) });

  return { connect, calls, acked, nacked, deliver, deliverRaw };
}

test("plain queue consume: asserts the queue, no exchange binding", async () => {
  const f = makeFake();
  const seen: unknown[] = [];
  const stop = await rabbitmqSource("amqp://x", "q1", (e) => seen.push(e), {
    connect: f.connect,
  });

  assert.deepEqual(f.calls.assertQueue[0], ["q1", { durable: true }]);
  assert.equal(f.calls.assertExchange.length, 0);
  assert.equal(f.calls.bindQueue.length, 0);
  assert.deepEqual(f.calls.prefetch, [64]);

  f.deliver({ trace_id: "t", span_id: "s" });
  assert.deepEqual(seen, [{ trace_id: "t", span_id: "s" }]);
  assert.equal(f.acked.length, 1);

  await stop();
  assert.ok(f.calls.channelClosed && f.calls.connClosed);
});

test("exchange tap: verifies the exchange (passive) and binds with the given keys", async () => {
  const f = makeFake();
  const stop = await rabbitmqSource("amqp://x", "liveprobe.tap", () => {}, {
    connect: f.connect,
    exchange: "instrumentation",
    routingKeys: ["orders.#", "payments.#"],
  });

  // No exchangeType -> passive checkExchange, not a (re)declaration.
  assert.deepEqual(f.calls.checkExchange[0], ["instrumentation"]);
  assert.equal(f.calls.assertExchange.length, 0);
  assert.deepEqual(f.calls.assertQueue[0], ["liveprobe.tap", { durable: true }]);
  assert.deepEqual(f.calls.bindQueue, [
    ["liveprobe.tap", "instrumentation", "orders.#"],
    ["liveprobe.tap", "instrumentation", "payments.#"],
  ]);

  await stop();
});

test("exchange tap: declares the exchange when a type is given, defaults key to #", async () => {
  const f = makeFake();
  await rabbitmqSource("amqp://x", "tap", () => {}, {
    connect: f.connect,
    exchange: "events",
    exchangeType: "topic",
  });

  assert.deepEqual(f.calls.assertExchange[0], [
    "events",
    "topic",
    { durable: true },
  ]);
  assert.equal(f.calls.checkExchange.length, 0);
  assert.deepEqual(f.calls.bindQueue, [["tap", "events", "#"]]);
});

test("a poison (non-JSON) message is nacked without requeue and does not stop the stream", async () => {
  const f = makeFake();
  const seen: unknown[] = [];
  await rabbitmqSource("amqp://x", "q", (e) => seen.push(e), { connect: f.connect });

  f.deliverRaw("{not json");
  assert.equal(seen.length, 0);
  assert.equal(f.acked.length, 0);
  assert.deepEqual(f.nacked[0]!.allUpTo, false);
  assert.deepEqual(f.nacked[0]!.requeue, false);

  // stream still works afterwards
  f.deliver({ ok: true });
  assert.deepEqual(seen, [{ ok: true }]);
  assert.equal(f.acked.length, 1);
});
