import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { handoffFromRow } from "@/handoffs/handoff";
import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import { deviceApi } from "@/services/deviceService";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

const HANDOFF_COLUMNS = "id, text, source_device_id, target_device_id, created_at, consumed_at";

export interface HandoffApi {
  listDevices(userId: string): Promise<OwnedDevice[]>;
  listReceived(userId: string, currentDeviceId: string): Promise<Handoff[]>;
  send(userId: string, text: string, sourceDeviceId: string, targetDeviceId: string | null): Promise<void>;
  consume(id: string): Promise<void>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Handoff sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

/** Supabase is the shared source of truth; there is no direct device connection. */
export const handoffApi: HandoffApi = {
  listDevices: deviceApi.list,

  async listReceived(userId, currentDeviceId) {
    const { data, error } = await requireClient()
      .from("handoffs")
      .select(HANDOFF_COLUMNS)
      .eq("user_id", userId)
      .is("consumed_at", null)
      .neq("source_device_id", currentDeviceId)
      .or(`target_device_id.is.null,target_device_id.eq.${currentDeviceId}`)
      .order("created_at", { ascending: false });
    check(error);
    return (data ?? []).map(handoffFromRow);
  },

  async send(userId, text, sourceDeviceId, targetDeviceId) {
    const { error } = await requireClient().from("handoffs").insert({
      user_id: userId,
      text,
      source_device_id: sourceDeviceId,
      target_device_id: targetDeviceId,
    });
    check(error);
  },

  async consume(id) {
    const { error } = await requireClient()
      .from("handoffs")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", id);
    check(error);
  },
};
