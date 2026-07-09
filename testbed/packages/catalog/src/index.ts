import { createServer, start, createRedis, envInt, applyFault, faultFromEnv, faultActive } from "@shopwave/shared";
import { initDb } from "./db.js";
import { CatalogRepo } from "./repo.js";

async function main(): Promise<void> {
  const app = createServer();
  const pool = await initDb();
  const redis = createRedis();
  const repo = new CatalogRepo(pool, redis);

  // Demo chaos (default off): make catalog a slow/failing dependency so the checkout path lights
  // up amber/red in LiveProbe. Configured via CATALOG_FAULT_* env — see docker-compose.chaos.yml.
  const fault = faultFromEnv("CATALOG_FAULT");
  if (faultActive(fault)) app.log.warn({ fault }, "catalog fault injection ACTIVE");

  app.get("/products", async () => {
    await applyFault(fault);
    const products = await repo.list();
    return { products };
  });

  app.get<{ Params: { id: string } }>("/products/:id", async (req, reply) => {
    await applyFault(fault);
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
