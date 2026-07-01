import type {
  AuthResponse,
  Cart,
  Order,
  Product,
} from "./types";

export const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:3000";

const TOKEN_KEY = "storefront.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** When true, send no body and no content-type (checkout endpoint). */
  empty?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = false, empty = false } = opts;
  const headers: Record<string, string> = {};

  if (!empty && body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (auth) {
    const token = getToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: empty ? undefined : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Network error — is the API reachable?");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && typeof data.message === "string") message = data.message;
      else if (data && typeof data.error === "string") message = data.error;
    } catch {
      /* ignore parse errors */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as T;
  }
}

// --- Auth ---
export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/login", {
    method: "POST",
    body: { email, password },
  });
}

export function signup(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/signup", {
    method: "POST",
    body: { email, password },
  });
}

// --- Products ---
export function getProducts(): Promise<{ products: Product[] }> {
  return request<{ products: Product[] }>("/api/products");
}

export function getProduct(id: string): Promise<{ product: Product }> {
  return request<{ product: Product }>(`/api/products/${id}`);
}

// --- Cart (protected) ---
export function getCart(): Promise<Cart> {
  return request<Cart>("/api/cart", { auth: true });
}

export function addCartItem(productId: string, quantity: number): Promise<unknown> {
  return request("/api/cart/items", {
    method: "POST",
    body: { productId, quantity },
    auth: true,
  });
}

export function removeCartItem(productId: string): Promise<unknown> {
  return request(`/api/cart/items/${productId}`, {
    method: "DELETE",
    auth: true,
  });
}

// --- Checkout / Orders (protected) ---
export function checkout(): Promise<{ order: Order }> {
  return request<{ order: Order }>("/api/checkout", {
    method: "POST",
    auth: true,
    empty: true,
  });
}

export function getOrders(): Promise<{ orders: Order[] }> {
  return request<{ orders: Order[] }>("/api/orders", { auth: true });
}
