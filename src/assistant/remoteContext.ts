/** Read-only context one owned device may ask of another. Version 1. */

export const REMOTE_CONTEXT_VERSION = 1;
export const REMOTE_WINDOW_LIMIT = 20;
export const REMOTE_TITLE_CHARS = 120;
export const REMOTE_JPEG_CHARS = 300_000;
export const REMOTE_RESPONSE_LIMIT = 400_000;
/** A device that has not refreshed last_seen within this window is offline. */
export const REMOTE_ONLINE_MS = 45_000;
export const REMOTE_TIMEOUT_MS = 30_000;
export const REMOTE_POLL_MS = 2_000;

export type RemoteKind = "presence" | "active_window" | "windows" | "screenshot";

export interface RemoteDevice {
  id: string;
  name: string;
  platform: string;
  lastSeen: string | null;
}

export interface RemoteResponse {
  version: 1;
  kind: RemoteKind;
  text: string;
  screenshot: { jpeg: string; sourceApp: string | null; width: number; height: number } | null;
}

export type RemotePlan =
  | { action: "answer-presence" }
  | { action: "read-windows" }
  | { action: "approve-screenshot" }
  | { action: "deny"; message: string };

const KINDS = new Set<RemoteKind>(["presence", "active_window", "windows", "screenshot"]);

/** Names a device on this account. Several matches ask the user instead of guessing. */
export function resolveRemoteDevice(
  devices: readonly RemoteDevice[],
  currentDeviceId: string,
  requestedName: string | null,
  nowMs: number,
): { ok: true; device: RemoteDevice } | { ok: false; message: string } {
  const others = devices.filter((device) => device.id !== currentDeviceId);
  const name = requestedName?.trim() ?? "";
  let device: RemoteDevice | undefined;
  if (name) {
    const needle = name.toLocaleLowerCase();
    const matches = others.filter((item) => item.name.toLocaleLowerCase() === needle);
    if (matches.length === 0) return { ok: false, message: `No other device is named ${name}.` };
    if (matches.length > 1) return { ok: false, message: `More than one device is named ${name}.` };
    device = matches[0];
  } else if (others.length === 1) {
    device = others[0];
  } else if (others.length === 0) {
    return { ok: false, message: "There is no other device on this account." };
  } else {
    const labels = others.map((item) => item.name).join(" and ");
    return { ok: false, message: `Which device should I check? You have ${labels}.` };
  }
  if (!device) return { ok: false, message: "There is no other device on this account." };
  if (!isOnline(device.lastSeen, nowMs)) {
    const seen = device.lastSeen ? ` Last seen ${device.lastSeen}.` : " Last seen is unknown.";
    return { ok: false, message: `${device.name} is offline.${seen}` };
  }
  return { ok: true, device };
}

/**
 * What the target device may do. Screenshot pixels are not read until the user approves.
 * Unknown kinds and Android window reads are refused. Nothing here clicks or types.
 */
export function planRemoteRead(kind: string, platform: string, remoteReads: boolean): RemotePlan {
  if (!isRemoteKind(kind)) return { action: "deny", message: "That read is not available." };
  if (kind === "presence") return { action: "answer-presence" };
  if (platform !== "windows") {
    return { action: "deny", message: "This device can't share windows or a screenshot." };
  }
  if (!remoteReads) return { action: "deny", message: "Remote reads are turned off on this PC." };
  if (kind === "screenshot") return { action: "approve-screenshot" };
  return { action: "read-windows" };
}

export function presenceText(deviceName: string, platform: string): string {
  return `${deviceName} is online (${platform}). This was read from that device just now.`;
}

export function windowsText(deviceName: string, active: string | null, titles: readonly string[], kind: "active_window" | "windows"): string {
  const activeLine = active ? `The active window on ${deviceName} is ${clip(active)}.` : `No active window was reported on ${deviceName}.`;
  if (kind === "active_window") return activeLine;
  const list = titles.slice(0, REMOTE_WINDOW_LIMIT).map(clip);
  if (!list.length) return `${activeLine} No other windows were listed.`;
  return `${activeLine} Other windows: ${list.join(", ")}.`;
}

export function screenshotText(deviceName: string, sourceApp: string | null): string {
  const where = sourceApp ? ` The active window was ${clip(sourceApp)}.` : "";
  return `A one-time screenshot from ${deviceName} is attached.${where} It is not a live view.`;
}

/** Builds a versioned response. A screenshot that does not fit is refused instead of trimmed into garbage. */
export function buildRemoteResponse(
  kind: RemoteKind,
  deviceName: string,
  platform: string,
  report: { active: string | null; windows: readonly string[] } | null,
  screenshot: { jpeg: string; sourceApp: string | null; width: number; height: number } | null,
): { ok: true; response: RemoteResponse; json: string } | { ok: false; message: string } {
  if (kind === "screenshot") {
    if (!screenshot?.jpeg.startsWith("/9j/")) return { ok: false, message: "The screenshot could not be read." };
    if (screenshot.jpeg.length > REMOTE_JPEG_CHARS) return { ok: false, message: "The screenshot was too large to send." };
  }
  const response: RemoteResponse = {
    version: 1,
    kind,
    text: kind === "presence"
      ? presenceText(deviceName, platform)
      : kind === "screenshot"
        ? screenshotText(deviceName, screenshot?.sourceApp ?? null)
        : windowsText(deviceName, report?.active ?? null, report?.windows ?? [], kind === "windows" ? "windows" : "active_window"),
    screenshot: kind === "screenshot" && screenshot
      ? { jpeg: screenshot.jpeg, sourceApp: screenshot.sourceApp, width: screenshot.width, height: screenshot.height }
      : null,
  };
  const json = JSON.stringify(response);
  if (json.length > REMOTE_RESPONSE_LIMIT) return { ok: false, message: "The screenshot was too large to send." };
  return { ok: true, response, json };
}

export function parseRemoteResponse(raw: string | null): RemoteResponse | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !isRemoteKind(record.kind) || typeof record.text !== "string" || !record.text.trim()) return null;
  if (raw.length > REMOTE_RESPONSE_LIMIT) return null;
  const shot = record.screenshot;
  if (shot === null || shot === undefined) {
    return { version: 1, kind: record.kind, text: record.text, screenshot: null };
  }
  if (typeof shot !== "object" || shot === null) return null;
  const jpeg = (shot as { jpeg?: unknown }).jpeg;
  const sourceApp = (shot as { sourceApp?: unknown }).sourceApp;
  const width = (shot as { width?: unknown }).width;
  const height = (shot as { height?: unknown }).height;
  if (typeof jpeg !== "string" || !jpeg.startsWith("/9j/") || jpeg.length > REMOTE_JPEG_CHARS) return null;
  if (sourceApp !== null && typeof sourceApp !== "string") return null;
  if (typeof width !== "number" || typeof height !== "number" || width < 1 || height < 1) return null;
  return {
    version: 1,
    kind: record.kind,
    text: record.text,
    screenshot: { jpeg, sourceApp: typeof sourceApp === "string" ? sourceApp : null, width, height },
  };
}

export function isRemoteKind(value: unknown): value is RemoteKind {
  return typeof value === "string" && KINDS.has(value as RemoteKind);
}

function isOnline(lastSeen: string | null, nowMs: number): boolean {
  if (!lastSeen) return false;
  const seen = Date.parse(lastSeen);
  return Number.isFinite(seen) && nowMs - seen <= REMOTE_ONLINE_MS;
}

function clip(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length <= REMOTE_TITLE_CHARS ? trimmed : `${trimmed.slice(0, REMOTE_TITLE_CHARS - 1)}…`;
}
