import { RoutingKeys, type Rabbit } from "@shopwave/shared";
import type { OrderRepo } from "./repo.js";

const SAGA_QUEUE = "order.saga";

// Consume the payment and inventory outcomes and fold them into order status.
export async function runSaga(rabbit: Rabbit, repo: OrderRepo): Promise<void> {
  await rabbit.consume(
    SAGA_QUEUE,
    [
      RoutingKeys.paymentCompleted,
      RoutingKeys.paymentFailed,
      RoutingKeys.inventoryReserved,
      RoutingKeys.inventoryOutOfStock,
    ],
    async (content, routingKey) => {
      const orderId = (content as { orderId?: unknown }).orderId;
      if (typeof orderId !== "string") return;

      switch (routingKey) {
        case RoutingKeys.paymentCompleted:
          return repo.applyPaymentStatus(orderId, "completed");
        case RoutingKeys.paymentFailed:
          return repo.applyPaymentStatus(orderId, "failed");
        case RoutingKeys.inventoryReserved:
          return repo.applyInventoryStatus(orderId, "reserved");
        case RoutingKeys.inventoryOutOfStock:
          return repo.applyInventoryStatus(orderId, "out_of_stock");
      }
    },
  );
}
