import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  checkout,
  getCart,
  removeCartItem,
} from "../lib/api";
import { formatMoney } from "../lib/money";
import type { Cart } from "../lib/types";
import { useAuth } from "../auth/AuthContext";

export function CartPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleAuthError = useCallback(
    (err: unknown): boolean => {
      if (err instanceof ApiError && err.status === 401) {
        signOut();
        navigate("/login");
        return true;
      }
      return false;
    },
    [navigate, signOut]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCart();
      setCart(data);
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(err instanceof Error ? err.message : "Failed to load cart");
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRemove(productId: string) {
    setBusy(true);
    setError(null);
    try {
      await removeCartItem(productId);
      await load();
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(err instanceof Error ? err.message : "Failed to remove item");
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckout() {
    setBusy(true);
    setError(null);
    try {
      const { order } = await checkout();
      navigate(`/orders/${order.id}`);
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="status">Loading cart…</p>;
  if (error && !cart) return <p className="status error">{error}</p>;

  const items = cart?.items ?? [];

  return (
    <section>
      <h1>Your cart</h1>
      {error && <p className="status error">{error}</p>}
      {items.length === 0 ? (
        <p className="status">Your cart is empty.</p>
      ) : (
        <>
          <table className="cart-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Line total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                  <td>{formatMoney(item.priceCents, cart?.currency)}</td>
                  <td>{formatMoney(item.lineTotalCents, cart?.currency)}</td>
                  <td>
                    <button
                      className="link-btn danger"
                      disabled={busy}
                      onClick={() => handleRemove(item.productId)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <strong>Total</strong>
                </td>
                <td colSpan={2}>
                  <strong>
                    {formatMoney(cart?.totalCents ?? 0, cart?.currency)}
                  </strong>
                </td>
              </tr>
            </tfoot>
          </table>
          <button className="btn" disabled={busy} onClick={handleCheckout}>
            {busy ? "Processing…" : "Checkout"}
          </button>
        </>
      )}
    </section>
  );
}
