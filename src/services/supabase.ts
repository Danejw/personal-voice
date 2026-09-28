import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

/** `null` when the build has no Supabase configuration. */
export const supabaseConfig: SupabaseConfig | null = url && publishableKey ? { url, publishableKey } : null;

let client: SupabaseClient<Database> | null | undefined;

/**
 * Created on first use, so only the window that signs in (Settings) runs session refresh.
 * Two clients refreshing one stored session would race on refresh-token rotation.
 */
export function getSupabase(): SupabaseClient<Database> | null {
  if (client === undefined) {
    client = supabaseConfig
      ? createClient<Database>(supabaseConfig.url, supabaseConfig.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
      : null;
  }
  return client;
}
