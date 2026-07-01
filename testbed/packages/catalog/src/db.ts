import { createPool, waitForPg, type Pool } from "@shopwave/shared";
import { seedProducts } from "./seed.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  sku          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  price_cents  INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  category     TEXT NOT NULL,
  image_url    TEXT NOT NULL,
  stock        INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function initDb(): Promise<Pool> {
  const pool = createPool(process.env.POSTGRES_DB ?? "catalog");
  await waitForPg(pool);
  await pool.query(SCHEMA);
  await seed(pool);
  return pool;
}

async function seed(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM products");
  if (Number(rows[0]?.count ?? 0) > 0) return;

  const cols = 9;
  const values: string[] = [];
  const params: unknown[] = [];
  seedProducts.forEach((p, i) => {
    const base = i * cols;
    const placeholders = Array.from({ length: cols }, (_, c) => `$${base + c + 1}`);
    values.push(`(${placeholders.join(",")})`);
    params.push(p.id, p.sku, p.name, p.description, p.priceCents, p.currency, p.category, p.imageUrl, p.stock);
  });

  await pool.query(
    `INSERT INTO products (id, sku, name, description, price_cents, currency, category, image_url, stock)
     VALUES ${values.join(",")}`,
    params,
  );
}
