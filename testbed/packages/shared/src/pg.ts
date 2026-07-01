import pg from "pg";
import { env, envInt } from "./env.js";

const { Pool } = pg;

export type Pool = pg.Pool;

export function createPool(database: string): pg.Pool {
  return new Pool({
    host: env("POSTGRES_HOST", "localhost"),
    port: envInt("POSTGRES_PORT", 5432),
    user: env("POSTGRES_USER", "shopwave"),
    password: env("POSTGRES_PASSWORD", "shopwave"),
    database,
    max: 10,
  });
}

// Retry the first connection: services boot before Postgres finishes accepting
// connections, and depends_on health only covers the default database.
export async function waitForPg(pool: pg.Pool, attempts = 30, delayMs = 1000): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
