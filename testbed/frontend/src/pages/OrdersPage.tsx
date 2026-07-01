import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, getOrders } from "../lib/api";
import { formatMoney } from "../lib/money";
import type { Order } from "../lib/types";
import { useAuth } from "../auth/AuthContext";

const POLL_MS = 4000;

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "confirmed") return "badge confirmed";
  if (s === "cancelled" || s === "canceled") return "badge cancelled";
  return "badge pending";
}

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await getOrders();
      setOrders(data.orders ?? []);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        signOut();
        navigate("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      if (firstLoad.current) {
        firstLoad.current = false;
        setLoading(false);
      }
    }
  }, [navigate, signOut]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading) return <p className="status">Loading orders…</p>;
  if (error && orders.length === 0)
    return <p className="status error">{error}</p>;

  return (
    <section>
      <h1>Your orders</h1>
      <p className="hint">Status updates automatically.</p>
      {error && <p className="status error">{error}</p>}
      {orders.length === 0 ? (
        <p className="status">You have no orders yet.</p>
      ) : (
        <ul className="orders">
          {orders.map((order) => (
            <li key={order.id} className="order-row">
              <div className="order-meta">
                <span className="order-id">Order {order.id}</span>
                <span className="order-date">
                  {new Date(order.createdAt).toLocaleString()}
                </span>
              </div>
              <span className={statusClass(order.status)}>{order.status}</span>
              <span className="order-total">
                {formatMoney(order.totalCents, order.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
