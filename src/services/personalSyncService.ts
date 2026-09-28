import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { PlatformName } from "@/platform/PlatformAdapter";
import { getSupabase } from "@/services/supabase";
import type { DictionaryTerm, PersonalData, SyncedSettings } from "@/sync/personalData";
import { DEFAULT_SETTINGS } from "@/sync/personalData";
import type { Database } from "@/types/database";

export interface DeviceInfo {
  id: string;
  name: string;
  platform: PlatformName;
}

/** Account data in Supabase. RLS scopes every table to the signed-in user; `userId` is sent so inserts are explicit. */
export interface PersonalSyncApi {
  load(userId: string): Promise<PersonalData>;
  saveSettings(userId: string, settings: SyncedSettings): Promise<void>;
  insertTerm(userId: string, term: DictionaryTerm): Promise<void>;
  setTermEnabled(id: string, enabled: boolean): Promise<void>;
  deleteTerm(id: string): Promise<void>;
  touchDevice(userId: string, device: DeviceInfo): Promise<void>;
}

/** Maps a PostgREST failure to a short user-facing message. */
export function syncErrorMessage(error: Pick<PostgrestError, "code" | "message">): string {
  switch (error.code) {
    case "23505": return "That term is already in your dictionary.";
    // Raised by `enforce_dictionary_limit`, whose message is written for users.
    case "P0001": return error.message;
    case "23514": return "The server rejected that value.";
    case "42501":
    case "PGRST301": return "Sign in again to sync.";
    case "": return "Couldn't reach the sync service. Check your connection.";
    default: return `Sync failed (${error.code}).`;
  }
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Sync is not configured for this build.");
  return client;
}

export const personalSyncApi: PersonalSyncApi = {
  async load(userId) {
    const client = requireClient();
    const [settings, dictionary] = await Promise.all([
      client.from("settings").select("smart_transcription, language").eq("user_id", userId).maybeSingle(),
      client.from("dictionary").select("id, term, enabled").eq("user_id", userId).order("term"),
    ]);
    check(settings.error);
    check(dictionary.error);
    return {
      // No row yet means the user has never changed a setting.
      settings: settings.data
        ? { smartTranscription: settings.data.smart_transcription, language: settings.data.language }
        : DEFAULT_SETTINGS,
      terms: dictionary.data ?? [],
    };
  },

  async saveSettings(userId, settings) {
    const { error } = await requireClient().from("settings").upsert({
      user_id: userId,
      smart_transcription: settings.smartTranscription,
      language: settings.language,
    });
    check(error);
  },

  async insertTerm(userId, term) {
    const { error } = await requireClient().from("dictionary").insert({ user_id: userId, ...term });
    check(error);
  },

  async setTermEnabled(id, enabled) {
    const { error } = await requireClient().from("dictionary").update({ enabled }).eq("id", id);
    check(error);
  },

  async deleteTerm(id) {
    const { error } = await requireClient().from("dictionary").delete().eq("id", id);
    check(error);
  },

  async touchDevice(userId, device) {
    const { error } = await requireClient().from("devices").upsert({
      ...device,
      user_id: userId,
      last_seen: new Date().toISOString(),
    });
    check(error);
  },
};
