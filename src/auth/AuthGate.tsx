import type { ReactNode } from "react";
import { AuthForm } from "@/auth/AuthForm";
import type { AuthState } from "@/auth/useAuth";
import { BrandMark } from "@/app/BrandMark";

/** Full-window sign-in. Shown until a session exists. */
export function AuthGate({ auth }: { auth: AuthState }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <GateBrand />
        <p className="gate-tagline">Dictate into the app you're already using.</p>
        {!auth.configured ? <p className="error">Sign-in is not configured for this build.</p> : <AuthForm auth={auth} />}
      </div>
    </div>
  );
}

/** Branded hold screen while the session or this device is still being read. */
export function BrandSplash({ label }: { label: string }) {
  return (
    <div className="gate">
      <div className="gate-card gate-splash">
        <GateBrand />
        <p className="placeholder" role="status">{label}</p>
      </div>
    </div>
  );
}

export function GateBrand() {
  return (
    <div className="gate-brand">
      <span className="gate-mark" aria-hidden="true"><BrandMark /></span>
      <h1>Personal Voice</h1>
    </div>
  );
}

/** Shared full-window frame for sign-in and onboarding. */
export function GateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate-card">{children}</div>
    </div>
  );
}
