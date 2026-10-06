import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { dictationFromRow, type DictationRecord } from "@/history/dictation";
import type {
  CatchphraseInsight,
  InsightCandidate,
  InsightCandidateStatus,
  InsightRun,
  InsightUsageFacts,
} from "@/insights/insights";
import type { ProposedCandidate } from "@/insights/candidateDedupe";
import { candidateFingerprint } from "@/insights/candidateDedupe";
import { getSupabase } from "@/services/supabase";
import { syncErrorMessage } from "@/services/personalSyncService";
import type { Database, Json } from "@/types/database";

const DICTATION_COLUMNS = "id, text, destination, outcome, source_device_id, created_at";
const RUN_COLUMNS = "id, source_from_created_at, source_through_created_at, dictation_count, word_count, active_days, voice_profile, catchphrases, usage_facts, created_at, compacted_at, compacted_count";
const CANDIDATE_COLUMNS = "id, run_id, kind, fingerprint, title, payload, evidence_count, confidence, reason, status, created_at, updated_at";
const PAGE = 1000;

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Insights sync is not configured for this build.");
  return client;
}

function check(error: PostgrestError | null): void {
  if (error) throw new Error(syncErrorMessage(error));
}

function record(value: Json): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function catchphrases(value: Json): CatchphraseInsight[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return {
      text: typeof item.text === "string" ? item.text : "",
      count: typeof item.count === "number" ? Math.max(0, Math.floor(item.count)) : 0,
    };
  }).filter((item) => item.text && item.count > 0);
}

function facts(value: Json): InsightUsageFacts {
  const item = record(value);
  return {
    peakDay: typeof item.peakDay === "string" ? item.peakDay : null,
    peakHourStart: typeof item.peakHourStart === "number" ? item.peakHourStart : null,
    peakHourEnd: typeof item.peakHourEnd === "number" ? item.peakHourEnd : null,
    peakDeviceId: typeof item.peakDeviceId === "string" ? item.peakDeviceId : null,
    peakDeviceShare: typeof item.peakDeviceShare === "number" ? item.peakDeviceShare : null,
    averageWords: typeof item.averageWords === "number" ? item.averageWords : 0,
    totalWords: typeof item.totalWords === "number" ? item.totalWords : 0,
  };
}

type InsightRunRow = Pick<Database["public"]["Tables"]["insight_runs"]["Row"],
  "id" | "source_from_created_at" | "source_through_created_at" | "dictation_count" | "word_count" | "active_days"
  | "voice_profile" | "catchphrases" | "usage_facts" | "created_at" | "compacted_at" | "compacted_count">;
type InsightCandidateRow = Pick<Database["public"]["Tables"]["insight_candidates"]["Row"],
  "id" | "run_id" | "kind" | "fingerprint" | "title" | "payload" | "evidence_count"
  | "confidence" | "reason" | "status" | "created_at" | "updated_at">;

function runFromRow(row: InsightRunRow): InsightRun {
  return {
    id: row.id,
    sourceFromCreatedAt: row.source_from_created_at,
    sourceThroughCreatedAt: row.source_through_created_at,
    dictationCount: row.dictation_count,
    wordCount: row.word_count,
    activeDays: row.active_days,
    voiceProfile: row.voice_profile,
    catchphrases: catchphrases(row.catchphrases),
    usageFacts: facts(row.usage_facts),
    createdAt: row.created_at,
    compactedAt: row.compacted_at,
    compactedCount: row.compacted_count,
  };
}

function candidateFromRow(row: InsightCandidateRow): InsightCandidate {
  const payload = record(row.payload);
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind as InsightCandidate["kind"],
    fingerprint: row.fingerprint,
    title: row.title,
    payload,
    evidenceCount: row.evidence_count,
    confidence: row.confidence as InsightCandidate["confidence"],
    reason: row.reason,
    status: row.status as InsightCandidate["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SaveInsightRun {
  sourceFromCreatedAt: string;
  sourceThroughCreatedAt: string;
  dictationCount: number;
  wordCount: number;
  activeDays: number;
  voiceProfile: string;
  catchphrases: CatchphraseInsight[];
  usageFacts: InsightUsageFacts;
  candidates: ProposedCandidate[];
}

export interface InsightsApi {
  listDictations(userId: string): Promise<DictationRecord[]>;
  listRuns(userId: string): Promise<InsightRun[]>;
  listCandidates(userId: string): Promise<InsightCandidate[]>;
  saveRun(userId: string, input: SaveInsightRun): Promise<InsightRun>;
  setCandidateStatus(id: string, status: InsightCandidateStatus): Promise<void>;
  compact(userId: string, runId: string, keepNewest: number): Promise<number>;
}

export const insightsApi: InsightsApi = {
  async listDictations(userId) {
    const client = requireClient();
    const rows: DictationRecord[] = [];
    for (let offset = 0;; offset += PAGE) {
      const { data, error } = await client
        .from("dictations")
        .select(DICTATION_COLUMNS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE - 1);
      check(error);
      rows.push(...(data ?? []).map(dictationFromRow));
      if ((data ?? []).length < PAGE) return rows;
    }
  },

  async listRuns(userId) {
    const { data, error } = await requireClient()
      .from("insight_runs")
      .select(RUN_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    check(error);
    return (data ?? []).map(runFromRow);
  },

  async listCandidates(userId) {
    const client = requireClient();
    const rows: InsightCandidate[] = [];
    for (let offset = 0;; offset += PAGE) {
      const { data, error } = await client
        .from("insight_candidates")
        .select(CANDIDATE_COLUMNS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      check(error);
      rows.push(...(data ?? []).map(candidateFromRow));
      if ((data ?? []).length < PAGE) return rows;
    }
  },

  async saveRun(userId, input) {
    const client = requireClient();
    const { data, error } = await client
      .from("insight_runs")
      .insert({
        user_id: userId,
        source_from_created_at: input.sourceFromCreatedAt,
        source_through_created_at: input.sourceThroughCreatedAt,
        dictation_count: input.dictationCount,
        word_count: input.wordCount,
        active_days: input.activeDays,
        voice_profile: input.voiceProfile,
        catchphrases: input.catchphrases as unknown as Json,
        usage_facts: input.usageFacts as unknown as Json,
      })
      .select(RUN_COLUMNS)
      .single();
    check(error);
    if (!data) throw new Error("The Insights service did not return the saved run.");

    if (input.candidates.length) {
      const rows = input.candidates.map((candidate) => ({
        user_id: userId,
        run_id: data.id,
        kind: candidate.kind,
        fingerprint: candidateFingerprint(candidate),
        title: candidate.title,
        payload: candidate.payload as unknown as Json,
        evidence_count: candidate.evidenceCount,
        confidence: candidate.confidence,
        reason: candidate.reason,
      }));
      const { error: candidateError } = await client.from("insight_candidates").insert(rows);
      if (candidateError) {
        await client.from("insight_runs").delete().eq("id", data.id);
        check(candidateError);
      }
    }
    return runFromRow(data);
  },

  async setCandidateStatus(id, status) {
    const { error } = await requireClient()
      .from("insight_candidates")
      .update({ status })
      .eq("id", id);
    check(error);
  },

  async compact(userId, runId, keepNewest) {
    const { data, error } = await requireClient().rpc("compact_insight_run", {
      p_user_id: userId,
      p_run_id: runId,
      p_keep_newest: keepNewest,
    });
    check(error);
    return typeof data === "number" ? data : 0;
  },
};
