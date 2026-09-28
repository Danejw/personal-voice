import { useState } from "react";
import type { FormEvent } from "react";
import type { AuthState } from "@/auth/useAuth";

interface AuthPanelProps {
  auth: AuthState;
  /** Sign-out is blocked while an utterance is in flight. */
  disabled: boolean;
}

/** Email/password sign-in; the session authorizes the short-lived Gemini token. */
export function AuthPanel({ auth, disabled }: AuthPanelProps) {
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
    void run(() => auth.signIn(email, password));
  }

  if (!auth.configured) return <p className="error">Sign-in is not configured for this build.</p>;
  if (!auth.ready) return <p className="placeholder">Checking sign-in…</p>;

  if (auth.email) {
    return (
      <div className="account">
        <p>Signed in as <strong>{auth.email}</strong></p>
        <button type="button" className="secondary" disabled={busy || disabled} onClick={() => void run(auth.signOut)}>
          Sign out
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="field stack">
        <span>Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field stack">
        <span>Password</span>
        <input
          type="password" autoComplete="current-password" required minLength={6} value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="actions">
        <button type="submit" className="record" disabled={busy}>Sign in</button>
        <button type="button" className="secondary" disabled={busy || !email || password.length < 6} onClick={() => void run(() => auth.signUp(email, password))}>
          Create account
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
