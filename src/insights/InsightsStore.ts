import type { AssistantMemory } from "@/assistant/memory";
import type { DictationRecord } from "@/history/dictation";
import {
  chunkDictations,
  eligibleDictations,
  insightReadiness,
  INSIGHTS_KEEP_RECENT,
  type InsightCandidate,
  type InsightReadiness,
  type InsightRun,
  usageFacts,
} from "@/insights/insights";
import {
  uniqueNewCandidates,
  type ExistingKnowledge,
  type ProposedCandidate,
} from "@/insights/candidateDedupe";
import type { InsightsAnalyzer } from "@/services/insightsAnalysisService";
import type { InsightsApi } from "@/services/insightsService";
import type { DictionaryTerm } from "@/sync/personalData";
import type { Snippet } from "@/snippets/snippet";
import type { TransformProfile } from "@/transforms/transformProfile";

export type InsightsStatus = "signed-out" | "loading" | "ready" | "analyzing" | "compacting" | "error";

export interface InsightsSnapshot {
  status: InsightsStatus;
  dictationCount: number;
  runs: InsightRun[];
  candidates: InsightCandidate[];
  readiness: InsightReadiness;
  /** Current deterministic facts are a fallback for runs created before visual distributions were persisted. */
  currentUsageFacts: ReturnType<typeof usageFacts>;
  progress: string | null;
  error: string | null;
}

export interface InsightsKnowledgeInput {
  dictionary: readonly DictionaryTerm[];
  snippets: readonly Snippet[];
  transforms: readonly TransformProfile[];
  memories: readonly AssistantMemory[];
}

const EMPTY_READINESS: InsightReadiness = {
  ready: false,
  reason: "Sign in to load Insights.",
  totalDictations: 0,
  activeDays: 0,
  newSinceLastRun: 0,
  eligibleForAnalysis: 0,
};

const EMPTY: InsightsSnapshot = {
  status: "signed-out",
  dictationCount: 0,
  runs: [],
  candidates: [],
  readiness: EMPTY_READINESS,
  currentUsageFacts: usageFacts([]),
  progress: null,
  error: null,
};

function activeDays(rows: readonly DictationRecord[]): number {
  const days = new Set<string>();
  for (const row of rows) {
    const date = new Date(row.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  }
  return days.size;
}

function mergeInput(
  previous: InsightRun | null,
  chunks: readonly unknown[],
  facts: ReturnType<typeof usageFacts>,
  knowledge: InsightsKnowledgeInput,
): string {
  return JSON.stringify({
    previousVoiceProfile: previous?.voiceProfile ?? null,
    deterministicUsageFacts: facts,
    existingKnowledge: {
      dictionaryTerms: knowledge.dictionary.map((item) => item.term).slice(0, 200),
      snippetTriggers: knowledge.snippets.map((item) => item.trigger).slice(0, 200),
      transformNames: knowledge.transforms.map((item) => item.name).slice(0, 100),
      memoryKeys: knowledge.memories.map((item) => item.key).slice(0, 100),
    },
    chunkAnalyses: chunks,
  });
}

export class InsightsStore {
  private snapshot: InsightsSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private generation = 0;
  private dictations: DictationRecord[] = [];
  private abort: AbortController | null = null;

  constructor(private api: InsightsApi, private analyzer: InsightsAnalyzer) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): InsightsSnapshot => this.snapshot;

  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return;
    this.abort?.abort();
    this.userId = userId;
    this.generation += 1;
    this.dictations = [];
    if (!userId) {
      this.publish(EMPTY);
      return;
    }
    await this.reload();
  }

  async reload(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "loading", progress: null, error: null });
    try {
      const [dictations, runs, candidates] = await Promise.all([
        this.api.listDictations(userId),
        this.api.listRuns(userId),
        this.api.listCandidates(userId),
      ]);
      if (generation !== this.generation) return;
      this.dictations = dictations;
      this.publishReady(runs, candidates);
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({ ...this.snapshot, status: "error", error: messageOf(error), progress: null });
    }
  }

  async analyze(knowledge: InsightsKnowledgeInput): Promise<void> {
    const userId = this.userId;
    if (!userId) throw new Error("Sign in to analyze Insights.");
    const previous = this.snapshot.runs[0] ?? null;
    const readiness = insightReadiness(this.dictations, previous);
    if (!readiness.ready) throw new Error(readiness.reason);

    const eligible = eligibleDictations(this.dictations, previous);
    if (!eligible.length) throw new Error("There are no older dictations ready to analyze.");

    const controller = new AbortController();
    this.abort?.abort();
    this.abort = controller;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "analyzing", error: null, progress: "Preparing dictations…" });

    try {
      const chunks = chunkDictations(eligible);
      const partials: unknown[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        this.publish({ ...this.snapshot, status: "analyzing", error: null, progress: `Analyzing batch ${index + 1} of ${chunks.length}…` });
        partials.push(await this.analyzer.analyzeChunk(chunks[index]!, controller.signal));
      }
      const facts = usageFacts(eligible);
      this.publish({ ...this.snapshot, status: "analyzing", error: null, progress: "Building your voice profile…" });
      const merged = await this.analyzer.merge(mergeInput(previous, partials, facts, knowledge), controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;

      const seen = new Set(this.snapshot.candidates.map((item) => item.fingerprint));
      const existing: ExistingKnowledge = { ...knowledge, seenFingerprints: seen };
      const proposed = merged.candidates
        .filter((item) => item.evidenceCount >= 5)
        .map((item): ProposedCandidate => ({
          kind: item.kind,
          title: item.title,
          payload: item.payload,
          evidenceCount: item.evidenceCount,
          confidence: item.confidence,
          reason: item.reason,
        }));
      const candidates = uniqueNewCandidates(proposed, existing);
      const oldest = eligible[eligible.length - 1]!;
      const newest = eligible[0]!;

      await this.api.saveRun(userId, {
        sourceFromCreatedAt: oldest.createdAt,
        sourceThroughCreatedAt: newest.createdAt,
        dictationCount: eligible.length,
        wordCount: facts.totalWords,
        activeDays: activeDays(eligible),
        voiceProfile: merged.voiceProfile,
        catchphrases: merged.catchphrases,
        usageFacts: facts,
        candidates,
      });
      if (generation !== this.generation) return;
      await this.reload();
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      this.publish({ ...this.snapshot, status: "error", progress: null, error: messageOf(error) });
      throw error;
    } finally {
      if (this.abort === controller) this.abort = null;
    }
  }

  cancelAnalysis(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.userId) this.publishReady(this.snapshot.runs, this.snapshot.candidates);
  }

  async setCandidateStatus(id: string, status: InsightCandidate["status"]): Promise<void> {
    await this.api.setCandidateStatus(id, status);
    this.publish({
      ...this.snapshot,
      candidates: this.snapshot.candidates.map((item) => item.id === id ? { ...item, status } : item),
      error: null,
    });
  }

  async compact(runId: string): Promise<number> {
    const userId = this.userId;
    if (!userId) throw new Error("Sign in to compact dictations.");
    this.publish({ ...this.snapshot, status: "compacting", error: null, progress: "Compacting analyzed dictations…" });
    try {
      const removed = await this.api.compact(userId, runId, INSIGHTS_KEEP_RECENT);
      await this.reload();
      return removed;
    } catch (error) {
      this.publish({ ...this.snapshot, status: "error", error: messageOf(error), progress: null });
      throw error;
    }
  }

  private publishReady(runs: InsightRun[], candidates: InsightCandidate[]) {
    const readiness = insightReadiness(this.dictations, runs[0] ?? null);
    this.publish({
      status: "ready",
      dictationCount: this.dictations.length,
      runs,
      candidates,
      readiness,
      currentUsageFacts: usageFacts(this.dictations),
      progress: null,
      error: null,
    });
  }

  private publish(next: InsightsSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
