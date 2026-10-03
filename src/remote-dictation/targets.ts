import { REMOTE_DICTATION_ONLINE_MS } from "@/remote-dictation/constants";

/** Minimal device shape for Remote Dictation target selection. */
export interface RemoteDictationDevice {
  id: string;
  name: string;
  platform: string;
  lastSeen: string | null;
}

export function isRemoteDictationOnline(lastSeen: string | null, nowMs: number): boolean {
  if (!lastSeen) return false;
  const seen = Date.parse(lastSeen);
  return Number.isFinite(seen) && nowMs - seen <= REMOTE_DICTATION_ONLINE_MS;
}

/**
 * Other online devices on this account, sorted deterministically so tap-cycling
 * does not reshuffle between refreshes.
 */
export function eligibleRemoteTargets(
  devices: readonly RemoteDictationDevice[],
  currentDeviceId: string,
  nowMs: number,
): RemoteDictationDevice[] {
  return devices
    .filter((device) => device.id !== currentDeviceId && isRemoteDictationOnline(device.lastSeen, nowMs))
    .slice()
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (byName !== 0) return byName;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Picks the saved target when still eligible, otherwise the first eligible device.
 * Returns null when nothing is online.
 */
export function resolveRemoteTarget(
  devices: readonly RemoteDictationDevice[],
  currentDeviceId: string,
  savedTargetId: string | null,
  nowMs: number,
): RemoteDictationDevice | null {
  const eligible = eligibleRemoteTargets(devices, currentDeviceId, nowMs);
  if (eligible.length === 0) return null;
  if (savedTargetId) {
    const saved = eligible.find((device) => device.id === savedTargetId);
    if (saved) return saved;
  }
  return eligible[0] ?? null;
}

/** Advances to the next eligible device after the current selection. */
export function cycleRemoteTarget(
  devices: readonly RemoteDictationDevice[],
  currentDeviceId: string,
  selectedId: string | null,
  nowMs: number,
): { target: RemoteDictationDevice | null; onlyOne: boolean } {
  const eligible = eligibleRemoteTargets(devices, currentDeviceId, nowMs);
  if (eligible.length === 0) return { target: null, onlyOne: false };
  if (eligible.length === 1) return { target: eligible[0] ?? null, onlyOne: true };
  const index = selectedId ? eligible.findIndex((device) => device.id === selectedId) : -1;
  const next = eligible[(index + 1) % eligible.length] ?? null;
  return { target: next, onlyOne: false };
}
