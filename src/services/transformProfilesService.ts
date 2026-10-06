import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";
import type { TransformProfile } from "@/transforms/transformProfile";

const COLUMNS = "id, name, instruction, created_at, updated_at";

export interface TransformProfilesApi {
  list(userId: string): Promise<TransformProfile[]>;
  create(userId: string, name: string, instruction: string): Promise<TransformProfile>;
  update(id: string, name: string, instruction: string): Promise<TransformProfile>;
  delete(id: string): Promise<void>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Transform sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (!error) return;
  if (error.code === "23505") throw new Error("A transform with that name already exists.");
  if (error.code === "23514") throw new Error("That transform is too long or contains an invalid value.");
  if (error.code === "42501" || error.code === "PGRST301") throw new Error("Sign in again to sync transforms.");
  throw new Error(error.code ? `Transform sync failed (${error.code}).` : "Couldn't reach transform sync.");
}

function fromRow(row: Database["public"]["Tables"]["transform_profiles"]["Row"]): TransformProfile {
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    builtIn: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const transformProfilesApi: TransformProfilesApi = {
  async list(userId) {
    const { data, error } = await requireClient()
      .from("transform_profiles")
      .select(COLUMNS)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    check(error);
    return (data ?? []).map(fromRow);
  },

  async create(userId, name, instruction) {
    const { data, error } = await requireClient()
      .from("transform_profiles")
      .insert({ user_id: userId, name, instruction })
      .select(COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The transform service did not return the saved profile.");
    return fromRow(data);
  },

  async update(id, name, instruction) {
    const { data, error } = await requireClient()
      .from("transform_profiles")
      .update({ name, instruction })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The transform service did not return the updated profile.");
    return fromRow(data);
  },

  async delete(id) {
    const { error } = await requireClient().from("transform_profiles").delete().eq("id", id);
    check(error);
  },
};
