import { createServer, start, createRedis, connectRabbit, envInt, RoutingKeys } from "@shopwave/shared";
import { makeHandler } from "./handler.js";

async function main(): Promise<void> {
  const redis = createRedis();
  const rabbit = await connectRabbit();

  await rabbit.consume(
    "notification.events",
    [
      RoutingKeys.paymentCompleted,
      RoutingKeys.paymentFailed,
      RoutingKeys.inventoryReserved,
      RoutingKeys.inventoryOutOfStock,
    ],
    makeHandler(redis),
  );

  await start(createServer(), envInt("NOTIFICATION_PORT", 3007), async () => {
    await rabbit.close();
    redis.disconnect();
  });
}

main().catch((err) => {
  console.error("notification-worker failed to start", err);
  process.exit(1);
});
