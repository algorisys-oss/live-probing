import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";

export function Layout() {
  const { isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    signOut();
    navigate("/login");
  }

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="brand">
          Storefront
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Products
          </NavLink>
          <NavLink to="/cart">Cart</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          {isAuthenticated ? (
            <button className="link-btn" onClick={handleLogout}>
              Logout
            </button>
          ) : (
            <NavLink to="/login">Login</NavLink>
          )}
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
