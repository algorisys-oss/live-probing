import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getOrders } from "../lib/api";
import { formatMoney } from "../lib/money";
import type { Order } from "../lib/types";

export function OrderConfirmationPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOrders()
      .then((data) => {
        if (!active) return;
        const found =
          (data.orders ?? []).find((o) => o.id === orderId) ?? null;
        setOrder(found);
        if (!found) setError("Order not found.");
      })
      .catch((err) => {
        if (active) setError(err.message ?? "Failed to load order");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  if (loading) return <p className="status">Loading order…</p>;

  return (
    <section className="confirmation">
      <h1>Order confirmed</h1>
      {error && <p className="status error">{error}</p>}
      {order && (
        <div className="confirm-card">
          <p>
            Thank you! Your order <strong>{order.id}</strong> has been placed.
          </p>
          <p>
            Status: <strong>{order.status}</strong>
          </p>
          <p>
            Total:{" "}
            <strong>{formatMoney(order.totalCents, order.currency)}</strong>
          </p>
        </div>
      )}
      <p>
        <Link to="/orders" className="btn">
          View all orders
        </Link>
      </p>
    </section>
  );
}
