import type { Pool, OrderCreated, InventoryResult } from "@shopwave/shared";

interface InventoryRow {
  available: number;
}

// Reserves stock for an order atomically. Reads each item's available quantity,
// and only if every item is fully in stock decrements them and commits; otherwise
// nothing is decremented and the shortfall is reported. A missing product is
// treated as available=0.
export async function reserveOrder(pool: Pool, order: OrderCreated): Promise<InventoryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const shortfall: NonNullable<InventoryResult["shortfall"]> = [];
    for (const item of order.items) {
      const { rows } = await client.query<InventoryRow>(
        "SELECT available FROM inventory WHERE product_id = $1",
        [item.productId],
      );
      const available = rows[0]?.available ?? 0;
      if (available < item.quantity) {
        shortfall.push({ productId: item.productId, requested: item.quantity, available });
      }
    }

    if (shortfall.length > 0) {
      await client.query("ROLLBACK");
      return { orderId: order.orderId, status: "out_of_stock", shortfall };
    }

    for (const item of order.items) {
      await client.query(
        "UPDATE inventory SET available = available - $1 WHERE product_id = $2",
        [item.quantity, item.productId],
      );
    }

    await client.query("COMMIT");
    return { orderId: order.orderId, status: "reserved" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
