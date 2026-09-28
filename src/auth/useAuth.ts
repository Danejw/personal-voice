import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/services/supabase";

export interface AuthState {
  /** False when the build has no Supabase configuration. */
  configured: boolean;
  /** True once the stored session (if any) has been read. */
  ready: boolean;
  email: string | null;
  userId: string | null;
  signIn(email: string, password: string): Promise<void>;
  /** Resolves with a notice to show, e.g. when email confirmation is required. */
  signUp(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
}

/** Supabase email/password session for the Settings window. Errors are thrown as user-facing messages. */
export function useAuth(): AuthState {
  const client = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!client);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!client) throw new Error("Sign-in is not configured for this build.");
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
  }, [client]);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!client) throw new Error("Sign-in is not configured for this build.");
    const { data, error } = await client.auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(error.message);
    return data.session ? null : "Check your email to confirm the account, then sign in.";
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw new Error(error.message);
  }, [client]);

  return {
    configured: !!client, ready, email: session?.user.email ?? null, userId: session?.user.id ?? null, signIn, signUp, signOut,
  };
}
