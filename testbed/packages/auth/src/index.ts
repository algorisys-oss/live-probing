import { createServer, start, createRedis, envInt } from "@shopwave/shared";
import { initDb } from "./db.js";
import { hashPassword, verifyPassword, issueSession, verifySession } from "./auth.js";

interface Credentials {
  email?: unknown;
  password?: unknown;
}

interface UserRow {
  id: string;
  password_hash: string;
}

async function main(): Promise<void> {
  const app = createServer();
  const pool = await initDb();
  const redis = createRedis();

  app.post<{ Body: Credentials }>("/signup", async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || !email.includes("@") || typeof password !== "string" || password.length < 6) {
      return reply.code(400).send({ error: "invalid_input" });
    }

    let userId: string;
    try {
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [email, hashPassword(password)],
      );
      userId = rows[0]!.id;
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw err;
    }

    const token = await issueSession(redis, userId);
    return reply.code(201).send({ token, userId });
  });

  app.post<{ Body: Credentials }>("/login", async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const { rows } = await pool.query<UserRow>(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const token = await issueSession(redis, user.id);
    return { token, userId: user.id };
  });

  app.get("/verify", async (req, reply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const userId = token ? await verifySession(redis, token) : null;
    if (!userId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { userId };
  });

  await start(app, envInt("AUTH_PORT", 3001), async () => {
    await pool.end();
    redis.disconnect();
  });
}

main().catch((err) => {
  console.error("auth failed to start", err);
  process.exit(1);
});
