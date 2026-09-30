import { useState } from "react";
import { AuthForm } from "@/auth/AuthForm";
import type { AuthState } from "@/auth/useAuth";

interface AuthPanelProps {
  auth: AuthState;
  /** Sign-out is blocked while an utterance is in flight. */
  disabled: boolean;
}

/** Account section. Sign-out stays here; signing in happens on the full-window gate. */
export function AuthPanel({ auth, disabled }: AuthPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await auth.signOut();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!auth.configured) return <p className="error">Sign-in is not configured for this build.</p>;
  if (!auth.ready) return <p className="placeholder">Checking sign-in…</p>;

  if (auth.email) {
    return (
      <div className="account">
        <p>Signed in as <strong>{auth.email}</strong></p>
        <button type="button" className="secondary" disabled={busy || disabled} onClick={() => void signOut()}>
          Sign out
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }

  return <AuthForm auth={auth} />;
}
