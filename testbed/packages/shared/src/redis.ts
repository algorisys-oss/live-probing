import { createRequire } from "node:module";
import type { Redis as RedisClient } from "ioredis";
import { env } from "./env.js";

// ioredis must be loaded via CJS require so OpenTelemetry's instrumentation
// (require-in-the-middle) patches it. The ESM import path is not hooked, so an
// `import` here silently produces no redis spans. Same trap will apply to
// amqplib at T2.
const require = createRequire(import.meta.url);
const { Redis } = require("ioredis") as typeof import("ioredis");

export type { RedisClient as Redis };

export function createRedis(): RedisClient {
  return new Redis(env("REDIS_URL", "redis://localhost:6379"), {
    maxRetriesPerRequest: 5,
    lazyConnect: false,
  });
}
