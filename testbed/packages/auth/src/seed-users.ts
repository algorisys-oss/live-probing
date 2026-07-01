import type { Pool } from "@shopwave/shared";
import { hashPassword } from "./auth.js";

// Known accounts so the storefront and API can be used without signing up first.
// Documented in the repo README. All share one password for convenience.
export const SAMPLE_USERS = [
  { email: "alice@shopwave.test", password: "password123" },
  { email: "bob@shopwave.test", password: "password123" },
  { email: "carol@shopwave.test", password: "password123" },
];

// Idempotent: inserts each sample user once and leaves real signups untouched.
export async function seedUsers(pool: Pool): Promise<void> {
  for (const user of SAMPLE_USERS) {
    await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
      [user.email, hashPassword(user.password)],
    );
  }
}
