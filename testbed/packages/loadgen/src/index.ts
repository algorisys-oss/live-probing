import { env, envInt } from "@shopwave/shared";
import {
  addToCart,
  checkout,
  getCart,
  getOrders,
  listProducts,
  login,
  signup,
  type Product,
  type RequestCounter,
} from "./client.js";

const CONCURRENCY = envInt("CONCURRENCY", 5);
const DURATION_SECONDS = envInt("DURATION_SECONDS", 0);
const THINK_MS = envInt("THINK_MS", 400);
const PASSWORD = "loadtestpw";

interface Stats {
  journeys: number;
  checkouts: number;
  errors: number;
  requests: number;
}

const stats: Stats = { journeys: 0, checkouts: 0, errors: 0, requests: 0 };
const countRequest: RequestCounter = () => {
  stats.requests += 1;
};

let running = true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickRandom<T>(items: T[], n: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const [picked] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    if (picked !== undefined) out.push(picked);
  }
  return out;
}

async function journey(vuId: number, counter: number): Promise<void> {
  const email = `vu-${Math.random().toString(36).slice(2, 8)}-${counter}@load.test`;

  const result = await signup(email, PASSWORD, countRequest);
  const auth = result === "exists" ? await login(email, PASSWORD, countRequest) : result;
  const token = auth.token;
  await sleep(THINK_MS);

  const products: Product[] = await listProducts(countRequest);
  await sleep(THINK_MS);
  if (products.length === 0) throw new Error("no products available");

  const chosen = pickRandom(products, randInt(1, 3));
  for (const product of chosen) {
    await addToCart(token, product.id, randInt(1, 3), countRequest);
    await sleep(THINK_MS);
  }

  await getCart(token, countRequest);
  await sleep(THINK_MS);

  await checkout(token, countRequest);
  stats.checkouts += 1;
  await sleep(THINK_MS);

  await getOrders(token, countRequest);
}

async function virtualUser(vuId: number): Promise<void> {
  let counter = 0;
  while (running) {
    try {
      await journey(vuId, counter);
      stats.journeys += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`vu=${vuId} journey error:`, err instanceof Error ? err.message : err);
    }
    counter += 1;
    if (running) await sleep(THINK_MS);
  }
}

function printSummary(startedAt: number): void {
  const elapsed = (Date.now() - startedAt) / 1000;
  const rps = elapsed > 0 ? (stats.requests / elapsed).toFixed(1) : "0.0";
  console.log(
    `SUMMARY: elapsed=${elapsed.toFixed(1)}s journeys=${stats.journeys} ` +
      `checkouts_ok=${stats.checkouts} errors=${stats.errors} requests=${stats.requests} rps~${rps}`,
  );
}

async function main(): Promise<void> {
  const target = env("TARGET_URL", "http://localhost:3000");
  console.log(
    `loadgen starting: target=${target} concurrency=${CONCURRENCY} ` +
      `duration=${DURATION_SECONDS}s think=${THINK_MS}ms`,
  );

  const startedAt = Date.now();
  let lastRequests = 0;
  let lastTick = startedAt;

  const statsTimer = setInterval(() => {
    const now = Date.now();
    const windowRps = ((stats.requests - lastRequests) / ((now - lastTick) / 1000)).toFixed(1);
    lastRequests = stats.requests;
    lastTick = now;
    console.log(
      `stats: journeys=${stats.journeys} checkouts_ok=${stats.checkouts} ` +
        `errors=${stats.errors} rps~${windowRps}`,
    );
  }, 5000);

  const stop = (): void => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let durationTimer: NodeJS.Timeout | undefined;
  if (DURATION_SECONDS > 0) {
    durationTimer = setTimeout(stop, DURATION_SECONDS * 1000);
  }

  const users = Array.from({ length: CONCURRENCY }, (_, i) => virtualUser(i));
  await Promise.all(users);

  clearInterval(statsTimer);
  if (durationTimer) clearTimeout(durationTimer);
  printSummary(startedAt);
  process.exit(0);
}

main().catch((err) => {
  console.error("loadgen failed to start", err);
  process.exit(1);
});
