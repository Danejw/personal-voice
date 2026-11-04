import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { RemoteContextApi, RemoteRequestRow } from "@/assistant/remoteContextChannel";
import type { RemoteKind } from "@/assistant/remoteContext";
import {
  pairedPublicKey, REMOTE_VOICE_EXPIRY_MS, REMOTE_VOICE_VERSION,
  signRemoteRequest, signRemoteResponse, verifyRemoteRequest, verifyRemoteResponse,
} from "@/assistant/remoteVoiceProof";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

const COLUMNS = "id, user_id, requester_device_id, target_device_id, kind, status, response, error, version, expires_at, request_signature, response_signature";
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
  kind: string; status: string; response: string | null; error: string | null;
  version: number; expires_at: string; request_signature: string | null;
  response_signature: string | null;
}): RemoteRequestRow {
  return {
    id: record.id, userId: record.user_id, requesterDeviceId: record.requester_device_id,
    targetDeviceId: record.target_device_id, kind: record.kind,
    status: record.status === "answered" || record.status === "denied" ? record.status : "pending",
    response: record.response, error: record.error, version: record.version,
    expiresAt: record.expires_at, requestSignature: record.request_signature,
    responseSignature: record.response_signature,
  };
}
async function signedReply(
  userId: string, id: string, status: "answered" | "denied", message: string,
): Promise<void> {
  const client = requireClient();
  const { data, error } = await client.from("device_context_requests")
    .select(COLUMNS).eq("user_id", userId).eq("id", id).eq("status", "pending").maybeSingle();
  check(error);
  if (!data) throw new Error("That remote read is no longer available.");
  const row = rowFrom(data);
  if (!await verifyRemoteRequest("read", row, row.kind)) {
    throw new Error("Remote read request signature or pairing is invalid.");
  }
  const signature = await signRemoteResponse("read", row, status, message);
  const { data: written, error: writeError } = await client.from("device_context_requests")
    .update({
      status,
      response: status === "answered" ? message : null,
      error: status === "denied" ? message : null,
      response_signature: signature,
      answered_at: current(),
    })
    .eq("user_id", userId).eq("id", id).eq("status", "pending")
    .gt("expires_at", current()).select("id").maybeSingle();
  check(writeError);
  if (!written) throw new Error("Remote read expired or was already completed.");
}

/** The existing screenshot approval and Windows read boundaries remain unchanged. */
export const remoteContextApi: RemoteContextApi & { touch(deviceId: string): Promise<void> } = {
  async touch(deviceId) {
    const { error } = await requireClient().from("devices")
      .update({ last_seen: current() }).eq("id", deviceId);
    check(error);
  },

  async create(userId, requesterDeviceId, targetDeviceId, kind: RemoteKind) {
    await pairedPublicKey(requesterDeviceId, targetDeviceId);
    const id = crypto.randomUUID();
    const requestSignature = await signRemoteRequest(
      "read", id, requesterDeviceId, targetDeviceId, kind,
    );
    const { data, error } = await requireClient()
      .from("device_context_requests")
      .insert({
        id, user_id: userId, requester_device_id: requesterDeviceId,
        target_device_id: targetDeviceId, kind,
        version: REMOTE_VOICE_VERSION,
        request_signature: requestSignature,
        expires_at: new Date(Date.now() + REMOTE_VOICE_EXPIRY_MS).toISOString(),
      }).select("id").single();
    check(error);
    if (!data) throw new Error("The read could not be sent.");
    void deviceLinkManager.sendWake(targetDeviceId, "remote-read", id);
    return id;
  },

  async get(userId, id) {
    const { data, error } = await requireClient()
      .from("device_context_requests").select(COLUMNS)
      .eq("user_id", userId).eq("id", id).maybeSingle();
    check(error);
    if (!data) return null;
    const row = rowFrom(data);
    if (row.status === "pending" && Date.parse(row.expiresAt) <= Date.now()) {
      throw new Error("Remote read request expired.");
    }
    if (row.status !== "pending" && !await verifyRemoteResponse(
      "read", { ...row, resultText: row.status === "answered" ? row.response : row.error },
    )) {
      throw new Error("Remote read result could not be authenticated.");
    }
    return row;
  },

  async listPending(userId, targetDeviceId) {
    const { data, error } = await requireClient()
      .from("device_context_requests").select(COLUMNS)
      .eq("user_id", userId).eq("target_device_id", targetDeviceId)
      .eq("status", "pending").gt("expires_at", current()).order("created_at", { ascending: true });
    check(error);
    const rows = (data ?? []).map(rowFrom);
    const verified = await Promise.all(rows.map(async row =>
      await verifyRemoteRequest("read", row, row.kind) ? row : null,
    ));
    return verified.filter((row): row is RemoteRequestRow => row !== null);
  },

  answer: (userId, id, response) => signedReply(userId, id, "answered", response),
  deny: (userId, id, message) => signedReply(userId, id, "denied", message),

  async remove(userId, id) {
    const { error } = await requireClient().from("device_context_requests")
      .delete().eq("user_id", userId).eq("id", id);
    check(error);
  },
};
