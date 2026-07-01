import { createRequire } from "node:module";
import { env } from "./env.js";
import { ORDER_EXCHANGE } from "./contracts.js";

// amqplib is loaded via CJS require for the same reason as ioredis: OpenTelemetry's
// amqplib instrumentation only hooks the require path. Loaded this way, publish and
// consume spans appear and trace context is injected into / extracted from message
// headers automatically, so a trace stays connected across the RabbitMQ boundary.
const require = createRequire(import.meta.url);
const amqp = require("amqplib") as typeof import("amqplib");

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
export type Channel = Awaited<ReturnType<Connection["createChannel"]>>;

export type MessageHandler = (content: unknown, routingKey: string) => Promise<void>;

export interface Rabbit {
  channel: Channel;
  publish(routingKey: string, message: unknown): void;
  // Assert a durable queue, bind it to the shared exchange for each routing key, and
  // process messages. A handler that throws nacks without requeue (drop) so a poison
  // message cannot wedge the queue.
  consume(queue: string, routingKeys: string[], handler: MessageHandler): Promise<void>;
  close(): Promise<void>;
}

async function connectWithRetry(url: string, attempts = 30, delayMs = 1000): Promise<Connection> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await amqp.connect(url);
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("unreachable");
}

// Connects, asserts the shared topic exchange, and returns a publish/consume handle.
export async function connectRabbit(): Promise<Rabbit> {
  const conn = await connectWithRetry(env("RABBITMQ_URL", "amqp://localhost:5672"));
  const channel = await conn.createChannel();
  await channel.assertExchange(ORDER_EXCHANGE, "topic", { durable: true });
  await channel.prefetch(16);

  return {
    channel,
    publish(routingKey, message) {
      channel.publish(ORDER_EXCHANGE, routingKey, Buffer.from(JSON.stringify(message)), {
        contentType: "application/json",
        persistent: true,
      });
    },
    async consume(queue, routingKeys, handler) {
      await channel.assertQueue(queue, { durable: true });
      for (const rk of routingKeys) {
        await channel.bindQueue(queue, ORDER_EXCHANGE, rk);
      }
      await channel.consume(queue, (msg) => {
        if (!msg) return;
        void (async () => {
          try {
            const content = JSON.parse(msg.content.toString());
            await handler(content, msg.fields.routingKey);
            channel.ack(msg);
          } catch {
            channel.nack(msg, false, false);
          }
        })();
      });
    },
    async close() {
      await channel.close();
      await conn.close();
    },
  };
}
