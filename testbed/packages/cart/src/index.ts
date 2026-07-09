import {
  createServer,
  start,
  createRedis,
  env,
  envInt,
  resilientFetch,
  policyFromEnv,
  type FastifyReply,
} from "@shopwave/shared";
import { getCart, fetchProduct, cartKey } from "./cart.js";

async function main(): Promise<void> {
  const app = createServer();
  const redis = createRedis();
  const catalogUrl = env("CATALOG_URL", "http://localhost:3002");
  const orderUrl = env("ORDER_URL", "http://localhost:3004");
  // Resilience for cart's outbound calls to catalog + order (default off). When a fault is
  // injected downstream, CART_RESILIENCE_* turns on retries/timeout/breaker — retries show as
  // repeated spans in LiveProbe, a tripped breaker sheds load off the sick service.
  const resilience = policyFromEnv("CART_RESILIENCE");

  // The gateway authenticates and forwards the user via x-user-id. Missing it
  // means the request never passed auth, so reject before touching Redis.
  function requireUser(req: { headers: Record<string, unknown> }, reply: FastifyReply): string | null {
    const raw = req.headers["x-user-id"];
    const userId = typeof raw === "string" ? raw : "";
    if (!userId) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    return userId;
  }

  app.get("/cart", async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;
    return getCart(redis, catalogUrl, userId, resilience);
  });

  app.post<{ Body: { productId?: unknown; quantity?: unknown } }>(
    "/cart/items",
    async (req, reply) => {
      const userId = requireUser(req, reply);
      if (!userId) return reply;

      const { productId, quantity } = req.body ?? {};
      if (
        typeof productId !== "string" ||
        productId === "" ||
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity < 1
      ) {
        return reply.code(400).send({ error: "invalid_input" });
      }

      const product = await fetchProduct(catalogUrl, productId, resilience);
      if (!product) {
        return reply.code(404).send({ error: "product_not_found" });
      }

      await redis.hincrby(cartKey(userId), productId, quantity);
      return getCart(redis, catalogUrl, userId, resilience);
    },
  );

  app.delete<{ Params: { productId: string } }>(
    "/cart/items/:productId",
    async (req, reply) => {
      const userId = requireUser(req, reply);
      if (!userId) return reply;
      await redis.hdel(cartKey(userId), req.params.productId);
      return getCart(redis, catalogUrl, userId, resilience);
    },
  );

  app.post("/cart/checkout", async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    const hash = await redis.hgetall(cartKey(userId));
    if (Object.keys(hash).length === 0) {
      return reply.code(400).send({ error: "empty_cart" });
    }

    const items: Array<{ productId: string; quantity: number; priceCents: number }> = [];
    let totalCents = 0;
    for (const [productId, rawQty] of Object.entries(hash)) {
      const product = await fetchProduct(catalogUrl, productId, resilience);
      if (!product) continue;
      const quantity = Number.parseInt(rawQty, 10);
      totalCents += product.priceCents * quantity;
      items.push({ productId, quantity, priceCents: product.priceCents });
    }

    const res = await resilientFetch(
      `${orderUrl}/orders`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, items, totalCents, currency: "USD" }),
      },
      resilience,
    );

    const body = await res.text();
    if (!res.ok) {
      // Surface the order service's failure verbatim to the caller.
      reply.code(res.status);
      reply.header("content-type", res.headers.get("content-type") ?? "application/json");
      return body;
    }

    await redis.del(cartKey(userId));
    reply.code(201);
    reply.header("content-type", res.headers.get("content-type") ?? "application/json");
    return body;
  });

  await start(app, envInt("CART_PORT", 3003), async () => {
    redis.disconnect();
  });
}

main().catch((err) => {
  console.error("cart failed to start", err);
  process.exit(1);
});
