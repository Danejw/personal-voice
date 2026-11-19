/** UDP/1 watch V0 contract, shared by a virtual and future BLE transport. */
export type WearableSource = "virtual" | "bluetooth";
export type WearableConnection = "disconnected" | "connecting" | "connected" | "error";
export const WATCH_ID = "watch-v0";
export const WATCH_CAPABILITIES = ["button.primary"] as const;
export const WATCH_SERVICE_UUID = "8d39fbe0-3fa8-475f-9e08-f6ca3ff2de10";

export interface WatchManifest {
  protocol: "udp/1";
  device_id: string;
  firmware_version: string;
  capabilities: string[];
}
export interface WatchEvent {
  type: "event";
  protocol: "udp/1";
  device_id: string;
  event: "button.primary.pressed";
  seq: number;
  source: WearableSource;
}
export interface WearableSnapshot {
  status: WearableConnection;
  source: WearableSource | null;
  deviceId: string | null;
  capabilities: readonly string[];
  lastEvent: string | null;
  error: string | null;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid device message");
  return value as Record<string, unknown>;
}
function validCaps(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === 1 && value[0] === "button.primary";
}
/** Reject unknown major version and capabilities that the hardware cannot perform. */
export function parseWatchManifest(value: unknown): WatchManifest {
  const data = object(value);
  if (data.protocol !== "udp/1" || data.device_id !== WATCH_ID ||
      typeof data.firmware_version !== "string" || !validCaps(data.capabilities)) {
    throw new Error("Unsupported watch manifest or capability set");
  }
  return {
    protocol: "udp/1", device_id: WATCH_ID,
    firmware_version: data.firmware_version,
    capabilities: ["button.primary"],
  };
}
/** BLE short characteristic is a transport codec for the same canonical manifest. */
export function parseBleWatchManifest(value: unknown): WatchManifest {
  const data = object(value);
  if (data.v !== 1 || data.id !== WATCH_ID || !validCaps(data.caps)) {
    throw new Error("Unsupported BLE watch version or capability set");
  }
  return parseWatchManifest({
    protocol: "udp/1", device_id: data.id,
    firmware_version: "ble-v0", capabilities: data.caps,
  });
}
export function parseWatchPress(value: unknown, source: WearableSource): WatchEvent {
  const data = object(value);
  if (data.protocol !== "udp/1" || data.type !== "event" ||
      data.device_id !== WATCH_ID || data.event !== "button.primary.pressed" ||
      !Number.isSafeInteger(data.seq) || (data.seq as number) < 0) {
    throw new Error("Unsupported watch event");
  }
  return {
    type: "event", protocol: "udp/1", device_id: WATCH_ID,
    event: "button.primary.pressed", seq: data.seq as number, source,
  };
}
