import {
  RoutingKeys,
  type Redis,
  type PaymentResult,
  type InventoryResult,
} from "@shopwave/shared";

// Human-readable notification text for a given event, or null if the routing key
// carries no orderId we can address.
function describe(content: unknown, routingKey: string): { orderId: string; message: string } | null {
  const orderId = (content as { orderId?: unknown }).orderId;
  if (typeof orderId !== "string") return null;

  switch (routingKey) {
    case RoutingKeys.paymentCompleted:
      return { orderId, message: `order ${orderId}: payment confirmed` };
    case RoutingKeys.paymentFailed: {
      const reason = (content as PaymentResult).reason ?? "unknown reason";
      return { orderId, message: `order ${orderId}: payment declined (${reason})` };
    }
    case RoutingKeys.inventoryReserved:
      return { orderId, message: `order ${orderId}: items reserved` };
    case RoutingKeys.inventoryOutOfStock: {
      const shortfall = (content as InventoryResult).shortfall;
      const suffix = shortfall && shortfall.length > 0 ? ` (${shortfall.length} item(s) short)` : "";
      return { orderId, message: `order ${orderId}: some items are out of stock${suffix}` };
    }
    default:
      return null;
  }
}

// Builds the consumer handler. Dedupe key survives 1h so a redelivered or
// double-published event never notifies the customer twice. The redis SET NX is
// also what puts the redis hop on the trace for this worker.
export function makeHandler(redis: Redis): (content: unknown, routingKey: string) => Promise<void> {
  return async (content, routingKey) => {
    const notice = describe(content, routingKey);
    if (!notice) {
      console.warn(`notification: ignoring event without orderId (${routingKey})`);
      return;
    }

    const key = `notif:${notice.orderId}:${routingKey}`;
    const acquired = await redis.set(key, "1", "EX", 3600, "NX");
    if (acquired === null) {
      console.log(`notification: duplicate skipped ${key}`);
      return;
    }

    console.log(`notification sent -> ${notice.message}`);
  };
}
