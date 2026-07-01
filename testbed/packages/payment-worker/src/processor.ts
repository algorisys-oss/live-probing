import { RoutingKeys, type Pool, type Rabbit, type OrderCreated } from "@shopwave/shared";

function isOrderCreated(value: unknown): value is OrderCreated {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OrderCreated).orderId === "string" &&
    typeof (value as OrderCreated).totalCents === "number"
  );
}

// Charges the order: fail with probability declineRate, otherwise complete. The
// payments row is written before the result is published so the outcome is durable
// even if the process dies right after publishing.
export function createPaymentHandler(
  pool: Pool,
  rabbit: Rabbit,
  declineRate: number,
): (content: unknown) => Promise<void> {
  return async (content) => {
    if (!isOrderCreated(content)) throw new Error("invalid OrderCreated payload");

    const declined = Math.random() < declineRate;
    const status = declined ? "failed" : "completed";
    const reason = declined ? "card_declined" : null;

    await pool.query(
      `INSERT INTO payments (order_id, amount_cents, status, reason)
       VALUES ($1, $2, $3, $4)`,
      [content.orderId, content.totalCents, status, reason],
    );

    if (declined) {
      rabbit.publish(RoutingKeys.paymentFailed, {
        orderId: content.orderId,
        status: "failed",
        reason: "card_declined",
      });
    } else {
      rabbit.publish(RoutingKeys.paymentCompleted, {
        orderId: content.orderId,
        status: "completed",
      });
    }

    console.log(`payment ${status} order=${content.orderId}`);
  };
}
