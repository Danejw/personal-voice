/** DeviceLink v1: one wire contract, independent of LAN and cloud delivery. */
export const DEVICE_LINK_VERSION = 1;
export const DEVICE_LINK_MAX_FRAME_BYTES = 8192;
export const DEVICE_LINK_MAX_CLOCK_SKEW_MS = 30_000;
export const DEVICE_LINK_EPHEMERAL_TTL_MS = 2_000;
export const DEVICE_LINK_RELIABLE_TTL_MS = 30_000;

export type DeviceLinkMessageType = "presence" | "cursor" | "wake" | "ack";
export type DeviceLinkPath = "local" | "remote";
export type DeviceLinkState = "offline" | "connecting" | "local" | "remote" | "reconnecting";

export type DeviceLinkPayload =
  | { type: "presence"; state: "ready" | "away" }
  | { type: "cursor"; x: number; y: number }
  | { type: "wake"; family: "remote-dictation" | "computer-action" | "remote-read"; requestId: string }
  | { type: "ack"; requestId: string; outcome: "received" };

export interface DeviceLinkEnvelope {
  v: typeof DEVICE_LINK_VERSION;
  id: string;
  sender: string;
  target: string;
  issuedAt: number;
  expiresAt: number;
  payload: DeviceLinkPayload;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]): boolean =>
  Object.keys(v).sort().join(",") === expected.sort().join(",");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A cursor update is intentionally never a reliable side-effect request. */
export function isEphemeral(payload: DeviceLinkPayload): boolean {
  return payload.type === "cursor" || payload.type === "presence";
}
export function makeEnvelope(
  sender: string, target: string, payload: DeviceLinkPayload,
  now = Date.now(), id = crypto.randomUUID(),
): DeviceLinkEnvelope {
  if (!uuid.test(sender) || !uuid.test(target) || sender === target || !uuid.test(id)) {
    throw new Error("Invalid DeviceLink device or request ID.");
  }
  const ttl = isEphemeral(payload) ? DEVICE_LINK_EPHEMERAL_TTL_MS : DEVICE_LINK_RELIABLE_TTL_MS;
  const frame: DeviceLinkEnvelope = { v: 1, id, sender, target, issuedAt: now, expiresAt: now + ttl, payload };
  if (!parseDeviceLinkEnvelope(frame, now)) throw new Error("Invalid DeviceLink payload.");
  return frame;
}

/** Strict validation runs again after decrypting, never on unauthenticated plaintext. */
export function parseDeviceLinkEnvelope(value: unknown, now = Date.now()): DeviceLinkEnvelope | null {
  if (!plain(value) || !keys(value, ["v","id","sender","target","issuedAt","expiresAt","payload"])
    || value.v !== 1 || !uuid.test(String(value.id)) || !uuid.test(String(value.sender))
    || !uuid.test(String(value.target)) || value.sender === value.target
    || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)
    || (value.issuedAt as number) > now + DEVICE_LINK_MAX_CLOCK_SKEW_MS
    || (value.expiresAt as number) <= now) return null;
  const payload = value.payload;
  if (!plain(payload)) return null;
  const lifetime = (value.expiresAt as number) - (value.issuedAt as number);
  if (lifetime <= 0 || lifetime > DEVICE_LINK_RELIABLE_TTL_MS) return null;
  if (payload.type === "presence") {
    if (!keys(payload, ["type","state"]) || !["ready","away"].includes(String(payload.state))
      || lifetime > DEVICE_LINK_EPHEMERAL_TTL_MS) return null;
  } else if (payload.type === "cursor") {
    if (!keys(payload, ["type","x","y"]) || !finite(payload.x) || !finite(payload.y)
      || Math.abs(payload.x) > 100_000 || Math.abs(payload.y) > 100_000
      || lifetime > DEVICE_LINK_EPHEMERAL_TTL_MS) return null;
  } else if (payload.type === "wake") {
    if (!keys(payload, ["type","family","requestId"])
      || !["remote-dictation","computer-action","remote-read"].includes(String(payload.family))
      || !uuid.test(String(payload.requestId))) return null;
  } else if (payload.type === "ack") {
    if (!keys(payload, ["type","requestId","outcome"])
      || !uuid.test(String(payload.requestId)) || payload.outcome !== "received") return null;
  } else return null;
  // Limit JSON size before storage or cross-network transport.
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > DEVICE_LINK_MAX_FRAME_BYTES) return null;
  return value as unknown as DeviceLinkEnvelope;
}

/** Reject duplicates across paths and reconnects; never re-run the same request twice. */
export class DeviceLinkSeenIds {
  private entries = new Map<string, number>();
  constructor(private limit = 512) {}
  accept(frame: DeviceLinkEnvelope, now = Date.now()): boolean {
    if (frame.expiresAt <= now || frame.issuedAt > now + DEVICE_LINK_MAX_CLOCK_SKEW_MS) return false;
    for (const [id, expiry] of this.entries) if (expiry <= now) this.entries.delete(id);
    const key = frame.sender + ":" + frame.id;
    if (this.entries.has(key)) return false;
    this.entries.set(key, frame.expiresAt);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return true;
  }
  clear(): void { this.entries.clear(); }
}
