import { createRequire } from "node:module";

// amqplib via createRequire (CJS), consistent with the rest of the repo.
const require = createRequire(import.meta.url);
const amqp = require("amqplib") as { connect: (url: string) => Promise<ConnLike> };

// Minimal structural types for the bits of amqplib we use. Keeping our own interface (rather
// than amqplib's) lets a test inject a fake connection without fighting the library's types.
export interface MsgLike {
  content: Uint8Array;
}
export interface ChannelLike {
  assertQueue(queue: string, opts?: unknown): Promise<unknown>;
  assertExchange(exchange: string, type: string, opts?: unknown): Promise<unknown>;
  checkExchange(exchange: string): Promise<unknown>;
  bindQueue(queue: string, exchange: string, routingKey: string): Promise<unknown>;
  prefetch(count: number): Promise<unknown> | void;
  consume(queue: string, onMsg: (msg: MsgLike | null) => void): Promise<unknown>;
  ack(msg: MsgLike): void;
  nack(msg: MsgLike, allUpTo: boolean, requeue: boolean): void;
  close(): Promise<void>;
}
export interface ConnLike {
  createChannel(): Promise<ChannelLike>;
  close(): Promise<void>;
  // amqplib connections are EventEmitters; we need 'error' and 'close'.
  on(event: string, listener: (arg?: unknown) => void): unknown;
}

export interface RabbitmqOptions {
  // Tap an existing exchange: bind our own queue to it so we get a *copy* of the stream
  // without competing with the client's existing consumers. Omit to consume `queue` directly.
  exchange?: string;
  // If set, declare the exchange with this type (durable). If omitted, the exchange is only
  // verified to exist (passive) — the safe default when tapping an exchange someone else owns.
  exchangeType?: string;
  // Binding keys. Default "#" (topic: everything). Fanout ignores the key; direct needs an exact key.
  routingKeys?: string[];
  // Queue durability (default true).
  queueDurable?: boolean;
  // Bound the queue so a live tap can't grow unbounded while the collector is down.
  // Applies to queues the collector owns (e.g. the tap queue) — setting these on a pre-existing
  // queue with different arguments will fail with a queue-arg mismatch.
  queueMaxLength?: number; // x-max-length; overflow drops the oldest (drop-head), keeping newest
  queueMessageTtlMs?: number; // x-message-ttl: discard messages older than this
  // Base delay before a reconnect attempt after the connection drops; doubles per failed
  // attempt up to 30s and resets on success. Default 1000ms.
  reconnectDelayMs?: number;
  // Injectable connector, for tests. Defaults to amqplib's connect.
  connect?: (url: string) => Promise<ConnLike>;
}

// Consume a queue of raw source events. Acks after the handler runs; drops a message
// (nack, no requeue) if it isn't valid JSON so a poison message can't wedge the queue.
//
// With `opts.exchange`, a dedicated queue is bound to that exchange (a fanout-style tap) so the
// client's existing consumers are untouched — see docs/integration-adapters.md.
//
// A lost connection (broker restart, heartbeat timeout) reconnects automatically with
// exponential backoff and re-runs the full setup (exchange/queue/bind/consume). Only the
// *initial* connect throws to the caller — fail fast on misconfiguration.
export async function rabbitmqSource(
  url: string,
  queue: string,
  onEvent: (raw: unknown) => void,
  opts: RabbitmqOptions = {},
): Promise<() => Promise<void>> {
  const connect = opts.connect ?? amqp.connect;
  const baseDelay = opts.reconnectDelayMs ?? 1000;

  let stopped = false;
  let live: { conn: ConnLike; channel: ChannelLike } | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleReconnect = (delayMs: number): void => {
    if (stopped) return;
    console.error(`[collector] rabbitmq connection lost; reconnecting in ${delayMs}ms`);
    retryTimer = setTimeout(() => {
      setup().catch(() => scheduleReconnect(Math.min(delayMs * 2, 30_000)));
    }, delayMs);
    retryTimer.unref?.();
  };

  const setup = async (): Promise<void> => {
    const conn = await connect(url);
    const channel = await conn.createChannel();
    live = { conn, channel };
    // An unhandled 'error' event would crash the process; 'close' always follows a lost
    // connection, so reconnection hangs off 'close' alone.
    conn.on("error", () => {});
    conn.on("close", () => {
      live = null;
      scheduleReconnect(baseDelay);
    });

    const queueArgs: Record<string, number | string> = {};
    if (opts.queueMaxLength != null) {
      queueArgs["x-max-length"] = opts.queueMaxLength;
      queueArgs["x-overflow"] = "drop-head"; // keep the newest events for a live view
    }
    if (opts.queueMessageTtlMs != null) queueArgs["x-message-ttl"] = opts.queueMessageTtlMs;
    const queueOpts = {
      durable: opts.queueDurable ?? true,
      ...(Object.keys(queueArgs).length > 0 ? { arguments: queueArgs } : {}),
    };

    if (opts.exchange) {
      if (opts.exchangeType) {
        await channel.assertExchange(opts.exchange, opts.exchangeType, { durable: true });
      } else {
        await channel.checkExchange(opts.exchange);
      }
      await channel.assertQueue(queue, queueOpts);
      const keys = opts.routingKeys && opts.routingKeys.length > 0 ? opts.routingKeys : ["#"];
      for (const key of keys) {
        await channel.bindQueue(queue, opts.exchange, key);
      }
    } else {
      await channel.assertQueue(queue, queueOpts);
    }

    await channel.prefetch(64);
    await channel.consume(queue, (msg) => {
      if (!msg) return;
      try {
        onEvent(JSON.parse(Buffer.from(msg.content).toString()));
        channel.ack(msg);
      } catch {
        channel.nack(msg, false, false);
      }
    });
  };

  await setup();

  return async () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (live) {
      const { conn, channel } = live;
      live = null;
      await channel.close();
      await conn.close();
    }
  };
}
