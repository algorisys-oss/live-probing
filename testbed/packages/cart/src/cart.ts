import type { Redis, Product } from "@shopwave/shared";

const cartKey = (userId: string) => `cart:${userId}`;

export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  priceCents: number;
  lineTotalCents: number;
}

export interface CartView {
  items: CartItem[];
  totalCents: number;
  currency: string;
}

// Fetches a single product from catalog. Catalog wraps the product in
// { product, cache }, and returns 404 for unknown ids. The fetch keeps catalog
// on the trace via HTTP-client instrumentation.
async function fetchProduct(catalogUrl: string, id: string): Promise<Product | null> {
  const res = await fetch(`${catalogUrl}/products/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`catalog ${res.status} for product ${id}`);
  const body = (await res.json()) as { product: Product };
  return body.product;
}

// Builds the enriched cart view by joining the stored quantities against live
// catalog prices. Lines whose product no longer exists (404) are skipped.
export async function getCart(
  redis: Redis,
  catalogUrl: string,
  userId: string,
): Promise<CartView> {
  const hash = await redis.hgetall(cartKey(userId));
  const items: CartItem[] = [];
  let totalCents = 0;

  for (const [productId, rawQty] of Object.entries(hash)) {
    const product = await fetchProduct(catalogUrl, productId);
    if (!product) continue;
    const quantity = Number.parseInt(rawQty, 10);
    const lineTotalCents = product.priceCents * quantity;
    totalCents += lineTotalCents;
    items.push({
      productId,
      name: product.name,
      quantity,
      priceCents: product.priceCents,
      lineTotalCents,
    });
  }

  return { items, totalCents, currency: "USD" };
}

export { cartKey, fetchProduct };
