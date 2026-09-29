import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { RemoteContextApi, RemoteRequestRow } from "@/assistant/remoteContextChannel";
import type { RemoteKind } from "@/assistant/remoteContext";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

const COLUMNS = "id, user_id, requester_device_id, target_device_id, kind, status, response, error";

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
  kind: string;
  status: string;
  response: string | null;
  error: string | null;
}): RemoteRequestRow {
  const status = record.status === "answered" || record.status === "denied" ? record.status : "pending";
  return {
    id: record.id,
    userId: record.user_id,
    requesterDeviceId: record.requester_device_id,
    targetDeviceId: record.target_device_id,
    kind: record.kind,
    status,
    response: record.response,
    error: record.error,
  };
}

/** Account-scoped read requests. Rows are removed after the requester finishes with them. */
export const remoteContextApi: RemoteContextApi & {
  touch(deviceId: string): Promise<void>;
} = {
  async touch(deviceId) {
    const { error } = await requireClient()
      .from("devices")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", deviceId);
    check(error);
  },

  async create(userId, requesterDeviceId, targetDeviceId, kind: RemoteKind) {
    const { data, error } = await requireClient()
      .from("device_context_requests")
      .insert({
        user_id: userId,
        requester_device_id: requesterDeviceId,
        target_device_id: targetDeviceId,
        kind,
        version: 1,
      })
      .select("id")
      .single();
    check(error);
    if (!data) throw new Error("The read could not be sent.");
    return data.id;
  },

  async get(userId, id) {
    const { data, error } = await requireClient()
      .from("device_context_requests")
      .select(COLUMNS)
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    check(error);
    return data ? rowFrom(data) : null;
  },

  async listPending(userId, targetDeviceId) {
    const { data, error } = await requireClient()
      .from("device_context_requests")
      .select(COLUMNS)
      .eq("user_id", userId)
      .eq("target_device_id", targetDeviceId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    check(error);
    return (data ?? []).map(rowFrom);
  },

  async answer(userId, id, response) {
    const { error } = await requireClient()
      .from("device_context_requests")
      .update({ status: "answered", response, answered_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("status", "pending");
    check(error);
  },

  async deny(userId, id, message) {
    const { error } = await requireClient()
      .from("device_context_requests")
      .update({ status: "denied", error: message, answered_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("status", "pending");
    check(error);
  },

  async remove(userId, id) {
    const { error } = await requireClient()
      .from("device_context_requests")
      .delete()
      .eq("user_id", userId)
      .eq("id", id);
    check(error);
  },
};
