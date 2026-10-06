import type { DictationRecord } from "@/history/dictation";

export const INSIGHTS_KEEP_RECENT = 50;
export const FIRST_RUN_MIN_DICTATIONS = 200;
export const FIRST_RUN_MIN_ACTIVE_DAYS = 3;
export const REFRESH_NEW_DICTATIONS = 250;
export const REFRESH_MIN_DICTATIONS_AFTER_WEEK = 100;
export const REFRESH_DAYS = 7;

export type InsightCandidateKind = "dictionary" | "snippet" | "transform" | "memory";
export type InsightCandidateStatus = "pending" | "accepted" | "dismissed" | "duplicate";
export type InsightConfidence = "high" | "medium";

export interface CatchphraseInsight {
  text: string;
  count: number;
}

export interface InsightUsageFacts {
  peakDay: string | null;
  peakHourStart: number | null;
  peakHourEnd: number | null;
  peakDeviceId: string | null;
  peakDeviceShare: number | null;
  averageWords: number;
  totalWords: number;
}

export interface InsightRun {
  id: string;
  sourceFromCreatedAt: string;
  sourceThroughCreatedAt: string;
  dictationCount: number;
  wordCount: number;
  activeDays: number;
  voiceProfile: string;
  catchphrases: CatchphraseInsight[];
  usageFacts: InsightUsageFacts;
  createdAt: string;
  compactedAt: string | null;
  compactedCount: number;
}

export interface InsightCandidate {
  id: string;
  runId: string;
  kind: InsightCandidateKind;
  fingerprint: string;
  title: string;
  payload: Record<string, unknown>;
  evidenceCount: number;
  confidence: InsightConfidence;
  reason: string;
  status: InsightCandidateStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InsightReadiness {
  ready: boolean;
  reason: string;
  totalDictations: number;
  activeDays: number;
  newSinceLastRun: number;
  eligibleForAnalysis: number;
}

function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function activeDayCount(rows: readonly DictationRecord[]): number {
  return new Set(rows.map((row) => localDay(row.createdAt)).filter(Boolean)).size;
}

export function eligibleDictations(
  rowsNewestFirst: readonly DictationRecord[],
  lastRun: InsightRun | null,
): DictationRecord[] {
  const agedOut = rowsNewestFirst.slice(INSIGHTS_KEEP_RECENT);
  if (!lastRun) return agedOut;
  return agedOut.filter((row) => row.createdAt > lastRun.sourceThroughCreatedAt);
}

export function insightReadiness(
  rowsNewestFirst: readonly DictationRecord[],
  lastRun: InsightRun | null,
  now = new Date(),
): InsightReadiness {
  const totalDictations = rowsNewestFirst.length;
  const activeDays = activeDayCount(rowsNewestFirst);
  const eligible = eligibleDictations(rowsNewestFirst, lastRun);
  const newSinceLastRun = lastRun
    ? rowsNewestFirst.filter((row) => row.createdAt > lastRun.sourceThroughCreatedAt).length
    : totalDictations;

  if (!lastRun) {
    const ready = totalDictations >= FIRST_RUN_MIN_DICTATIONS && activeDays >= FIRST_RUN_MIN_ACTIVE_DAYS;
    const reason = ready
      ? `${eligible.length} older dictations are ready to analyze.`
      : totalDictations < FIRST_RUN_MIN_DICTATIONS
        ? `Insights starts after ${FIRST_RUN_MIN_DICTATIONS} synced dictations across at least ${FIRST_RUN_MIN_ACTIVE_DAYS} active days.`
        : `Use Personal Voice on at least ${FIRST_RUN_MIN_ACTIVE_DAYS} active days before the first profile.`;
    return { ready, reason, totalDictations, activeDays, newSinceLastRun, eligibleForAnalysis: eligible.length };
  }

  const daysSince = Math.max(0, (now.getTime() - new Date(lastRun.createdAt).getTime()) / 86_400_000);
  const ready = eligible.length > 0 && (
    newSinceLastRun >= REFRESH_NEW_DICTATIONS
    || (daysSince >= REFRESH_DAYS && newSinceLastRun >= REFRESH_MIN_DICTATIONS_AFTER_WEEK)
  );
  const reason = ready
    ? `${eligible.length} new older dictations are ready to analyze.`
    : `Next refresh at ${REFRESH_NEW_DICTATIONS} new dictations, or after ${REFRESH_DAYS} days with at least ${REFRESH_MIN_DICTATIONS_AFTER_WEEK} new dictations.`;
  return { ready, reason, totalDictations, activeDays, newSinceLastRun, eligibleForAnalysis: eligible.length };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function usageFacts(rows: readonly DictationRecord[]): InsightUsageFacts {
  if (!rows.length) {
    return {
      peakDay: null,
      peakHourStart: null,
      peakHourEnd: null,
      peakDeviceId: null,
      peakDeviceShare: null,
      averageWords: 0,
      totalWords: 0,
    };
  }

  const dayCounts = Array.from({ length: 7 }, () => 0);
  const hourCounts = Array.from({ length: 24 }, () => 0);
  const deviceCounts = new Map<string, number>();
  let totalWords = 0;

  for (const row of rows) {
    const date = new Date(row.createdAt);
    if (!Number.isNaN(date.getTime())) {
      dayCounts[date.getDay()] = (dayCounts[date.getDay()] ?? 0) + 1;
      hourCounts[date.getHours()] = (hourCounts[date.getHours()] ?? 0) + 1;
    }
    deviceCounts.set(row.sourceDeviceId, (deviceCounts.get(row.sourceDeviceId) ?? 0) + 1);
    totalWords += countWords(row.text);
  }

  let peakDayIndex = 0;
  for (let index = 1; index < dayCounts.length; index += 1) {
    if ((dayCounts[index] ?? 0) > (dayCounts[peakDayIndex] ?? 0)) peakDayIndex = index;
  }

  let peakHourStart = 0;
  let peakHourCount = -1;
  for (let start = 0; start < 24; start += 1) {
    const count = (hourCounts[start] ?? 0) + (hourCounts[(start + 1) % 24] ?? 0) + (hourCounts[(start + 2) % 24] ?? 0);
    if (count > peakHourCount) {
      peakHourCount = count;
      peakHourStart = start;
    }
  }

  const peakDevice = [...deviceCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  return {
    peakDay: WEEKDAYS[peakDayIndex] ?? null,
    peakHourStart,
    peakHourEnd: (peakHourStart + 3) % 24,
    peakDeviceId: peakDevice?.[0] ?? null,
    peakDeviceShare: peakDevice ? Math.round((peakDevice[1] / rows.length) * 100) : null,
    averageWords: Math.round(totalWords / rows.length),
    totalWords,
  };
}

export function countWords(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    let count = 0;
    for (const item of segmenter.segment(clean)) if (item.isWordLike) count += 1;
    return count;
  }
  return clean.split(/\s+/).filter(Boolean).length;
}

export function formatHour(hour: number | null): string {
  if (hour === null) return "–";
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? "PM" : "AM";
  const clock = normalized % 12 || 12;
  return `${clock} ${suffix}`;
}

/**
 * Batches text without splitting one dictation across requests. Oversized single rows
 * are clipped only for semantic analysis; the raw stored dictation is never changed.
 */
export function chunkDictations(rows: readonly DictationRecord[], maxChars = 24_000): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const [index, row] of rows.entries()) {
    const body = row.text.length > maxChars - 200 ? row.text.slice(0, maxChars - 200) : row.text;
    const next = `[${index + 1}] ${body.trim()}\n\n`;
    if (current && current.length + next.length > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    current += next;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
