import type { OwnedDevice } from "@/handoffs/handoff";

export type NearbyKind = "computer" | "display" | "speaker" | "media" | "unknown";
export type NearbySource = "device-link" | "mdns" | "ssdp" | "bluetooth";

export interface NearbyDevice {
  id: string;
  name: string;
  kind: NearbyKind;
  source: NearbySource;
  detail: string;
  pairedDeviceId?: string;
}

export interface NearbyScan {
  devices: NearbyDevice[];
  bluetoothPermissionRequired: boolean;
}

export interface SpatialPosition { x: number; y: number }

/** Positions are user-marked positions on a sketch, never inferred coordinates or measured distance. */
export type SpatialPositions = Record<string, SpatialPosition>;

const kinds = new Set<NearbyKind>(["computer", "display", "speaker", "media", "unknown"]);
const sources = new Set<NearbySource>(["mdns", "ssdp", "bluetooth"]);
const stableId = /^[a-z0-9-]{6,90}$/;

export function parseNearbyScan(value: unknown): NearbyScan {
  if (!value || typeof value !== "object") throw new Error("Invalid nearby device scan.");
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.devices)) throw new Error("Invalid nearby device scan.");
  const devices: NearbyDevice[] = [];
  const seen = new Set<string>();
  for (const raw of result.devices.slice(0, 80)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string" || !stableId.test(row.id) ||
      typeof row.name !== "string" || !row.name.trim() || row.name.length > 90 ||
      typeof row.kind !== "string" || !kinds.has(row.kind as NearbyKind) ||
      typeof row.source !== "string" || !sources.has(row.source as NearbySource) ||
      typeof row.detail !== "string" || row.detail.length > 120 || seen.has(row.id)) continue;
    seen.add(row.id);
    devices.push({
      id: row.id, name: row.name.trim(), kind: row.kind as NearbyKind,
      source: row.source as NearbySource, detail: row.detail.trim(),
    });
  }
  return { devices, bluetoothPermissionRequired: result.bluetoothPermissionRequired === true };
}

/** Only locally observed Personal Voice peers are called nearby, never all cloud-synced installs. */
export function mergePersonalVoicePeers(
  found: NearbyDevice[], peers: readonly string[], devices: readonly OwnedDevice[],
  currentDeviceId: string,
): NearbyDevice[] {
  const merged = new Map<string, NearbyDevice>(found.map(device => [device.id, device] as const));
  for (const id of peers) {
    if (id === currentDeviceId) continue;
    const device = devices.find(item => item.id === id && item.platform === "windows");
    if (!device) continue;
    merged.set("pv-" + id, {
      id: "pv-" + id, name: device.name, kind: "computer",
      source: "device-link", detail: "Paired Windows PC on local network", pairedDeviceId: id,
    });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function clampPosition(x: number, y: number): SpatialPosition {
  return { x: Math.max(0.08, Math.min(0.92, x)), y: Math.max(0.1, Math.min(0.88, y)) };
}

export function readPositions(raw: string | null): SpatialPositions {
  if (!raw || raw.length > 20_000) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const valid: SpatialPositions = {};
    for (const [id, value] of Object.entries(parsed).slice(0, 80)) {
      if (!stableId.test(id) || !value || typeof value !== "object") continue;
      const position = value as Record<string, unknown>;
      if (typeof position.x !== "number" || !Number.isFinite(position.x) ||
        typeof position.y !== "number" || !Number.isFinite(position.y)) continue;
      valid[id] = clampPosition(position.x, position.y);
    }
    return valid;
  } catch {
    return {};
  }
}
