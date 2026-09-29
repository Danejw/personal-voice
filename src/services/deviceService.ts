import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { ownedDeviceFromRow } from "@/handoffs/handoff";
import type { OwnedDevice } from "@/handoffs/handoff";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

const DEVICE_COLUMNS = "id, name, platform, last_seen";

export const MAX_DEVICE_NAME = 100;

export interface DeviceApi {
  list(userId: string): Promise<OwnedDevice[]>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Device sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

/** Account device records. Notes and handoffs keep their source IDs if a row is removed. */
export const deviceApi: DeviceApi = {
  async list(userId) {
    const { data, error } = await requireClient()
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("user_id", userId)
      .order("last_seen", { ascending: false, nullsFirst: false });
    check(error);
    return (data ?? []).map(ownedDeviceFromRow);
  },

  async rename(id, name) {
    const { error } = await requireClient().from("devices").update({ name }).eq("id", id);
    check(error);
  },

  async remove(id) {
    const { error } = await requireClient().from("devices").delete().eq("id", id);
    check(error);
  },
};
