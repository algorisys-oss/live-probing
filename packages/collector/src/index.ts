import { getAdapter } from "./adapters/index.js";
import { createSink } from "./sink.js";
import { stdinSource } from "./sources/stdin.js";
import { rabbitmqSource } from "./sources/rabbitmq.js";

// A collector instance = one source (transport) + one adapter (format) -> LiveProbe.
// Configure per client with env vars; run one per client (sidecar) or several instances.
//
//   SOURCE=stdin    ADAPTER=adapter-id-1                      < events.ndjson
//   SOURCE=rabbitmq ADAPTER=adapter-id-1 RABBITMQ_URL=... QUEUE=instrumentation.events
//
// To tap an existing exchange non-intrusively (bind our own queue for a copy of the stream):
//   SOURCE=rabbitmq ADAPTER=adapter-id-1 RABBITMQ_URL=... QUEUE=liveprobe.tap \
//     EXCHANGE=instrumentation ROUTING_KEY="#"   [EXCHANGE_TYPE=topic to declare it]
//
// Optionally bound the tap queue so it can't grow unbounded while the collector is down:
//   QUEUE_MAX_LENGTH=100000   (drops oldest past the cap)   QUEUE_MESSAGE_TTL_MS=60000
//
// LIVEPROBE_URL defaults to http://localhost:4319.

async function main(): Promise<void> {
  const source = process.env.SOURCE ?? "stdin";
  const adapterName = process.env.ADAPTER ?? "adapter-id-1";
  const liveprobeUrl = process.env.LIVEPROBE_URL ?? "http://localhost:4319";

  const adapt = getAdapter(adapterName);
  const sink = createSink(liveprobeUrl);
  const onEvent = (raw: unknown) => {
    try {
      sink.push(adapt(raw));
    } catch {
      // one bad event never stops the stream
    }
  };

  console.error(`[collector] source=${source} adapter=${adapterName} -> ${liveprobeUrl}/v1/events`);

  if (source === "stdin") {
    stdinSource(onEvent, () => void sink.close().then(() => process.exit(0)));
    return;
  }

  if (source === "rabbitmq") {
    const url = process.env.RABBITMQ_URL ?? "amqp://localhost:5672";
    const queue = process.env.QUEUE ?? "instrumentation.events";
    const exchange = process.env.EXCHANGE || undefined;
    const exchangeType = process.env.EXCHANGE_TYPE || undefined;
    const routingKeys = (process.env.ROUTING_KEY ?? "#")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    const posInt = (v: string | undefined): number | undefined => {
      const n = Number(v);
      return v && Number.isInteger(n) && n > 0 ? n : undefined;
    };
    const queueMaxLength = posInt(process.env.QUEUE_MAX_LENGTH);
    const queueMessageTtlMs = posInt(process.env.QUEUE_MESSAGE_TTL_MS);
    if (exchange) {
      console.error(
        `[collector] tapping exchange="${exchange}"${exchangeType ? ` (declare ${exchangeType})` : " (verify)"} keys=[${routingKeys.join(", ")}] -> queue="${queue}"`,
      );
    }
    const stop = await rabbitmqSource(url, queue, onEvent, {
      exchange,
      exchangeType,
      routingKeys,
      queueMaxLength,
      queueMessageTtlMs,
    });
    const shutdown = () => void Promise.resolve(stop()).then(() => sink.close()).then(() => process.exit(0));
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  console.error(`[collector] unknown SOURCE "${source}" (use stdin or rabbitmq)`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[collector] fatal:", err);
  process.exit(1);
});
