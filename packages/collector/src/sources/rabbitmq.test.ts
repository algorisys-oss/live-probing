import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rabbitmqSource,
  type ChannelLike,
  type ConnLike,
  type MsgLike,
} from "./rabbitmq.js";

// A fake amqp connection/channel that records calls and lets the test drive the consumer.
// Each connect() yields a fresh connection whose 'close'/'error' handlers the test can fire,
// so reconnection is testable.
function makeFake(opts: { failConnects?: number[] } = {}) {
  const calls = {
    assertExchange: [] as unknown[][],
    checkExchange: [] as unknown[][],
    assertQueue: [] as unknown[][],
    bindQueue: [] as unknown[][],
    prefetch: [] as number[],
    channelClosed: false,
    connClosed: false,
    connects: 0,
  };
  let onMsg: ((msg: MsgLike | null) => void) | undefined;
  const acked: MsgLike[] = [];
  const nacked: Array<{ msg: MsgLike; allUpTo: boolean; requeue: boolean }> = [];
  const connHandlers: Array<Map<string, (arg?: unknown) => void>> = [];

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
  const connect = async (_url: string): Promise<ConnLike> => {
    calls.connects++;
    if (opts.failConnects?.includes(calls.connects)) throw new Error("connect refused");
    const handlers = new Map<string, (arg?: unknown) => void>();
    connHandlers.push(handlers);
    return {
      createChannel: async () => channel,
      close: async () => void (calls.connClosed = true),
      on: (event, cb) => void handlers.set(event, cb),
    };
  };
  const deliver = (obj: unknown) =>
    onMsg?.({ content: new TextEncoder().encode(JSON.stringify(obj)) });
  const deliverRaw = (text: string) =>
    onMsg?.({ content: new TextEncoder().encode(text) });
  // Simulate the broker dropping the n-th connection (default: the latest).
  const dropConn = (n = connHandlers.length) => connHandlers[n - 1]?.get("close")?.();

  return { connect, calls, acked, nacked, deliver, deliverRaw, dropConn };
}

const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));

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

test("bounded queue: max length sets x-max-length + drop-head, ttl sets x-message-ttl", async () => {
  const f = makeFake();
  await rabbitmqSource("amqp://x", "liveprobe.tap", () => {}, {
    connect: f.connect,
    exchange: "instrumentation",
    queueMaxLength: 100_000,
    queueMessageTtlMs: 60_000,
  });

  assert.deepEqual(f.calls.assertQueue[0], [
    "liveprobe.tap",
    {
      durable: true,
      arguments: {
        "x-max-length": 100_000,
        "x-overflow": "drop-head",
        "x-message-ttl": 60_000,
      },
    },
  ]);
});

test("no bounds set: queue is asserted without an arguments object", async () => {
  const f = makeFake();
  await rabbitmqSource("amqp://x", "q", () => {}, { connect: f.connect });
  assert.deepEqual(f.calls.assertQueue[0], ["q", { durable: true }]);
});

test("reconnects (and re-consumes) after the connection drops", async () => {
  const f = makeFake();
  const seen: unknown[] = [];
  const stop = await rabbitmqSource("amqp://x", "q", (e) => seen.push(e), {
    connect: f.connect,
    reconnectDelayMs: 1,
  });
  assert.equal(f.calls.connects, 1);

  f.dropConn(); // broker restart / heartbeat timeout
  await settle();

  assert.equal(f.calls.connects, 2);
  assert.equal(f.calls.assertQueue.length, 2); // full setup re-ran
  f.deliver({ trace_id: "t", span_id: "s" }); // consumer works again
  assert.equal(seen.length, 1);

  await stop();
});

test("a failed reconnect attempt retries until it succeeds", async () => {
  const f = makeFake({ failConnects: [2] }); // first reconnect attempt is refused
  const stop = await rabbitmqSource("amqp://x", "q", () => {}, {
    connect: f.connect,
    reconnectDelayMs: 1,
  });

  f.dropConn();
  await settle();

  assert.equal(f.calls.connects, 3); // initial + failed retry + successful retry
  await stop();
});

test("stop() prevents reconnection", async () => {
  const f = makeFake();
  const stop = await rabbitmqSource("amqp://x", "q", () => {}, {
    connect: f.connect,
    reconnectDelayMs: 1,
  });

  await stop(); // triggers the conn's 'close' via conn.close()
  f.dropConn();
  await settle();

  assert.equal(f.calls.connects, 1);
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
