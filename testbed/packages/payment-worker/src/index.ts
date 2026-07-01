import { createServer, start, connectRabbit, env, envInt, RoutingKeys } from "@shopwave/shared";
import { initDb } from "./db.js";
import { createPaymentHandler } from "./processor.js";

async function main(): Promise<void> {
  const app = createServer();
  const pool = await initDb();
  const rabbit = await connectRabbit();

  const declineRate = Number(env("PAYMENT_DECLINE_RATE", "0.15"));
  const handler = createPaymentHandler(pool, rabbit, declineRate);

  await rabbit.consume("payment.order-created", [RoutingKeys.orderCreated], (content) =>
    handler(content),
  );

  await start(app, envInt("PAYMENT_PORT", 3005), async () => {
    await rabbit.close();
    await pool.end();
  });
}

main().catch((err) => {
  console.error("payment-worker failed to start", err);
  process.exit(1);
});
