import { createPool, waitForPg, type Pool } from "@shopwave/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function initDb(): Promise<Pool> {
  const pool = createPool(process.env.POSTGRES_DB ?? "payments");
  await waitForPg(pool);
  await pool.query(SCHEMA);
  return pool;
}
