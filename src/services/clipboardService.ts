import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { normalizeClipboardSource, type ClipboardEntry, type ClipboardKind } from "@/clipboard/clipboardEntry";
import { clipboardImageMime, detectClipboardImageFormat } from "@/clipboard/clipboardImageCodec";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

const BUCKET = "clipboard-images";
const COLUMNS = "id, kind, text, content_hash, source_app, source_process, source_device_id, pinned, copy_count, last_copied_at, image_path, created_at, updated_at, deleted_at";

type ClipboardRow = Pick<
  Database["public"]["Tables"]["clipboard_entries"]["Row"],
  | "id"
  | "kind"
  | "text"
  | "content_hash"
  | "source_app"
  | "source_process"
  | "source_device_id"
  | "pinned"
  | "copy_count"
  | "last_copied_at"
  | "image_path"
  | "created_at"
  | "updated_at"
  | "deleted_at"
>;

export interface ClipboardRemote {
  entries: ClipboardEntry[];
  clearedAt: string | null;
}

export interface ClipboardApi {
  list(userId: string): Promise<ClipboardRemote>;
  upsert(userId: string, entry: ClipboardEntry): Promise<void>;
  remove(userId: string, entry: ClipboardEntry): Promise<void>;
  clear(userId: string, clearedAt: string): Promise<void>;
  uploadImage(userId: string, entryId: string, bytes: Uint8Array): Promise<string>;
  downloadImage(path: string): Promise<Uint8Array>;
  deleteImage(path: string): Promise<void>;
}

/** The account already has this clipboard value. The store reloads instead of inserting a second row. */
export class ClipboardHashConflict extends Error {
  constructor() {
    super("That clipboard item is already saved.");
    this.name = "ClipboardHashConflict";
  }
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Clipboard sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (!error) return;
  if (error.code === "23505") throw new ClipboardHashConflict();
  if (error.code === "23514") throw new Error("That clipboard item is too large or invalid.");
  if (error.code === "42501" || error.code === "PGRST301") throw new Error("Sign in again to sync clipboard history.");
  throw new Error(error.code ? `Clipboard sync failed (${error.code}).` : "Couldn't reach clipboard sync.");
}

function kindOf(value: string): ClipboardKind | null {
  return value === "text" || value === "url" || value === "image" ? value : null;
}

function fromRow(row: ClipboardRow): ClipboardEntry | null {
  const kind = kindOf(row.kind);
  if (!kind || !row.content_hash) return null;
  return {
    id: row.id,
    kind,
    text: row.text,
    contentHash: row.content_hash,
    sourceApp: normalizeClipboardSource(row.source_app),
    sourceProcess: normalizeClipboardSource(row.source_process),
    sourceDeviceId: row.source_device_id,
    pinned: row.pinned,
    copyCount: row.copy_count,
    lastCopiedAt: row.last_copied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    imagePath: row.image_path,
    visibility: "account",
    pending: "none",
  };
}

function payload(userId: string, entry: ClipboardEntry, sourceDeviceId: string | null) {
  return {
    id: entry.id,
    user_id: userId,
    kind: entry.kind,
    text: entry.deletedAt ? null : entry.text,
    content_hash: entry.contentHash,
    source_app: entry.sourceApp,
    source_process: entry.sourceProcess,
    source_device_id: sourceDeviceId,
    pinned: entry.pinned,
    copy_count: entry.copyCount,
    last_copied_at: entry.lastCopiedAt,
    image_path: entry.deletedAt ? null : entry.imagePath,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    deleted_at: entry.deletedAt,
  };
}

export const clipboardApi: ClipboardApi = {
  async list(userId) {
    const client = requireClient();
    const [{ data, error }, reset] = await Promise.all([
      client.from("clipboard_entries").select(COLUMNS).eq("user_id", userId).order("updated_at", { ascending: false }).limit(500),
      client.from("clipboard_resets").select("cleared_at").eq("user_id", userId).maybeSingle(),
    ]);
    check(error);
    check(reset.error);
    return {
      entries: (data ?? []).map(fromRow).filter((entry): entry is ClipboardEntry => entry !== null),
      clearedAt: reset.data?.cleared_at ?? null,
    };
  },

  async upsert(userId, entry) {
    await writeRow(userId, entry, entry.sourceDeviceId);
  },

  async remove(userId, entry) {
    const client = requireClient();
    const { error } = await client.from("clipboard_entries").update({
      text: null,
      image_path: null,
      deleted_at: entry.deletedAt,
      updated_at: entry.updatedAt,
    }).eq("id", entry.id).eq("user_id", userId);
    check(error);
    if (entry.imagePath) await clipboardApi.deleteImage(entry.imagePath);
  },

  async clear(userId, clearedAt) {
    const client = requireClient();
    const reset = await client.from("clipboard_resets").upsert({ user_id: userId, cleared_at: clearedAt });
    check(reset.error);
    const deleted = await client.from("clipboard_entries").delete().eq("user_id", userId);
    check(deleted.error);
    const listed = await client.storage.from(BUCKET).list(userId, { limit: 1000 });
    if (listed.error) throw new Error("Couldn't clear clipboard images.");
    const paths = (listed.data ?? []).map((file) => `${userId}/${file.name}`);
    if (paths.length) {
      const removed = await client.storage.from(BUCKET).remove(paths);
      if (removed.error) throw new Error("Couldn't clear clipboard images.");
    }
  },

  async uploadImage(userId, entryId, bytes) {
    const png = detectClipboardImageFormat(bytes) === "png";
    const path = `${userId}/${entryId}.${png ? "png" : "bmp"}`;
    const client = requireClient();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const { error } = await client.storage.from(BUCKET).upload(path, new Blob([copy.buffer]), {
      contentType: clipboardImageMime(bytes),
      upsert: true,
    });
    if (error) throw new Error("Couldn't upload the clipboard image.");
    return path;
  },

  async downloadImage(path) {
    const { data, error } = await requireClient().storage.from(BUCKET).download(path);
    if (error || !data) throw new Error("Couldn't download the clipboard image.");
    return new Uint8Array(await data.arrayBuffer());
  },

  async deleteImage(path) {
    const { error } = await requireClient().storage.from(BUCKET).remove([path]);
    if (error) throw new Error("Couldn't delete the clipboard image.");
  },
};

async function writeRow(userId: string, entry: ClipboardEntry, sourceDeviceId: string | null): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("clipboard_entries").upsert(payload(userId, entry, sourceDeviceId));
  if (error?.code === "23503" && sourceDeviceId) {
    await writeRow(userId, entry, null);
    return;
  }
  check(error);
}
