import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import { noteFromRow } from "@/notes/note";
import type { Note, NoteSourceType, NoteStatus } from "@/notes/note";
import type { Database } from "@/types/database";

const NOTE_COLUMNS = "id, text, source_device_id, source_type, status, created_at, updated_at";

export interface NotesApi {
  list(userId: string): Promise<Note[]>;
  create(userId: string, text: string, sourceDeviceId: string, sourceType: NoteSourceType): Promise<Note>;
  updateText(id: string, text: string): Promise<Note>;
  setStatus(id: string, status: NoteStatus): Promise<Note>;
  delete(id: string): Promise<void>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Notes sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

/** Supabase persistence for account-scoped notes. RLS scopes every operation to its owner. */
export const notesApi: NotesApi = {
  async list(userId) {
    const { data, error } = await requireClient()
      .from("notes")
      .select(NOTE_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    check(error);
    return (data ?? []).map(noteFromRow);
  },

  async create(userId, text, sourceDeviceId, sourceType) {
    const { data, error } = await requireClient()
      .from("notes")
      .insert({ user_id: userId, text, source_device_id: sourceDeviceId, source_type: sourceType })
      .select(NOTE_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the saved note.");
    return noteFromRow(data);
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

  async delete(id) {
    const { error } = await requireClient().from("notes").delete().eq("id", id);
    check(error);
  },
};
