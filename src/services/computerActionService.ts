import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ComputerActionApi, ComputerActionRow } from "@/assistant/computerRemote";
import type { RemoteComputerAction } from "@/assistant/computerActions";
import {
  pairedPublicKey, REMOTE_VOICE_EXPIRY_MS, REMOTE_VOICE_VERSION,
  signRemoteRequest, signRemoteResponse, verifyRemoteRequest, verifyRemoteResponse,
} from "@/assistant/remoteVoiceProof";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

const COLUMNS = "id, user_id, requester_device_id, target_device_id, action, argument, status, result, error, version, expires_at, request_signature, response_signature";
const current = () => new Date().toISOString();

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Device sync is not configured for this build.");
  return client;
}
function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}
function rowFrom(record: {
  id: string; user_id: string; requester_device_id: string; target_device_id: string;
  action: string; argument: string; status: string; result: string | null;
  error: string | null; version: number; expires_at: string;
  request_signature: string | null; response_signature: string | null;
}): ComputerActionRow {
  const status = record.status === "answered" || record.status === "denied" ? record.status : "pending";
  return {
    id: record.id, userId: record.user_id,
    requesterDeviceId: record.requester_device_id, targetDeviceId: record.target_device_id,
    action: record.action, argument: record.argument,
    status, result: record.result, error: record.error,
    version: record.version, expiresAt: record.expires_at,
    requestSignature: record.request_signature, responseSignature: record.response_signature,
  };
}
async function signedReply(
  userId: string, id: string, status: "answered" | "denied", message: string,
): Promise<void> {
  const client = requireClient();
  const { data, error } = await client.from("device_action_requests")
    .select(COLUMNS).eq("id", id).eq("user_id", userId).eq("status", "pending").maybeSingle();
  check(error);
  if (!data) throw new Error("That remote action has expired or was cancelled.");
  const row = rowFrom(data);
  if (!await verifyRemoteRequest("action", row, row.action, row.argument)) {
    throw new Error("Remote action request signature or pairing is invalid.");
  }
  const signature = await signRemoteResponse("action", row, status, message);
  const { data: written, error: writeError } = await client.from("device_action_requests")
    .update({
      status, result: status === "answered" ? message : null,
      error: status === "denied" ? message : null,
      response_signature: signature, answered_at: current(),
    })
    .eq("id", id).eq("user_id", userId).eq("status", "pending")
    .gt("expires_at", current()).select("id").maybeSingle();
  check(writeError);
  if (!written) throw new Error("Remote action expired or was already completed.");
}

/** Existing v1 request rows are ignored. Only signed, valid and still-paired
 * v2 requests can reach the unchanged Windows approval/execution pipeline. */
export const computerActionApi: ComputerActionApi & { touch(deviceId: string): Promise<void> } = {
  async touch(deviceId) {
    const { error } = await requireClient().from("devices").update({ last_seen: current() }).eq("id", deviceId);
    check(error);
  },

  async create(userId, requesterDeviceId, targetDeviceId, action: RemoteComputerAction, argument) {
    await pairedPublicKey(requesterDeviceId, targetDeviceId);
    const id = crypto.randomUUID();
    const cleanArgument = argument.trim();
    const requestSignature = await signRemoteRequest(
      "action", id, requesterDeviceId, targetDeviceId, action, cleanArgument,
    );
    const { data, error } = await requireClient()
      .from("device_action_requests")
      .insert({
        id, user_id: userId, requester_device_id: requesterDeviceId,
        target_device_id: targetDeviceId, action, argument: cleanArgument,
        version: REMOTE_VOICE_VERSION,
        request_signature: requestSignature,
        expires_at: new Date(Date.now() + REMOTE_VOICE_EXPIRY_MS).toISOString(),
      }).select("id").single();
    check(error);
    if (!data) throw new Error("The action could not be sent.");
    void deviceLinkManager.sendWake(targetDeviceId, "computer-action", id);
    return id;
  },

  async get(userId, id) {
    const { data, error } = await requireClient()
      .from("device_action_requests").select(COLUMNS)
      .eq("user_id", userId).eq("id", id).maybeSingle();
    check(error);
    if (!data) return null;
    const row = rowFrom(data);
    if (row.status === "pending" && Date.parse(row.expiresAt) <= Date.now()) {
      throw new Error("Remote action request expired.");
    }
    if (row.status !== "pending" && !await verifyRemoteResponse(
      "action", { ...row, resultText: row.status === "answered" ? row.result : row.error },
    )) {
      throw new Error("Remote action result could not be authenticated.");
    }
    return row;
  },

  async listPending(userId, targetDeviceId) {
    const { data, error } = await requireClient()
      .from("device_action_requests").select(COLUMNS)
      .eq("user_id", userId).eq("target_device_id", targetDeviceId)
      .eq("status", "pending").gt("expires_at", current()).order("created_at", { ascending: true });
    check(error);
    const rows = (data ?? []).map(rowFrom);
    const verified = await Promise.all(rows.map(async row =>
      await verifyRemoteRequest("action", row, row.action, row.argument) ? row : null,
    ));
    return verified.filter((row): row is ComputerActionRow => row !== null);
  },

  answer: (userId, id, result) => signedReply(userId, id, "answered", result),
  deny: (userId, id, message) => signedReply(userId, id, "denied", message),

  async remove(userId, id) {
    const { error } = await requireClient().from("device_action_requests")
      .delete().eq("user_id", userId).eq("id", id);
    check(error);
  },
};
