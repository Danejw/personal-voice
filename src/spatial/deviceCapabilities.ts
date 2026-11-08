import type { NearbyDevice } from "@/spatial/spatialDevices";
import { isBluetoothSource } from "@/spatial/spatialDevices";

export type Capability = "open_web" | "volume" | "playback" | "samsung_remote" | "lg_remote";

export interface DeviceIdentity {
  ipAddress: string;
  name: string;
  manufacturer: string;
  model: string;
  features: Capability[];
  samsungFingerprint?: string;
  samsungPaired: boolean;
  lgFingerprint?: string;
  lgPaired: boolean;
}

const supported = new Set<Capability>(["open_web", "volume", "playback", "samsung_remote", "lg_remote"]);
const privateIp = (ip: string): boolean => {
  const a = ip.split(".").map(Number);
  return a.length === 4 && a.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (a[0] === 10 || (a[0] === 172 && a[1]! >= 16 && a[1]! <= 31) ||
      (a[0] === 192 && a[1] === 168));
};

/** Only IPs from scanned local-network evidence may be passed to native inspection. */
export function parseDeviceIdentity(value: unknown, expectedIp: string): DeviceIdentity {
  if (!privateIp(expectedIp) || !value || typeof value !== "object") {
    throw new Error("Invalid device identification.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.ipAddress !== expectedIp || typeof raw.name !== "string" ||
    typeof raw.manufacturer !== "string" || typeof raw.model !== "string" ||
    !Array.isArray(raw.features)) throw new Error("Device identity did not match the scan.");
  const lgFingerprint = typeof raw.lgFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(raw.lgFingerprint) ? raw.lgFingerprint : undefined;
  const fingerprint = typeof raw.samsungFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(raw.samsungFingerprint) ? raw.samsungFingerprint : undefined;
  const features = [...new Set(raw.features.filter(
    (v): v is Capability => typeof v === "string" && supported.has(v as Capability),
  ))];
  return {
    ipAddress: expectedIp,
    name: raw.name.trim().slice(0, 72),
    manufacturer: raw.manufacturer.trim().slice(0, 64),
    model: raw.model.trim().slice(0, 64),
    features: features.filter(feature => (feature !== "samsung_remote" || !!fingerprint) &&
      (feature !== "lg_remote" || !!lgFingerprint)),
    ...(fingerprint ? { samsungFingerprint: fingerprint } : {}),
    samsungPaired: raw.samsungPaired === true && !!fingerprint,
    ...(lgFingerprint ? { lgFingerprint } : {}),
    lgPaired: raw.lgPaired === true && !!lgFingerprint,
  };
}

function isAutoName(name: string): boolean {
  return /^Device \d+\.\d+\.\d+\.\d+$/.test(name) ||
    /^SHP, UPnP\//i.test(name) || /^UPnP media renderer$/i.test(name);
}

/**
 * Group only when the network packets directly establish the same IP address.
 * Never group by an advertised name, which can collide or be forged, and never
 * infer Personal Voice trust from a network or Bluetooth advertisement.
 */
export function consolidateNearbyDevices(devices: readonly NearbyDevice[]): NearbyDevice[] {
  const groups = new Map<string, NearbyDevice[]>();
  for (const device of devices) {
    const key = device.ipAddress && !isBluetoothSource(device.source) && privateIp(device.ipAddress)
      ? "ip:" + device.ipAddress : "id:" + device.id;
    const members = groups.get(key) ?? [];
    members.push(device);
    groups.set(key, members);
  }
  return [...groups.values()].map(members => {
    const base = members.find(d => d.source === "lan") ?? members[0]!;
    if (members.length === 1) return base;
    const meaningful = members.find(d => !isAutoName(d.name));
    const hintedSamsung = members.some(d => /Samsung/i.test(d.name));
    const name = meaningful?.name ?? (hintedSamsung
      ? "Samsung-advertised device" : base.name);
    const mediaKind = members.find(d => d.source === "ssdp" && d.kind !== "unknown");
    const kind = base.kind === "unknown" ? (mediaKind?.kind ?? base.kind) : base.kind;
    const detail = [...new Set(members.map(d => d.detail).filter(Boolean))].join(" · ").slice(0, 120);
    return { ...base, name, kind, detail };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
