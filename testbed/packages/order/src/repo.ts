import type { Pool } from "@shopwave/shared";

export interface OrderItem {
  productId: string;
  quantity: number;
  priceCents: number;
}

export interface Order {
  id: string;
  userId: string;
  status: string;
  totalCents: number;
  currency: string;
  items: OrderItem[];
  createdAt: string;
}

export interface CreateOrderInput {
  userId: string;
  items: OrderItem[];
  totalCents: number;
  currency: string;
}

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  total_cents: number;
  currency: string;
  created_at: Date;
}

interface OrderItemRow {
  order_id: string;
  product_id: string;
  quantity: number;
  price_cents: number;
}

function toOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    totalCents: row.total_cents,
    currency: row.currency,
    items,
    createdAt: row.created_at.toISOString(),
  };
}

function toItem(row: OrderItemRow): OrderItem {
  return {
    productId: row.product_id,
    quantity: row.quantity,
    priceCents: row.price_cents,
  };
}

export class OrderRepo {
  constructor(private readonly pool: Pool) {}

  // Order header and its items are written together so a partial order can never be observed.
  async createOrder(input: CreateOrderInput): Promise<Order> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query<OrderRow>(
        `INSERT INTO orders (user_id, total_cents, currency)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, status, total_cents, currency, created_at`,
        [input.userId, input.totalCents, input.currency],
      );
      const orderRow = rows[0];
      if (!orderRow) throw new Error("insert did not return an order row");

      for (const item of input.items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price_cents)
           VALUES ($1, $2, $3, $4)`,
          [orderRow.id, item.productId, item.quantity, item.priceCents],
        );
      }

      await client.query("COMMIT");
      return toOrder(orderRow, input.items);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Apply a payment outcome and recompute status in one atomic UPDATE so a payment
  // and an inventory event for the same order cannot race a read-modify-write.
  async applyPaymentStatus(orderId: string, paymentStatus: "completed" | "failed"): Promise<void> {
    await this.pool.query(
      `UPDATE orders SET
         payment_status = $2,
         status = CASE
           WHEN $2 = 'failed' OR inventory_status = 'out_of_stock' THEN 'cancelled'
           WHEN $2 = 'completed' AND inventory_status = 'reserved' THEN 'confirmed'
           ELSE 'pending' END
       WHERE id = $1`,
      [orderId, paymentStatus],
    );
  }

  async applyInventoryStatus(orderId: string, inventoryStatus: "reserved" | "out_of_stock"): Promise<void> {
    await this.pool.query(
      `UPDATE orders SET
         inventory_status = $2,
         status = CASE
           WHEN $2 = 'out_of_stock' OR payment_status = 'failed' THEN 'cancelled'
           WHEN $2 = 'reserved' AND payment_status = 'completed' THEN 'confirmed'
           ELSE 'pending' END
       WHERE id = $1`,
      [orderId, inventoryStatus],
    );
  }

  async getById(id: string): Promise<Order | null> {
    const { rows } = await this.pool.query<OrderRow>(
      `SELECT id, user_id, status, total_cents, currency, created_at
       FROM orders WHERE id = $1`,
      [id],
    );
    const orderRow = rows[0];
    if (!orderRow) return null;

    const items = await this.itemsFor([id]);
    return toOrder(orderRow, items.get(id) ?? []);
  }

  async listByUser(userId?: string): Promise<Order[]> {
    const { rows } = userId
      ? await this.pool.query<OrderRow>(
          `SELECT id, user_id, status, total_cents, currency, created_at
           FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId],
        )
      : await this.pool.query<OrderRow>(
          `SELECT id, user_id, status, total_cents, currency, created_at
           FROM orders ORDER BY created_at DESC`,
        );

    if (rows.length === 0) return [];
    const items = await this.itemsFor(rows.map((r) => r.id));
    return rows.map((r) => toOrder(r, items.get(r.id) ?? []));
  }

  private async itemsFor(orderIds: string[]): Promise<Map<string, OrderItem[]>> {
    const { rows } = await this.pool.query<OrderItemRow>(
      `SELECT order_id, product_id, quantity, price_cents
       FROM order_items WHERE order_id = ANY($1) ORDER BY id ASC`,
      [orderIds],
    );
    const byOrder = new Map<string, OrderItem[]>();
    for (const row of rows) {
      const list = byOrder.get(row.order_id) ?? [];
      list.push(toItem(row));
      byOrder.set(row.order_id, list);
    }
    return byOrder;
  }
}
