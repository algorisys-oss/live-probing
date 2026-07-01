import { createRequire } from "node:module";

// amqplib via createRequire (CJS), consistent with the rest of the repo.
const require = createRequire(import.meta.url);
const amqp = require("amqplib") as typeof import("amqplib");

// Consume a queue of raw source events. Acks only after the handler runs; drops a message
// (nack, no requeue) if it isn't valid JSON so a poison message can't wedge the queue.
export async function rabbitmqSource(
  url: string,
  queue: string,
  onEvent: (raw: unknown) => void,
): Promise<() => Promise<void>> {
  const conn = await amqp.connect(url);
  const channel = await conn.createChannel();
  await channel.assertQueue(queue, { durable: true });
  await channel.prefetch(64);
  await channel.consume(queue, (msg) => {
    if (!msg) return;
    try {
      onEvent(JSON.parse(msg.content.toString()));
      channel.ack(msg);
    } catch {
      channel.nack(msg, false, false);
    }
  });
  return async () => {
    await channel.close();
    await conn.close();
  };
}
