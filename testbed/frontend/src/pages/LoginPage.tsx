import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login, signup } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type Mode = "login" | "signup";

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? "/";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const fn = mode === "login" ? login : signup;
      const res = await fn(email, password);
      signIn(res.token);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth">
      <h1>{mode === "login" ? "Log in" : "Sign up"}</h1>
      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          Email
          <input
            type="email"
            value={email}
            required
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            required
            minLength={6}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="status error">{error}</p>}
        <button className="btn" type="submit" disabled={submitting}>
          {submitting
            ? "Please wait…"
            : mode === "login"
              ? "Log in"
              : "Create account"}
        </button>
      </form>
      <p className="auth-toggle">
        {mode === "login" ? "Need an account?" : "Already have an account?"}{" "}
        <button
          className="link-btn"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Sign up" : "Log in"}
        </button>
      </p>
    </section>
  );
}
