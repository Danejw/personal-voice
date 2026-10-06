import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/services/supabase";
import { syncErrorMessage } from "@/services/personalSyncService";
import { transformProfileFromRow } from "@/transforms/transformProfile";
import type { TransformProfile } from "@/transforms/transformProfile";
import type { Database } from "@/types/database";

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
  if (error) throw new Error(syncErrorMessage(error));
}

export const transformProfilesApi: TransformProfilesApi = {
  async list(userId) {
    const { data, error } = await requireClient()
      .from("transform_profiles")
      .select(COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    check(error);
    return (data ?? []).map(transformProfileFromRow);
  },

  async create(userId, name, instruction) {
    const { data, error } = await requireClient()
      .from("transform_profiles")
      .insert({ user_id: userId, name, instruction })
      .select(COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The transform service did not return the saved profile.");
    return transformProfileFromRow(data);
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
    return transformProfileFromRow(data);
  },

  async delete(id) {
    const { error } = await requireClient().from("transform_profiles").delete().eq("id", id);
    check(error);
  },
};
