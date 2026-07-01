import { createServer, start, connectRabbit, envInt, RoutingKeys, type OrderCreated } from "@shopwave/shared";
import { runSaga } from "./saga.js";
import { initDb } from "./db.js";
import { OrderRepo, type OrderItem } from "./repo.js";

interface CreateOrderBody {
  userId?: unknown;
  items?: unknown;
  totalCents?: unknown;
  currency?: unknown;
}

function isItem(value: unknown): value is OrderItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OrderItem).productId === "string" &&
    typeof (value as OrderItem).quantity === "number" &&
    typeof (value as OrderItem).priceCents === "number"
  );
}

async function main(): Promise<void> {
  const app = createServer();
  const pool = await initDb();
  const rabbit = await connectRabbit();
  const repo = new OrderRepo(pool);

  // Choreography saga: order-service owns order status and advances it as the payment
  // and inventory workers report back. The consume runs in the propagated trace context,
  // so these updates stay linked to the originating checkout.
  await runSaga(rabbit, repo);

  app.post<{ Body: CreateOrderBody }>("/orders", async (req, reply) => {
    const body = req.body;
    const items = body.items;
    if (typeof body.userId !== "string" || !Array.isArray(items) || items.length === 0 || !items.every(isItem)) {
      return reply.code(400).send({ error: "invalid_input" });
    }

    const order = await repo.createOrder({
      userId: body.userId,
      items,
      totalCents: typeof body.totalCents === "number" ? body.totalCents : 0,
      currency: typeof body.currency === "string" ? body.currency : "USD",
    });

    const event: OrderCreated = {
      orderId: order.id,
      userId: order.userId,
      items: order.items,
      totalCents: order.totalCents,
      currency: order.currency,
    };
    rabbit.publish(RoutingKeys.orderCreated, event);

    return reply.code(201).send({ order });
  });

  app.get<{ Params: { id: string } }>("/orders/:id", async (req, reply) => {
    const order = await repo.getById(req.params.id);
    if (!order) {
      return reply.code(404).send({ error: "order_not_found" });
    }
    return { order };
  });

  app.get<{ Querystring: { userId?: string } }>("/orders", async (req) => {
    const orders = await repo.listByUser(req.query.userId);
    return { orders };
  });

  await start(app, envInt("ORDER_PORT", 3004), async () => {
    await rabbit.close();
    await pool.end();
  });
}

main().catch((err) => {
  console.error("order failed to start", err);
  process.exit(1);
});
