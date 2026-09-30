import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { dictationFromRow } from "@/history/dictation";
import type { DictationRecord } from "@/history/dictation";
import { syncErrorMessage } from "@/services/personalSyncService";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

const DICTATION_COLUMNS = "id, text, destination, outcome, source_device_id, created_at";
/** Matches `DICTATION_HISTORY_LIMIT` in the local history store. */
const CLOUD_LIST_LIMIT = 75;

export interface DictationsApi {
  list(userId: string): Promise<DictationRecord[]>;
  insert(userId: string, record: DictationRecord): Promise<void>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Dictation sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

/** Supabase persistence for opted-in recent dictations. RLS scopes every operation to its owner. */
export const dictationsApi: DictationsApi = {
  async list(userId) {
    const { data, error } = await requireClient()
      .from("dictations")
      .select(DICTATION_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(CLOUD_LIST_LIMIT);
    check(error);
    return (data ?? []).map(dictationFromRow);
  },

  async insert(userId, record) {
    const text = record.text.trim();
    if (!text) return;
    const { error } = await requireClient().from("dictations").insert({
      id: record.id,
      user_id: userId,
      text,
      destination: record.destination,
      outcome: record.outcome,
      source_device_id: record.sourceDeviceId,
      created_at: record.createdAt,
    });
    check(error);
  },
};
