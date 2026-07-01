import { createPool, waitForPg, type Pool } from "@shopwave/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function initDb(): Promise<Pool> {
  const pool = createPool(process.env.POSTGRES_DB ?? "auth");
  await waitForPg(pool);
  await pool.query(SCHEMA);
  return pool;
}
