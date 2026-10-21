import type { KeyValueStorage } from "@/sync/personalCache";
import { normalizeClipboardSource, type ClipboardEntry, type ClipboardKind, type ClipboardPending } from "@/clipboard/clipboardEntry";

const CACHE_VERSION = 1;

export interface ClipboardCacheFile {
  entries: ClipboardEntry[];
  clearedAt: string | null;
  pendingClear: boolean;
}

function keyFor(userId: string | null): string {
  return userId ? `clipboard.history.${userId}` : "clipboard.history.device";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function kindOf(value: unknown): ClipboardKind | null {
  return value === "text" || value === "url" || value === "image" ? value : null;
}

function pendingOf(value: unknown): ClipboardPending {
  return value === "upsert" || value === "delete" ? value : "none";
}

function parseEntry(value: unknown): ClipboardEntry | null {
  const fields = record(value);
  const kind = kindOf(fields.kind);
  if (
    typeof fields.id !== "string"
    || !kind
    || typeof fields.contentHash !== "string"
    || typeof fields.pinned !== "boolean"
    || typeof fields.copyCount !== "number"
    || typeof fields.createdAt !== "string"
    || typeof fields.updatedAt !== "string"
  ) return null;
  return {
    id: fields.id,
    kind,
    text: optionalText(fields.text),
    contentHash: fields.contentHash,
    sourceApp: normalizeClipboardSource(optionalText(fields.sourceApp)),
    sourceProcess: normalizeClipboardSource(optionalText(fields.sourceProcess)),
    sourceDeviceId: optionalText(fields.sourceDeviceId),
    pinned: fields.pinned,
    copyCount: fields.copyCount,
    lastCopiedAt: optionalText(fields.lastCopiedAt),
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
    deletedAt: optionalText(fields.deletedAt),
    imagePath: optionalText(fields.imagePath),
    visibility: fields.visibility === "account" ? "account" : "local",
    pending: pendingOf(fields.pending),
  };
}

/** Reads the on-disk clipboard history for this account, or the signed-out device cache. */
export function readClipboardCache(storage: KeyValueStorage, userId: string | null): ClipboardCacheFile {
  try {
    const fields = record(JSON.parse(storage.getItem(keyFor(userId)) ?? "null"));
    if (fields.version !== CACHE_VERSION || !Array.isArray(fields.entries)) {
      return { entries: [], clearedAt: null, pendingClear: false };
    }
    return {
      entries: fields.entries.map(parseEntry).filter((entry): entry is ClipboardEntry => entry !== null),
      clearedAt: optionalText(fields.clearedAt),
      pendingClear: fields.pendingClear === true,
    };
  } catch {
    return { entries: [], clearedAt: null, pendingClear: false };
  }
}

/** Persists history metadata. Image bytes live in the image store, never in this JSON. */
export function writeClipboardCache(storage: KeyValueStorage, userId: string | null, file: ClipboardCacheFile): void {
  try {
    storage.setItem(keyFor(userId), JSON.stringify({ version: CACHE_VERSION, ...file }));
  } catch {
    // A full disk must not throw into the clipboard listener.
  }
}
