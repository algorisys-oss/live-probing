import { createServer, start, createRedis, envInt } from "@shopwave/shared";
import { initDb } from "./db.js";
import { CatalogRepo } from "./repo.js";

async function main(): Promise<void> {
  const app = createServer();
  const pool = await initDb();
  const redis = createRedis();
  const repo = new CatalogRepo(pool, redis);

  app.get("/products", async () => {
    const products = await repo.list();
    return { products };
  });

  app.get<{ Params: { id: string } }>("/products/:id", async (req, reply) => {
    const { product, cache } = await repo.getById(req.params.id);
    if (!product) {
      return reply.code(404).send({ error: "product_not_found", id: req.params.id });
    }
    reply.header("x-cache", cache);
    return { product, cache };
  });

  await start(app, envInt("CATALOG_PORT", 3002), async () => {
    await pool.end();
    redis.disconnect();
  });
}

main().catch((err) => {
  console.error("catalog failed to start", err);
  process.exit(1);
});
