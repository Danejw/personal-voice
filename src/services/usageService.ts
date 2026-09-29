import type { PostgrestError } from "@supabase/supabase-js";
import { getSupabase } from "@/services/supabase";
import { syncErrorMessage } from "@/services/personalSyncService";
import { collectUsagePages } from "@/usage/analytics";
import type { DateRange } from "@/usage/analytics";
import { parseCounters } from "@/usage/usageEvents";
import type { RemoteUsageDay, UsageCounters } from "@/usage/usageEvents";
import type { UsageApi, UsageDayWrite } from "@/usage/UsageStore";
import type { Json } from "@/types/database";

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

function requireClient() {
  const client = getSupabase();
  if (!client) throw new Error("Sync is not configured for this build.");
  return client;
}

function asCounters(value: Json): UsageCounters {
  return parseCounters(value);
}

/** Pages `usage_days`. A range limits the query. Omitting it reads every day. */
export async function fetchUsageDays(range?: DateRange): Promise<RemoteUsageDay[]> {
  const client = requireClient();
  return collectUsagePages(async (query) => {
    let request = client
      .from("usage_days")
      .select("device_id, day, epoch, counters, revision, updated_at")
      .order("day", { ascending: false })
      .order("device_id", { ascending: true });
    if (query.from) request = request.gte("day", query.from);
    if (query.to) request = request.lte("day", query.to);
    const { data, error } = await request.range(query.offset, query.offset + query.limit - 1);
    check(error);
    return (data ?? []).map((row) => ({
      deviceId: row.device_id,
      day: row.day,
      epoch: row.epoch,
      revision: row.revision,
      updatedAt: row.updated_at,
      counters: asCounters(row.counters),
    }));
  }, range);
}

export const usageApi: UsageApi = {
  async upsertDay(day: UsageDayWrite): Promise<void> {
    const { error } = await requireClient().rpc("upsert_usage_day", {
      p_device_id: day.deviceId,
      p_day: day.day,
      p_epoch: day.epoch,
      p_counters: day.counters as unknown as Json,
      p_revision: day.revision,
      p_updated_at: day.updatedAt,
    });
    check(error);
  },

  async clear(): Promise<number> {
    const { data, error } = await requireClient().rpc("clear_usage_analytics");
    check(error);
    return typeof data === "number" ? data : 0;
  },

  fetchDays: fetchUsageDays,
};
