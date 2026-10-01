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

/** A missing settings row is epoch 0. The first usage sync does not create the row. */
export function settingsFromRow(row: {
  smart_transcription: boolean;
  language: string | null;
  usage_intelligence: boolean | null;
  usage_epoch?: number | null;
  cloud_dictation_history?: boolean | null;
  assistant_memory_learning?: boolean | null;
} | null): SyncedSettings {
  if (!row) return DEFAULT_SETTINGS;
  return {
    smartTranscription: row.smart_transcription,
    language: row.language,
    usageIntelligence: row.usage_intelligence ?? true,
    usageEpoch: typeof row.usage_epoch === "number" && row.usage_epoch >= 0 ? row.usage_epoch : 0,
    cloudDictationHistory: row.cloud_dictation_history ?? false,
    assistantMemoryLearning: row.assistant_memory_learning ?? false,
  };
}

/** Whole-row settings write. `usage_epoch` is omitted so a stale device cannot roll it back. */
export function settingsUpsertRow(userId: string, settings: SyncedSettings): {
  user_id: string;
  smart_transcription: boolean;
  language: string | null;
  usage_intelligence: boolean;
  cloud_dictation_history: boolean;
  assistant_memory_learning: boolean;
} {
  return {
    user_id: userId,
    smart_transcription: settings.smartTranscription,
    language: settings.language,
    usage_intelligence: settings.usageIntelligence,
    cloud_dictation_history: settings.cloudDictationHistory,
    assistant_memory_learning: settings.assistantMemoryLearning,
  };
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
      client.from("settings").select("smart_transcription, language, usage_intelligence, usage_epoch, cloud_dictation_history, assistant_memory_learning").eq("user_id", userId).maybeSingle(),
      client.from("dictionary").select("id, term, enabled").eq("user_id", userId).order("term"),
    ]);
    check(settings.error);
    check(dictionary.error);
    return {
      // No row yet means the user has never changed a setting.
      settings: settingsFromRow(settings.data),
      terms: dictionary.data ?? [],
    };
  },

  async saveSettings(userId, settings) {
    const { error } = await requireClient().from("settings").upsert(settingsUpsertRow(userId, settings));
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
    const client = requireClient();
    const lastSeen = new Date().toISOString();
    const { error: insertError } = await client.from("devices").upsert({
      ...device,
      user_id: userId,
      last_seen: lastSeen,
    }, {
      onConflict: "id",
      ignoreDuplicates: true,
    });
    check(insertError);
    // Preserve a friendly user rename while still refreshing mutable device metadata.
    const { error: updateError } = await client.from("devices")
      .update({ platform: device.platform, last_seen: lastSeen })
      .eq("id", device.id);
    check(updateError);
  },
};
