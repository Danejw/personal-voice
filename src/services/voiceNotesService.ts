import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import { voiceNoteFromRow } from "@/notes/voiceNote";
import type { VoiceNote, VoiceNoteStatus } from "@/notes/voiceNote";
import type { Database } from "@/types/database";

const NOTE_COLUMNS = "id, text, source_device_id, status, created_at, updated_at";

export interface VoiceNotesApi {
  list(userId: string): Promise<VoiceNote[]>;
  create(userId: string, text: string, sourceDeviceId: string): Promise<VoiceNote>;
  setStatus(id: string, status: VoiceNoteStatus): Promise<VoiceNote>;
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

/** Supabase persistence for explicitly saved voice notes. RLS scopes every operation to its owner. */
export const voiceNotesApi: VoiceNotesApi = {
  async list(userId) {
    const { data, error } = await requireClient()
      .from("voice_notes")
      .select(NOTE_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    check(error);
    return (data ?? []).map(voiceNoteFromRow);
  },

  async create(userId, text, sourceDeviceId) {
    const { data, error } = await requireClient()
      .from("voice_notes")
      .insert({ user_id: userId, text, source_device_id: sourceDeviceId })
      .select(NOTE_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the saved note.");
    return voiceNoteFromRow(data);
  },

  async setStatus(id, status) {
    const { data, error } = await requireClient()
      .from("voice_notes")
      .update({ status })
      .eq("id", id)
      .select(NOTE_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The notes service did not return the updated note.");
    return voiceNoteFromRow(data);
  },

  async delete(id) {
    const { error } = await requireClient().from("voice_notes").delete().eq("id", id);
    check(error);
  },
};
