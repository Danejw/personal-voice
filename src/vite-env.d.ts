/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Client-safe Supabase project URL. */
  readonly VITE_SUPABASE_URL?: string;
  /** Client-safe publishable (or legacy anon) key. Never the secret/service-role key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
