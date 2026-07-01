// Shared domain types and message contracts. Kept in one place so producers and
// consumers of the RabbitMQ events cannot drift (used from task T2 onward).

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  category: string;
  imageUrl: string;
  stock: number;
}

// RabbitMQ topology (single topic exchange, routing keys per event).
export const ORDER_EXCHANGE = "shopwave.orders";

export const RoutingKeys = {
  orderCreated: "order.created",
  paymentCompleted: "payment.completed",
  paymentFailed: "payment.failed",
  inventoryReserved: "inventory.reserved",
  inventoryOutOfStock: "inventory.out_of_stock",
} as const;

export type RoutingKey = (typeof RoutingKeys)[keyof typeof RoutingKeys];

export interface OrderCreated {
  orderId: string;
  userId: string;
  items: Array<{ productId: string; quantity: number; priceCents: number }>;
  totalCents: number;
  currency: string;
}

export interface PaymentResult {
  orderId: string;
  status: "completed" | "failed";
  reason?: string;
}

export interface InventoryResult {
  orderId: string;
  status: "reserved" | "out_of_stock";
  shortfall?: Array<{ productId: string; requested: number; available: number }>;
}
