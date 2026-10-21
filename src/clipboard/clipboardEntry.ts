/** One saved clipboard item. Text and URLs are the primary kinds; images are optional. */
export type ClipboardKind = "text" | "url" | "image";

export type ClipboardPending = "none" | "upsert" | "delete";

export interface ClipboardEntry {
  id: string;
  kind: ClipboardKind;
  /** Plain text or URL. Null for an image, and cleared on a tombstone. */
  text: string | null;
  contentHash: string;
  sourceApp: string | null;
  sourceProcess: string | null;
  sourceDeviceId: string | null;
  pinned: boolean;
  copyCount: number;
  lastCopiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set when the user deletes the item. Other devices drop it on the next sync. */
  deletedAt: string | null;
  /** Private storage path after an opted-in upload. Null while the image is only on this device. */
  imagePath: string | null;
  /** `local` items stay on this device until clipboard sync is turned on. */
  visibility: "local" | "account";
  pending: ClipboardPending;
}

/** Fixed clipboard behavior. Capture, sync, and images are always on. */
export interface ClipboardPreferences {
  captureEnabled: boolean;
  syncEnabled: boolean;
  paused: boolean;
  imagesEnabled: boolean;
}

export const DEFAULT_CLIPBOARD_PREFERENCES: ClipboardPreferences = {
  captureEnabled: true,
  syncEnabled: true,
  paused: false,
  imagesEnabled: true,
};

export const MAX_CLIPBOARD_TEXT = 100_000;
export const MAX_CLIPBOARD_ENTRIES = 20;
export const CLIPBOARD_TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

/** A clipboard change observed by the platform. Excluded changes carry no content. */
export interface ClipboardChange {
  text: string | null;
  sourceApp: string | null;
  sourceProcess: string | null;
  excluded: boolean;
  /** Base64 PNG or BMP bytes. Null when the change has no usable image. */
  imageBase64: string | null;
  imageFormat: "png" | "bmp" | null;
}

const URL_TEXT = /^https?:\/\/[^\s]+$/i;

export type ClipboardTextDecision =
  | { ok: true; kind: "text" | "url"; text: string }
  | { ok: false; reason: "empty" | "too-long" };

/** Trims a clipboard string and classifies a single http(s) URL. */
export function classifyClipboardText(raw: string): ClipboardTextDecision {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_CLIPBOARD_TEXT) return { ok: false, reason: "too-long" };
  return { ok: true, kind: URL_TEXT.test(text) ? "url" : "text", text };
}

/**
 * True only when Windows marked this copy as excluded from clipboard monitoring.
 * The source app is not used to skip a copy.
 */
export function clipboardLooksSensitive(input: {
  text: string | null;
  sourceApp: string | null;
  sourceProcess: string | null;
  excludedByOs: boolean;
}): boolean {
  void input.text;
  void input.sourceApp;
  void input.sourceProcess;
  return input.excludedByOs;
}

/** SHA-256 of the kind and material. The same clipboard value hashes the same on every device. */
export async function clipboardContentHash(kind: ClipboardKind, material: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}\u0000${material}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isLiveClipboardEntry(entry: ClipboardEntry): boolean {
  return entry.deletedAt === null;
}

function recency(entry: ClipboardEntry): string {
  return entry.lastCopiedAt ?? entry.updatedAt;
}

/** Pinned items first, then most recently copied or updated. */
export function rankClipboardEntries(entries: readonly ClipboardEntry[]): ClipboardEntry[] {
  return entries.filter(isLiveClipboardEntry).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const byUse = recency(b).localeCompare(recency(a));
    if (byUse !== 0) return byUse;
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

/** Case-insensitive match on the text, source app, and process name. */
export function searchClipboardEntries(entries: readonly ClipboardEntry[], query: string): ClipboardEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  const ranked = rankClipboardEntries(entries);
  if (!needle) return ranked;
  return ranked.filter((entry) => {
    const haystack = `${entry.text ?? ""} ${entry.sourceApp ?? ""} ${entry.sourceProcess ?? ""}`.toLocaleLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Unchanged clipboard content matches the newest live item and is not stored again.
 * An older match is reused so a frequently copied value stays one row.
 */
export function clipboardIngestPlan(entries: readonly ClipboardEntry[], hash: string): "skip" | "bump" | "create" {
  const live = rankClipboardEntries(entries);
  const newest = live[0];
  if (newest?.contentHash === hash) return "skip";
  return live.some((entry) => entry.contentHash === hash) ? "bump" : "create";
}

/** Live ids outside the most recent `limit` copies, oldest first. Pinning changes display order only. */
export function clipboardOverflowIds(entries: readonly ClipboardEntry[], limit: number): string[] {
  const live = entries
    .filter(isLiveClipboardEntry)
    .sort((a, b) => recency(a).localeCompare(recency(b)) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const overflow = live.length - limit;
  if (overflow <= 0) return [];
  return live.slice(0, overflow).map((entry) => entry.id);
}

function later(a: string, b: string): boolean {
  return a > b;
}

/**
 * Merges a local cache with the account snapshot.
 * A newer tombstone removes the item. A newer edit wins. Pending local edits that are
 * newer than the server stay. Items the server no longer returns are dropped once they
 * were synced. `clearedAt` drops anything that was not changed after a permanent clear.
 */
export function reconcileClipboard(
  local: readonly ClipboardEntry[],
  remote: readonly ClipboardEntry[],
  clearedAt: string | null,
): ClipboardEntry[] {
  const byId = new Map<string, ClipboardEntry>();
  for (const entry of local) {
    if (clearedAt && entry.updatedAt <= clearedAt && entry.pending !== "upsert") continue;
    byId.set(entry.id, entry);
  }
  for (const entry of remote) {
    if (clearedAt && entry.updatedAt <= clearedAt && entry.deletedAt) continue;
    const existing = byId.get(entry.id);
    if (!existing) {
      if (clearedAt && entry.updatedAt <= clearedAt) continue;
      byId.set(entry.id, { ...entry, visibility: "account", pending: "none" });
      continue;
    }
    if (existing.pending !== "none" && later(existing.updatedAt, entry.updatedAt)) continue;
    byId.set(entry.id, { ...entry, visibility: "account", pending: "none" });
  }
  const remoteIds = new Set(remote.map((entry) => entry.id));
  for (const [id, entry] of byId) {
    if (entry.visibility === "account" && entry.pending === "none" && !remoteIds.has(id)) {
      byId.delete(id);
    }
  }
  return collapseClipboardHashes([...byId.values()]);
}

function onServer(entry: ClipboardEntry): boolean {
  return entry.visibility === "account" && entry.pending === "none";
}

/**
 * One live row per content hash. A row already on the server beats a local duplicate.
 * The higher copy count is kept. Local-only duplicates are dropped; synced duplicates
 * become tombstones so the extra row is deleted on the account.
 */
export function collapseClipboardHashes(entries: readonly ClipboardEntry[]): ClipboardEntry[] {
  const groups = new Map<string, ClipboardEntry[]>();
  const rest: ClipboardEntry[] = [];
  for (const entry of entries) {
    if (!isLiveClipboardEntry(entry)) {
      rest.push(entry);
      continue;
    }
    const group = groups.get(entry.contentHash) ?? [];
    group.push(entry);
    groups.set(entry.contentHash, group);
  }
  const live: ClipboardEntry[] = [];
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => {
      const server = Number(onServer(b)) - Number(onServer(a));
      if (server !== 0) return server;
      return b.updatedAt.localeCompare(a.updatedAt) || b.copyCount - a.copyCount || a.id.localeCompare(b.id);
    });
    const keeper = ranked[0];
    if (!keeper) continue;
    const copyCount = Math.max(...group.map((entry) => entry.copyCount));
    const pinned = group.some((entry) => entry.pinned);
    const changed = copyCount !== keeper.copyCount || (pinned && !keeper.pinned);
    live.push({
      ...keeper,
      copyCount,
      pinned: keeper.pinned || pinned,
      pending: changed && keeper.visibility === "account" ? "upsert" : keeper.pending,
    });
    for (const extra of ranked.slice(1)) {
      if (extra.visibility === "local") continue;
      rest.push({
        ...extra,
        text: null,
        imagePath: null,
        deletedAt: keeper.updatedAt,
        updatedAt: keeper.updatedAt,
        pending: extra.pending === "upsert" ? "none" : "delete",
      });
    }
  }
  return [...live, ...rest];
}

/** Drops tombstones that are old enough for every device to have synced the deletion. */
export function pruneClipboardTombstones(entries: readonly ClipboardEntry[], nowMs: number): ClipboardEntry[] {
  return entries.filter((entry) => {
    if (!entry.deletedAt || entry.pending === "delete") return true;
    const deleted = Date.parse(entry.deletedAt);
    return Number.isNaN(deleted) || nowMs - deleted < CLIPBOARD_TOMBSTONE_MS;
  });
}

/** Source metadata must not save em or en dashes. Copied text itself is left exact. */
export function normalizeClipboardSource(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/[\u2014\u2013]/g, "-").trim();
  return normalized || null;
}

/** Validates a platform clipboard event. Malformed payloads are ignored. */
export function parseClipboardChange(payload: unknown): ClipboardChange | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as {
    text?: unknown;
    sourceApp?: unknown;
    sourceProcess?: unknown;
    excluded?: unknown;
    imageBase64?: unknown;
    imageFormat?: unknown;
    imageBmpBase64?: unknown;
  };
  const excluded = record.excluded === true;
  const text = typeof record.text === "string" ? record.text : null;
  const legacyBmp = typeof record.imageBmpBase64 === "string" && record.imageBmpBase64 ? record.imageBmpBase64 : null;
  const imageBase64 = typeof record.imageBase64 === "string" && record.imageBase64
    ? record.imageBase64
    : legacyBmp;
  const imageFormat = record.imageFormat === "png" || record.imageFormat === "bmp"
    ? record.imageFormat
    : legacyBmp
      ? "bmp"
      : imageBase64
        ? "bmp"
        : null;
  if (!excluded && !text && !imageBase64) return null;
  return {
    text: excluded ? null : text,
    sourceApp: normalizeClipboardSource(typeof record.sourceApp === "string" ? record.sourceApp : null),
    sourceProcess: normalizeClipboardSource(typeof record.sourceProcess === "string" ? record.sourceProcess : null),
    excluded,
    imageBase64: excluded ? null : imageBase64,
    imageFormat: excluded ? null : imageFormat,
  };
}

/** Decodes a standard base64 payload. Returns null when the input is not base64. */
export function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
