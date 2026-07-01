import { createServer, start, connectRabbit, envInt, RoutingKeys, type OrderCreated } from "@shopwave/shared";
import { initDb } from "./db.js";
import { reserveOrder } from "./processor.js";

async function main(): Promise<void> {
  const app = createServer();
  const pool = await initDb();
  const rabbit = await connectRabbit();

  await rabbit.consume("inventory.order-created", [RoutingKeys.orderCreated], async (content) => {
    const order = content as OrderCreated;
    const result = await reserveOrder(pool, order);

    if (result.status === "reserved") {
      rabbit.publish(RoutingKeys.inventoryReserved, { orderId: result.orderId, status: "reserved" });
    } else {
      rabbit.publish(RoutingKeys.inventoryOutOfStock, result);
    }

    app.log.info({ orderId: result.orderId, status: result.status }, "inventory processed");
  });

  await start(app, envInt("INVENTORY_PORT", 3006), async () => {
    await rabbit.close();
    await pool.end();
  });
}

main().catch((err) => {
  console.error("inventory-worker failed to start", err);
  process.exit(1);
});
