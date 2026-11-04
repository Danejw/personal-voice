import { resolveRemoteDevice, type RemoteDevice } from "@/assistant/remoteContext";
import { pairedPublicKey } from "@/assistant/remoteVoiceProof";

const PREFIX = "personal-voice.remote-voice.default.v1.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The default is local to the requesting device, never a global account option. */
export function loadRemoteVoiceDefault(currentDeviceId: string): string | null {
  try {
    const raw = localStorage.getItem(PREFIX + currentDeviceId);
    return raw && UUID.test(raw) && raw !== currentDeviceId ? raw : null;
  } catch { return null; }
}

export function saveRemoteVoiceDefault(currentDeviceId: string, targetDeviceId: string | null): void {
  if (!UUID.test(currentDeviceId) || (targetDeviceId && (!UUID.test(targetDeviceId) || currentDeviceId === targetDeviceId))) {
    throw new Error("Select an actual paired device.");
  }
  try {
    if (targetDeviceId) localStorage.setItem(PREFIX + currentDeviceId, targetDeviceId);
    else localStorage.removeItem(PREFIX + currentDeviceId);
  } catch { throw new Error("Could not save the remote voice default on this device."); }
}

export function selectRemoteVoiceTarget(
  devices: readonly RemoteDevice[],
  currentDeviceId: string,
  requested: string | null,
  remembered: string | null,
  now = Date.now(),
): { ok: true; device: RemoteDevice } | { ok: false; message: string } {
  const text = requested?.trim() || null;
  const target = text ?? remembered;
  // An explicit name or ID never falls back to the default or a different PC.
  if (target && UUID.test(target)) {
    const found = devices.find(d => d.id === target && d.id !== currentDeviceId);
    if (!found) return { ok: false, message: "That selected computer is no longer available." };
    return resolveRemoteDevice([found], currentDeviceId, found.name, now);
  }
  return resolveRemoteDevice(devices, currentDeviceId, target, now);
}

/** Never submit an account device request before validating the exact peer's
 * cryptographically approved pairing, even when it is a remembered default. */
export async function resolvePairedVoiceTarget(
  devices: readonly RemoteDevice[], currentDeviceId: string,
  requested: string | null, now = Date.now(),
): Promise<RemoteDevice> {
  const selection = selectRemoteVoiceTarget(
    devices, currentDeviceId, requested, loadRemoteVoiceDefault(currentDeviceId), now,
  );
  if (!selection.ok) throw new Error(selection.message);
  if (selection.device.platform !== "windows") {
    throw new Error("Remote voice actions require a paired Windows computer.");
  }
  await pairedPublicKey(currentDeviceId, selection.device.id);
  return selection.device;
}
