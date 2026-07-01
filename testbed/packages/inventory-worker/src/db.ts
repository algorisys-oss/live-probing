import { createPool, waitForPg, type Pool } from "@shopwave/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inventory (
  product_id TEXT PRIMARY KEY,
  available  INTEGER NOT NULL
);
`;

// Matches the catalog seed ids. p-005 and p-008 are deliberately low so
// out-of-stock happens under load; the rest are generously stocked.
const SEED: Array<{ productId: string; available: number }> = [
  { productId: "p-001", available: 100 },
  { productId: "p-002", available: 100 },
  { productId: "p-003", available: 100 },
  { productId: "p-004", available: 100 },
  { productId: "p-005", available: 4 },
  { productId: "p-006", available: 100 },
  { productId: "p-007", available: 100 },
  { productId: "p-008", available: 6 },
  { productId: "p-009", available: 100 },
  { productId: "p-010", available: 100 },
  { productId: "p-011", available: 100 },
  { productId: "p-012", available: 100 },
];

export async function initDb(): Promise<Pool> {
  const pool = createPool(process.env.POSTGRES_DB ?? "inventory");
  await waitForPg(pool);
  await pool.query(SCHEMA);
  await seedIfEmpty(pool);
  return pool;
}

async function seedIfEmpty(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM inventory");
  if (rows[0] && rows[0].count !== "0") return;

  for (const row of SEED) {
    await pool.query(
      `INSERT INTO inventory (product_id, available) VALUES ($1, $2)
       ON CONFLICT (product_id) DO NOTHING`,
      [row.productId, row.available],
    );
  }
}
