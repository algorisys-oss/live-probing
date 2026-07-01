import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addCartItem, ApiError, getProducts } from "../lib/api";
import { formatMoney } from "../lib/money";
import type { Product } from "../lib/types";
import { useAuth } from "../auth/AuthContext";

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    getProducts()
      .then((data) => {
        if (active) setProducts(data.products ?? []);
      })
      .catch((err) => {
        if (active) setError(err.message ?? "Failed to load products");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleAdd(product: Product) {
    if (!isAuthenticated) {
      navigate("/login", { state: { from: "/" } });
      return;
    }
    setAdding(product.id);
    setNotice(null);
    try {
      await addCartItem(product.id, 1);
      setNotice(`Added ${product.name} to cart`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login");
        return;
      }
      setNotice(err instanceof Error ? err.message : "Could not add to cart");
    } finally {
      setAdding(null);
    }
  }

  if (loading) return <p className="status">Loading products…</p>;
  if (error) return <p className="status error">{error}</p>;
  if (products.length === 0)
    return <p className="status">No products available.</p>;

  return (
    <section>
      <h1>Products</h1>
      {notice && <p className="notice">{notice}</p>}
      <div className="grid">
        {products.map((p) => (
          <article key={p.id} className="card">
            <div className="card-img">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} loading="lazy" />
              ) : (
                <div className="img-placeholder">No image</div>
              )}
            </div>
            <h2 className="card-name">{p.name}</h2>
            <p className="card-price">
              {formatMoney(p.priceCents, p.currency)}
            </p>
            <p className="card-stock">
              {p.stock > 0 ? `${p.stock} in stock` : "Out of stock"}
            </p>
            <button
              className="btn"
              disabled={adding === p.id || p.stock <= 0}
              onClick={() => handleAdd(p)}
            >
              {adding === p.id ? "Adding…" : "Add to cart"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
