import type { OwnedDevice } from "@/handoffs/handoff";

export type NearbyKind = "computer" | "display" | "speaker" | "media" | "phone" | "printer" | "server" | "unknown";
export type NearbySource = "device-link" | "mdns" | "ssdp" | "lan" | "bluetooth" | "bluetooth-classic" | "bluetooth-paired";

export interface NearbyDevice {
  id: string;
  name: string;
  kind: NearbyKind;
  source: NearbySource;
  detail: string;
  pairedDeviceId?: string;
  ipAddress?: string;
  signalDbm?: number;
  paired?: boolean;
  /** True only for a service/radio actually observed during this scan; a stored bond is not live evidence. */
  observedNow?: boolean;
}

export interface NearbyScan {
  devices: NearbyDevice[];
  bluetoothPermissionRequired: boolean;
  networkLabel: string;
  networkLimited: boolean;
}

export interface SpatialPosition { x: number; y: number }

/** Positions are user-marked positions on a sketch, never inferred coordinates or measured distance. */
export type SpatialPositions = Record<string, SpatialPosition>;

const kinds = new Set<NearbyKind>(["computer", "display", "speaker", "media", "phone", "printer", "server", "unknown"]);
const sources = new Set<NearbySource>(["mdns", "ssdp", "lan", "bluetooth", "bluetooth-classic", "bluetooth-paired"]);
const isPrivateIpv4 = (value: string): boolean => {
  const a = value.split(".").map(Number);
  return a.length === 4 && a.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (a[0] === 10 || (a[0] === 172 && a[1]! >= 16 && a[1]! <= 31) || (a[0] === 192 && a[1] === 168));
};
const stableId = /^[a-z0-9-]{6,90}$/;

export function parseNearbyScan(value: unknown): NearbyScan {
  if (!value || typeof value !== "object") throw new Error("Invalid nearby device scan.");
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.devices)) throw new Error("Invalid nearby device scan.");
  const devices: NearbyDevice[] = [];
  const seen = new Set<string>();
  for (const raw of result.devices.slice(0, 350)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string" || !stableId.test(row.id) ||
      typeof row.name !== "string" || !row.name.trim() || row.name.length > 90 ||
      typeof row.kind !== "string" || !kinds.has(row.kind as NearbyKind) ||
      typeof row.source !== "string" || !sources.has(row.source as NearbySource) ||
      typeof row.detail !== "string" || row.detail.length > 120 || seen.has(row.id)) continue;
    seen.add(row.id);
    const device: NearbyDevice = {
      id: row.id, name: row.name.trim(), kind: row.kind as NearbyKind,
      source: row.source as NearbySource, detail: row.detail.trim(),
    };
    if (typeof row.ipAddress === "string" && isPrivateIpv4(row.ipAddress)) {
      device.ipAddress = row.ipAddress;
    }
    if (typeof row.signalDbm === "number" && Number.isInteger(row.signalDbm) &&
      row.signalDbm >= -127 && row.signalDbm <= 20) device.signalDbm = row.signalDbm;
    if (row.paired === true) device.paired = true;
    if (typeof row.observedNow === "boolean") device.observedNow = row.observedNow;
    devices.push(device);
  }
  return {
    devices,
    bluetoothPermissionRequired: result.bluetoothPermissionRequired === true,
    networkLabel: typeof result.networkLabel === "string" ? result.networkLabel.slice(0, 100) : "",
    networkLimited: result.networkLimited === true,
  };
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

/** A Bluetooth radio advertisement is not a network host or an authorized control channel. */
export function isBluetoothSource(source: NearbySource): boolean {
  return source === "bluetooth" || source === "bluetooth-classic" || source === "bluetooth-paired";
}

export function nearbyGroup(source: NearbySource): "network" | "bluetooth" {
  return isBluetoothSource(source) ? "bluetooth" : "network";
}

/** A bonded Android radio can exist in the OS without answering this scan. */
export function observedThisScan(device: NearbyDevice): boolean {
  if (device.pairedDeviceId) return true;
  if (device.observedNow !== undefined) return device.observedNow;
  return device.source !== "bluetooth-paired";
}
