import { createPool, waitForPg, type Pool } from "@shopwave/shared";
import { seedUsers } from "./seed-users.js";

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
  await seedUsers(pool);
  return pool;
}
