import type { Pool, Redis, Product } from "@shopwave/shared";

const CACHE_TTL_SECONDS = 60;
const productKey = (id: string) => `product:${id}`;

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  category: string;
  image_url: string;
  stock: number;
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    currency: row.currency,
    category: row.category,
    imageUrl: row.image_url,
    stock: row.stock,
  };
}

export class CatalogRepo {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  async list(): Promise<Product[]> {
    const { rows } = await this.pool.query<ProductRow>(
      "SELECT * FROM products ORDER BY name ASC",
    );
    return rows.map(toProduct);
  }

  // Read-through cache: this is the hit/miss path the sequence diagram shows.
  async getById(id: string): Promise<{ product: Product | null; cache: "hit" | "miss" }> {
    const cached = await this.redis.get(productKey(id));
    if (cached) {
      return { product: JSON.parse(cached) as Product, cache: "hit" };
    }

    const { rows } = await this.pool.query<ProductRow>(
      "SELECT * FROM products WHERE id = $1",
      [id],
    );
    const row = rows[0];
    if (!row) return { product: null, cache: "miss" };

    const product = toProduct(row);
    await this.redis.set(productKey(id), JSON.stringify(product), "EX", CACHE_TTL_SECONDS);
    return { product, cache: "miss" };
  }
}
