import { useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useLiveStore } from "../store/use-live-store";

export function Header() {
  const connected = useLiveStore((s) => s.connected);
  const traces = useLiveStore((s) => s.traces);
  const topology = useLiveStore((s) => s.topology);
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const serviceCount = useMemo(() => topology.nodes.length, [topology.nodes]);

  // Keep "History" highlighted while drilling into a specific day.
  const historyActive =
    location.pathname.startsWith("/history") ||
    location.pathname.startsWith("/day");

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <header className="header">
      <div className="header-left">
        <Link to="/" className="logo logo-link">
          LiveProbe
        </Link>
        <span
          className={
            connected ? "status status-live" : "status status-offline"
          }
        >
          <span className="status-dot" />
          {connected ? "live" : "offline"}
        </span>
        <nav className="header-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? "nav-link nav-link-active" : "nav-link"
            }
          >
            Live
          </NavLink>
          <NavLink
            to="/history"
            className={historyActive ? "nav-link nav-link-active" : "nav-link"}
          >
            History
          </NavLink>
          <NavLink
            to="/errors"
            className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
          >
            Errors
          </NavLink>
          <NavLink
            to="/search"
            className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
          >
            Search
          </NavLink>
        </nav>
      </div>
      <div className="header-right">
        <form className="header-search" onSubmit={submitSearch}>
          <input
            className="header-search-input"
            placeholder="Search traces…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <span className="counter">
          <strong>{traces.length}</strong> traces
        </span>
        <span className="counter">
          <strong>{serviceCount}</strong> services
        </span>
        <span className="version" title="LiveProbe version">
          v{__APP_VERSION__}
        </span>
      </div>
    </header>
  );
}
