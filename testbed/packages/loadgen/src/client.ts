import { env } from "@shopwave/shared";

const baseUrl = env("TARGET_URL", "http://localhost:3000").replace(/\/$/, "");

// Every request flows through here so the caller can count it (requests/sec stat).
export type RequestCounter = () => void;

export interface AuthTokens {
  token: string;
  userId: string;
}

export interface Product {
  id: string;
  priceCents: number;
}

async function request(
  method: string,
  path: string,
  count: RequestCounter,
  opts: { body?: unknown; token?: string } = {},
): Promise<Response> {
  count();
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  // Checkout sends no body; setting content-type on an empty body makes Fastify 400.
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  return fetch(`${baseUrl}${path}`, init);
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function signup(
  email: string,
  password: string,
  count: RequestCounter,
): Promise<AuthTokens | "exists"> {
  const res = await request("POST", "/api/signup", count, { body: { email, password } });
  if (res.status === 409) return "exists";
  if (!res.ok) throw new Error(`signup failed: ${res.status}`);
  return readJson<AuthTokens>(res);
}

export async function login(
  email: string,
  password: string,
  count: RequestCounter,
): Promise<AuthTokens> {
  const res = await request("POST", "/api/login", count, { body: { email, password } });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return readJson<AuthTokens>(res);
}

export async function listProducts(count: RequestCounter): Promise<Product[]> {
  const res = await request("GET", "/api/products", count);
  if (!res.ok) throw new Error(`list products failed: ${res.status}`);
  const body = await readJson<{ products: Product[] }>(res);
  return body.products;
}

export async function getProduct(id: string, count: RequestCounter): Promise<void> {
  const res = await request("GET", `/api/products/${id}`, count);
  if (!res.ok) throw new Error(`get product failed: ${res.status}`);
  await res.arrayBuffer();
}

export async function addToCart(
  token: string,
  productId: string,
  quantity: number,
  count: RequestCounter,
): Promise<void> {
  const res = await request("POST", "/api/cart/items", count, {
    token,
    body: { productId, quantity },
  });
  if (!res.ok) throw new Error(`add to cart failed: ${res.status}`);
  await res.arrayBuffer();
}

export async function getCart(token: string, count: RequestCounter): Promise<void> {
  const res = await request("GET", "/api/cart", count, { token });
  if (!res.ok) throw new Error(`get cart failed: ${res.status}`);
  await res.arrayBuffer();
}

export async function checkout(token: string, count: RequestCounter): Promise<void> {
  const res = await request("POST", "/api/checkout", count, { token });
  if (!res.ok) throw new Error(`checkout failed: ${res.status}`);
  await res.arrayBuffer();
}

export async function getOrders(token: string, count: RequestCounter): Promise<void> {
  const res = await request("GET", "/api/orders", count, { token });
  if (!res.ok) throw new Error(`get orders failed: ${res.status}`);
  await res.arrayBuffer();
}
