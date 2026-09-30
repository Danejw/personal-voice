import { useState } from "react";
import type { FormEvent } from "react";
import type { AuthState } from "@/auth/useAuth";

type AuthMode = "sign-in" | "sign-up";

interface AuthFormProps {
  auth: AuthState;
}

/** Email and password. One primary action, switched between sign-in and create account. */
export function AuthForm({ auth }: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<string | null | void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "sign-in") {
      void run(() => auth.signIn(email, password));
      return;
    }
    void run(() => auth.signUp(email, password));
  }

  function choose(next: AuthMode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  const creating = mode === "sign-up";

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <div className="gate-switch" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={!creating} className={creating ? undefined : "is-on"} onClick={() => choose("sign-in")}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={creating} className={creating ? "is-on" : undefined} onClick={() => choose("sign-up")}>
          Create account
        </button>
      </div>
      <label className="field stack">
        <span>Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field stack">
        <span>Password</span>
        <input
          type="password"
          autoComplete={creating ? "new-password" : "current-password"}
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="submit" className="record" disabled={busy}>
        {creating ? "Create account" : "Sign in"}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
