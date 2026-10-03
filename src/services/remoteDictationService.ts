import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  REMOTE_DICTATION_EXPIRE_MS,
  REMOTE_DICTATION_TEXT_LIMIT,
} from "@/remote-dictation/constants";
import {
  parseRemoteDictationList,
  parseRemoteDictationRequest,
  type RemoteDictationRequest,
} from "@/remote-dictation/types";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

export interface RemoteDictationApi {
  touch(deviceId: string): Promise<void>;
  create(sourceDeviceId: string, targetDeviceId: string, text: string): Promise<string>;
  get(id: string): Promise<RemoteDictationRequest | null>;
  listPending(targetDeviceId: string): Promise<RemoteDictationRequest[]>;
  claim(id: string, targetDeviceId: string): Promise<RemoteDictationRequest | null>;
  complete(id: string, targetDeviceId: string, ok: boolean, error?: string | null): Promise<boolean>;
  remove(id: string): Promise<void>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Device sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(remoteDictationErrorMessage(error));
}

/** Maps RPC rejection codes onto short user-facing messages. */
export function remoteDictationErrorMessage(error: { code?: string; message: string }): string {
  const message = error.message || "";
  if (message.includes("REMOTE_DICTATION_SAME_DEVICE")) return "Remote Dictation cannot target this device.";
  if (message.includes("REMOTE_DICTATION_TEXT")) return "The transcript is empty or too long.";
  if (message.includes("REMOTE_DICTATION_SOURCE")) return "This device is not registered on the account.";
  if (message.includes("REMOTE_DICTATION_TARGET")) return "That device is not on this account.";
  if (message.includes("REMOTE_DICTATION_UNAUTHORIZED")) return "Sign in to use Remote Dictation.";
  return syncErrorMessage(error as PostgrestError);
}

function ttlSeconds(): number {
  return Math.round(REMOTE_DICTATION_EXPIRE_MS / 1000);
}

/** Short-lived exact-transcript transport. Ownership and claim atomicity live in RPCs. */
export const remoteDictationApi: RemoteDictationApi = {
  async touch(deviceId) {
    const { error } = await requireClient()
      .from("devices")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", deviceId);
    check(error);
  },

  async create(sourceDeviceId, targetDeviceId, text) {
    const cleaned = text.trim();
    if (!cleaned) throw new Error("The transcript is empty or too long.");
    if (cleaned.length > REMOTE_DICTATION_TEXT_LIMIT) throw new Error("The transcript is empty or too long.");
    if (sourceDeviceId === targetDeviceId) throw new Error("Remote Dictation cannot target this device.");
    const { data, error } = await requireClient().rpc("create_remote_dictation_request", {
      p_source_device_id: sourceDeviceId,
      p_target_device_id: targetDeviceId,
      p_text: cleaned,
      p_ttl_seconds: ttlSeconds(),
    });
    check(error);
    if (typeof data !== "string" || !data) throw new Error("Remote Dictation could not be sent.");
    return data;
  },

  async get(id) {
    const { data, error } = await requireClient().rpc("get_remote_dictation_request", { p_id: id });
    check(error);
    return parseRemoteDictationRequest(data);
  },

  async listPending(targetDeviceId) {
    const { data, error } = await requireClient().rpc("list_pending_remote_dictation_requests", {
      p_target_device_id: targetDeviceId,
    });
    check(error);
    return parseRemoteDictationList(data);
  },

  async claim(id, targetDeviceId) {
    const { data, error } = await requireClient().rpc("claim_remote_dictation_request", {
      p_id: id,
      p_target_device_id: targetDeviceId,
    });
    check(error);
    return parseRemoteDictationRequest(data);
  },

  async complete(id, targetDeviceId, ok, message = null) {
    const { data, error } = await requireClient().rpc("complete_remote_dictation_request", {
      p_id: id,
      p_target_device_id: targetDeviceId,
      p_ok: ok,
      p_error: message,
    });
    check(error);
    return data === true;
  },

  async remove(id) {
    const { error } = await requireClient().rpc("delete_remote_dictation_request", { p_id: id });
    check(error);
  },
};
