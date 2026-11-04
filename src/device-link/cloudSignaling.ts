import { getSupabase } from "@/services/supabase";
import { pairServerAction } from "@/services/devicePairingService";
import { DEVICE_LINK_RELIABLE_TTL_MS } from "@/device-link/protocol";

export type DeviceLinkWakeFamily = "remote-dictation" | "computer-action" | "remote-read";
export interface DeviceLinkWake {
  id: string;
  family: DeviceLinkWakeFamily;
  senderDeviceId: string;
  targetDeviceId: string;
  requestId: string;
}

/** Best-effort, authenticated cloud wake-up. No transcript or action argument is sent. */
export async function signalPairedDevice(
  fromDeviceId: string,
  targetDeviceId: string,
  family: DeviceLinkWakeFamily,
  requestId: string,
): Promise<boolean> {
  try {
    return await pairServerAction<boolean>(fromDeviceId, "signal", {
      targetId: targetDeviceId, requestId, family,
    });
  } catch {
    // Reliable rows are still picked up through existing Postgres Changes / catch-up.
    return false;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const families = new Set<DeviceLinkWakeFamily>(["remote-dictation","computer-action","remote-read"]);
type RecordValue = Record<string, unknown>;

/** Treat Realtime messages as untrusted hints until the target fetches the request row. */
export function parseDeviceLinkWake(
  value: unknown, userId: string, targetDeviceId: string, now = Date.now(),
): DeviceLinkWake | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as RecordValue;
  if (item.user_id !== userId || item.target_device_id !== targetDeviceId
    || typeof item.id !== "string" || !uuid.test(item.id)
    || typeof item.sender_device_id !== "string" || !uuid.test(item.sender_device_id)
    || item.sender_device_id === targetDeviceId
    || typeof item.request_id !== "string" || !uuid.test(item.request_id)
    || !families.has(item.family as DeviceLinkWakeFamily)
    || typeof item.created_at !== "string" || typeof item.expires_at !== "string") {
    return null;
  }
  const created = Date.parse(item.created_at);
  const expires = Date.parse(item.expires_at);
  if (!Number.isFinite(created) || !Number.isFinite(expires)
    || created > now + 30_000 || expires <= now
    || expires - created > DEVICE_LINK_RELIABLE_TTL_MS + 1_000) return null;
  return {
    id: item.id, senderDeviceId: item.sender_device_id,
    targetDeviceId, requestId: item.request_id,
    family: item.family as DeviceLinkWakeFamily,
  };
}

/** Private Postgres Changes channel backed by the table's owner-only RLS.
 * Channel names themselves do not authorize anything.
 */
export function subscribeDeviceLinkWakes(
  userId: string, targetDeviceId: string,
  onWake: (wake: DeviceLinkWake) => void,
  onConnected?: (active: boolean) => void,
): () => void {
  const client = getSupabase();
  if (!client) return () => undefined;
  const channel = client.channel(`device-link-wake:${targetDeviceId}`)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "device_link_signals",
      filter: `target_device_id=eq.${targetDeviceId}`,
    }, (payload) => {
      const wake = parseDeviceLinkWake(payload.new, userId, targetDeviceId);
      if (wake) onWake(wake);
    }).subscribe(status => onConnected?.(status === "SUBSCRIBED"));
  return () => { void client.removeChannel(channel); };
}
