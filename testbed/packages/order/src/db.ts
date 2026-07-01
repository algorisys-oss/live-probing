import { createPool, waitForPg, type Pool } from "@shopwave/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_cents INTEGER NOT NULL
);
-- Saga state: set as payment/inventory events arrive; status is recomputed from them.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_status TEXT;
`;

export async function initDb(): Promise<Pool> {
  const pool = createPool(process.env.POSTGRES_DB ?? "orders");
  await waitForPg(pool);
  await pool.query(SCHEMA);
  return pool;
}
