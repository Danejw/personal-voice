import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";
import type { Snippet } from "@/snippets/snippet";

const COLUMNS = "id, trigger, normalized_trigger, content, enabled, created_at, updated_at";

type SnippetRow = Pick<
  Database["public"]["Tables"]["snippets"]["Row"],
  "id" | "trigger" | "normalized_trigger" | "content" | "enabled" | "created_at" | "updated_at"
>;

export interface SnippetsApi {
  list(userId: string): Promise<Snippet[]>;
  create(userId: string, trigger: string, content: string): Promise<Snippet>;
  update(id: string, trigger: string, content: string): Promise<Snippet>;
  setEnabled(id: string, enabled: boolean): Promise<Snippet>;
  delete(id: string): Promise<void>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Snippet sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (!error) return;
  if (error.code === "23505") throw new Error("A snippet with that voice trigger already exists.");
  if (error.code === "23514") throw new Error("That snippet contains an invalid or oversized value.");
  if (error.code === "42501" || error.code === "PGRST301") throw new Error("Sign in again to sync snippets.");
  throw new Error(error.code ? `Snippet sync failed (${error.code}).` : "Couldn't reach snippet sync.");
}

function fromRow(row: SnippetRow): Snippet {
  return {
    id: row.id,
    trigger: row.trigger,
    normalizedTrigger: row.normalized_trigger,
    content: row.content,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const snippetsApi: SnippetsApi = {
  async list(userId) {
    const { data, error } = await requireClient()
      .from("snippets")
      .select(COLUMNS)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    check(error);
    return (data ?? []).map(fromRow);
  },

  async create(userId, trigger, content) {
    const { data, error } = await requireClient()
      .from("snippets")
      .insert({ user_id: userId, trigger, content })
      .select(COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The snippet service did not return the saved snippet.");
    return fromRow(data);
  },

  async update(id, trigger, content) {
    const { data, error } = await requireClient()
      .from("snippets")
      .update({ trigger, content })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The snippet service did not return the updated snippet.");
    return fromRow(data);
  },

  async setEnabled(id, enabled) {
    const { data, error } = await requireClient()
      .from("snippets")
      .update({ enabled })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The snippet service did not return the updated snippet.");
    return fromRow(data);
  },

  async delete(id) {
    const { error } = await requireClient().from("snippets").delete().eq("id", id);
    check(error);
  },
};
