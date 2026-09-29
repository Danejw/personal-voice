import type { ComputerActionApi, ComputerActionRow } from "@/assistant/computerRemote";
import type { RemoteComputerAction } from "@/assistant/computerActions";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const COLUMNS = "id, user_id, requester_device_id, target_device_id, action, argument, status, result, error";

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Device sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

function rowFrom(record: {
  id: string;
  user_id: string;
  requester_device_id: string;
  target_device_id: string;
  action: string;
  argument: string;
  status: string;
  result: string | null;
  error: string | null;
}): ComputerActionRow {
  const status = record.status === "answered" || record.status === "denied" ? record.status : "pending";
  return {
    id: record.id,
    userId: record.user_id,
    requesterDeviceId: record.requester_device_id,
    targetDeviceId: record.target_device_id,
    action: record.action,
    argument: record.argument,
    status,
    result: record.result,
    error: record.error,
  };
}

/** Allowlisted actions aimed at another owned device. Rows are removed after the requester finishes. */
export const computerActionApi: ComputerActionApi & { touch(deviceId: string): Promise<void> } = {
  async touch(deviceId) {
    const { error } = await requireClient().from("devices").update({ last_seen: new Date().toISOString() }).eq("id", deviceId);
    check(error);
  },

  async create(userId, requesterDeviceId, targetDeviceId, action: RemoteComputerAction, argument) {
    const { data, error } = await requireClient()
      .from("device_action_requests")
      .insert({
        user_id: userId,
        requester_device_id: requesterDeviceId,
        target_device_id: targetDeviceId,
        action,
        argument: argument.trim(),
        version: 1,
      })
      .select("id")
      .single();
    check(error);
    if (!data) throw new Error("The action could not be sent.");
    return data.id;
  },

  async get(userId, id) {
    const { data, error } = await requireClient()
      .from("device_action_requests")
      .select(COLUMNS)
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    check(error);
    return data ? rowFrom(data) : null;
  },

  async listPending(userId, targetDeviceId) {
    const { data, error } = await requireClient()
      .from("device_action_requests")
      .select(COLUMNS)
      .eq("user_id", userId)
      .eq("target_device_id", targetDeviceId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    check(error);
    return (data ?? []).map(rowFrom);
  },

  async answer(userId, id, result) {
    const { error } = await requireClient()
      .from("device_action_requests")
      .update({ status: "answered", result, answered_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id);
    check(error);
  },

  async deny(userId, id, message) {
    const { error } = await requireClient()
      .from("device_action_requests")
      .update({ status: "denied", error: message, answered_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id);
    check(error);
  },

  async remove(userId, id) {
    const { error } = await requireClient().from("device_action_requests").delete().eq("user_id", userId).eq("id", id);
    check(error);
  },
};
