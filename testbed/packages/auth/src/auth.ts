import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import type { Redis } from "@shopwave/shared";
import { env } from "@shopwave/shared";

// jsonwebtoken is CJS-only; load it via require so it works under ESM and stays
// consistent with how the rest of the monorepo pulls in CJS deps.
const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");

const JWT_SECRET = env("JWT_SECRET", "dev-secret-change-me");
const SESSION_TTL_SECONDS = 3600;
const KEY_LEN = 64;
const SALT_LEN = 16;

const sessionKey = (jti: string) => `session:${jti}`;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), KEY_LEN);
  // timingSafeEqual throws on length mismatch, so guard first.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// Issues a JWT and records the session in Redis. Redis is the source of truth
// for validity, which makes sessions revocable and observable as redis spans.
export async function issueSession(redis: Redis, userId: string): Promise<string> {
  const jti = randomUUID();
  await redis.set(sessionKey(jti), userId, "EX", SESSION_TTL_SECONDS);
  return jwt.sign({ sub: userId, jti }, JWT_SECRET, { expiresIn: SESSION_TTL_SECONDS });
}

// Returns the userId for a valid, non-revoked token, or null otherwise.
export async function verifySession(redis: Redis, token: string): Promise<string | null> {
  let payload: { sub?: unknown; jti?: unknown };
  try {
    payload = jwt.verify(token, JWT_SECRET) as typeof payload;
  } catch {
    return null;
  }

  const { sub, jti } = payload;
  if (typeof sub !== "string" || typeof jti !== "string") return null;

  const stored = await redis.get(sessionKey(jti));
  if (stored === null || stored !== sub) return null;
  return sub;
}
