import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import { noteFromRow } from "@/notes/note";
import { noteGroupFromRow } from "@/notes/noteGroup";
import { NOTE_ATTACHMENT_MAX_BYTES, noteAttachmentFromRow } from "@/notes/noteAttachment";
import type { Note, NoteOrganizationSource, NoteSourceType, NoteStatus } from "@/notes/note";
import type { NoteGroup } from "@/notes/noteGroup";
import type { NoteAttachment } from "@/notes/noteAttachment";
import type { Database } from "@/types/database";

const NOTE_COLUMNS = "id, text, title, title_source, group_id, group_source, organized_at, source_device_id, source_type, status, created_at, updated_at";
const GROUP_COLUMNS = "id, name, created_at, updated_at";
const ATTACHMENT_COLUMNS = "id, user_id, note_id, file_name, mime_type, size_bytes, storage_path, created_at";
const ATTACHMENT_BUCKET = "note-attachments";
const SIGNED_URL_SECONDS = 60 * 60;

export interface NotePresentationUpdate {
  title?: string | null;
  titleSource?: NoteOrganizationSource | null;
  groupId?: string | null;
  groupSource?: NoteOrganizationSource | null;
  organizedAt?: string | null;
}

export interface NewNoteDetails {
  title?: string;
  groupId?: string;
}

export interface NotesApi {
  list(userId: string): Promise<Note[]>;
  listGroups(userId: string): Promise<NoteGroup[]>;
  create(userId: string, text: string, sourceDeviceId: string, sourceType: NoteSourceType, details?: NewNoteDetails): Promise<Note>;
  createGroup(userId: string, name: string): Promise<NoteGroup>;
  renameGroup(id: string, name: string): Promise<NoteGroup>;
  updateText(id: string, text: string): Promise<Note>;
  updateDetails(id: string, text: string, title: string, groupId: string | null, groupEdited: boolean): Promise<Note>;
  updatePresentation(id: string, update: NotePresentationUpdate): Promise<Note>;
  addAttachment(userId: string, noteId: string, file: File): Promise<NoteAttachment>;
  removeAttachment(attachment: NoteAttachment): Promise<void>;
  setStatus(id: string, status: NoteStatus): Promise<Note>;
  delete(id: string, attachments: readonly NoteAttachment[]): Promise<void>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Notes sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

function checkStorage(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function safeStorageName(name: string): string {
  const cleaned = name.trim().replace(/[\\/#?%*:|"<>]/g, "_").slice(0, 240);
  return cleaned || "attachment";
}

async function signedAttachment(
  client: SupabaseClient<Database>,
  row: Database["public"]["Tables"]["note_attachments"]["Row"],
): Promise<NoteAttachment> {
  const { data, error } = await client.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  checkStorage(error);
  if (!data?.signedUrl) throw new Error("The attachment service did not return a download URL.");
  return noteAttachmentFromRow(row, data.signedUrl);
}

/** Supabase persistence for account-scoped notes and their private file attachments. */
export const notesApi: NotesApi = {
  async list(userId) {
    const client = requireClient();
    const { data, error } = await client
      .from("notes")
      .select(NOTE_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    check(error);

    const notes = (data ?? []).map(noteFromRow);
    if (!notes.length) return notes;

    const { data: attachmentRows, error: attachmentError } = await client
      .from("note_attachments")
      .select(ATTACHMENT_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    check(attachmentError);

    const attachments = await Promise.all(
      (attachmentRows ?? []).map(async (row) => ({
        noteId: row.note_id,
        attachment: await signedAttachment(client, row),
      })),
    );
    const byNote = new Map<string, NoteAttachment[]>();
    for (const row of attachments) {
      const existing = byNote.get(row.noteId) ?? [];
      existing.push(row.attachment);
      byNote.set(row.noteId, existing);
    }
    return notes.map((note) => ({ ...note, attachments: byNote.get(note.id) ?? [] }));
  },

  async listGroups(userId) {
    const { data, error } = await requireClient()
      .from("note_groups")
      .select(GROUP_COLUMNS)
      .eq("user_id", userId)
      .order("name", { ascending: true });
    check(error);
    return (data ?? []).map(noteGroupFromRow);
  },

  async create(userId, text, sourceDeviceId, sourceType, details = {}) {
    const title = details.title?.trim();
    const groupId = details.groupId || null;
    const insert: Database["public"]["Tables"]["notes"]["Insert"] = {
      user_id: userId,
      text,
      source_device_id: sourceDeviceId,
      source_type: sourceType,
      ...(title ? { title, title_source: "manual" as const } : {}),
      ...(groupId ? { group_id: groupId, group_source: "manual" as const } : {}),
      ...(title && groupId ? { organized_at: new Date().toISOString() } : {}),
    };
    const { data, error } = await requireClient()
      .from("notes")
      .insert(insert)
      .select(NOTE_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the saved note.");
    return noteFromRow(data);
  },

  async createGroup(userId, name) {
    const clean = name.trim();
    if (!clean) throw new Error("A note group needs a name.");
    const { data, error } = await requireClient()
      .from("note_groups")
      .insert({ user_id: userId, name: clean })
      .select(GROUP_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the new group.");
    return noteGroupFromRow(data);
  },

  async renameGroup(id, name) {
    const clean = name.trim();
    if (!clean) throw new Error("A note group needs a name.");
    const { data, error } = await requireClient()
      .from("note_groups")
      .update({ name: clean })
      .eq("id", id)
      .select(GROUP_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the renamed group.");
    return noteGroupFromRow(data);
  },

  async updateText(id, text) {
    const { data, error } = await requireClient()
      .from("notes")
      .update({ text })
      .eq("id", id)
      .select(NOTE_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the edited note.");
    return noteFromRow(data);
  },

  async updateDetails(id, text, title, groupId, groupEdited) {
    const cleanText = text.trim();
    const cleanTitle = title.trim();
    if (!cleanText) throw new Error("A note cannot be empty.");
    if (!cleanTitle) throw new Error("A note title cannot be empty.");
    const update: Database["public"]["Tables"]["notes"]["Update"] = {
      text: cleanText,
      title: cleanTitle,
      title_source: "manual",
    };
    if (groupEdited) {
      update.group_id = groupId;
      update.group_source = "manual";
      update.organized_at = new Date().toISOString();
    }
    const { data, error } = await requireClient()
      .from("notes")
      .update(update)
      .eq("id", id)
      .select(NOTE_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the edited note.");
    return noteFromRow(data);
  },

  async updatePresentation(id, update) {
    const row: Database["public"]["Tables"]["notes"]["Update"] = {};
    if (update.title !== undefined) row.title = update.title;
    if (update.titleSource !== undefined) row.title_source = update.titleSource;
    if (update.groupId !== undefined) row.group_id = update.groupId;
    if (update.groupSource !== undefined) row.group_source = update.groupSource;
    if (update.organizedAt !== undefined) row.organized_at = update.organizedAt;
    const { data, error } = await requireClient()
      .from("notes")
      .update(row)
      .eq("id", id)
      .select(NOTE_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the organized note.");
    return noteFromRow(data);
  },

  async addAttachment(userId, noteId, file) {
    if (file.size > NOTE_ATTACHMENT_MAX_BYTES) {
      throw new Error(`${file.name || "That file"} is larger than the 100 MB attachment limit.`);
    }
    const client = requireClient();
    const id = crypto.randomUUID();
    const fileName = file.name.trim() || "attachment";
    const storagePath = `${userId}/${noteId}/${id}/${safeStorageName(fileName)}`;

    const { error: uploadError } = await client.storage
      .from(ATTACHMENT_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    checkStorage(uploadError);

    const { data, error } = await client
      .from("note_attachments")
      .insert({
        id,
        user_id: userId,
        note_id: noteId,
        storage_path: storagePath,
        file_name: fileName,
        mime_type: file.type || null,
        size_bytes: file.size,
      })
      .select(ATTACHMENT_COLUMNS)
      .single();

    if (error || !data) {
      await client.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
      check(error);
      throw new Error("The notes service did not return the saved attachment.");
    }

    return signedAttachment(client, data);
  },

  async removeAttachment(attachment) {
    const client = requireClient();
    const { error } = await client
      .from("note_attachments")
      .delete()
      .eq("id", attachment.id);
    check(error);
    // Metadata is authoritative. A cleanup failure may leave an inaccessible private orphan,
    // but must not make a successfully removed attachment reappear in the UI.
    await client.storage.from(ATTACHMENT_BUCKET).remove([attachment.storagePath]);
  },

  async setStatus(id, status) {
    const { data, error } = await requireClient()
      .from("notes")
      .update({ status })
      .eq("id", id)
      .select(NOTE_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the updated note.");
    return noteFromRow(data);
  },

  async delete(id, attachments) {
    const client = requireClient();
    const { error } = await client.from("notes").delete().eq("id", id);
    check(error);
    const paths = attachments.map((attachment) => attachment.storagePath);
    if (paths.length) await client.storage.from(ATTACHMENT_BUCKET).remove(paths);
  },
};
