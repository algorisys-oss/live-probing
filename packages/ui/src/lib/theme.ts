// Light/dark theme: a data-theme attribute on <html> drives the CSS variables in
// styles.css. Persisted to localStorage; the initial value is applied by an inline
// script in index.html to avoid a flash before React mounts.

export type Theme = "dark" | "light";

const STORAGE_KEY = "liveprobe-theme";

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode) — theme still applies for this session */
  }
}
