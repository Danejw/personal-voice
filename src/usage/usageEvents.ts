import type { PlatformName } from "@/platform/PlatformAdapter";
import type { DictationSnapshot } from "@/voice/session/DictationController";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

/**
 * Structured usage events. None of these fields may carry transcript text or audio.
 *
 * | Event | When | Extra fields |
 * | --- | --- | --- |
 * | `dictation_started` | A new utterance begins | `platform` |
 * | `dictation_completed` | Destination delivery succeeded | `platform`, `durationMs` |
 * | `dictation_failed` | The utterance ended in ERROR | `platform` |
 * | `recovery_used` | The replay-from-buffer path produced the transcript | `platform` |
 * | `destination_used` | The selected destination accepted the transcript | `platform`, `destination` |
 * | `voice_note_created` | A voice note row was saved | `platform` |
 * | `handoff_created` | A handoff row was saved | `platform` |
 * | `selection_captured` | Highlighted text was captured | `platform` |
 */
export type UsageEventName =
  | "dictation_started"
  | "dictation_completed"
  | "dictation_failed"
  | "recovery_used"
  | "destination_used"
  | "voice_note_created"
  | "handoff_created"
  | "selection_captured";

export type UsageEvent =
  | { name: "dictation_started" }
  | { name: "dictation_completed"; durationMs: number }
  | { name: "dictation_failed" }
  | { name: "recovery_used" }
  | { name: "destination_used"; destination: TranscriptDestinationId }
  | { name: "voice_note_created" }
  | { name: "handoff_created" }
  | { name: "selection_captured" };

export interface UsageTotals {
  dictation_started: number;
  dictation_completed: number;
  dictation_failed: number;
  recovery_used: number;
  destination_used: Record<TranscriptDestinationId, number>;
  voice_note_created: number;
  handoff_created: number;
  selection_captured: number;
  /** Sum of `durationMs` from completed utterances. */
  durationMsTotal: number;
}

export const EMPTY_USAGE_TOTALS: UsageTotals = {
  dictation_started: 0,
  dictation_completed: 0,
  dictation_failed: 0,
  recovery_used: 0,
  destination_used: { "active-field": 0, "voice-note": 0, "send-to-device": 0 },
  voice_note_created: 0,
  handoff_created: 0,
  selection_captured: 0,
  durationMsTotal: 0,
};

export interface UsageSnapshot {
  platform: PlatformName;
  totals: UsageTotals;
  error: string | null;
}

/** Increments counters only. Unknown or malformed extras are ignored. */
export function applyUsageEvent(totals: UsageTotals, event: UsageEvent): UsageTotals {
  const next = cloneTotals(totals);
  switch (event.name) {
    case "dictation_started":
      next.dictation_started += 1;
      return next;
    case "dictation_completed":
      next.dictation_completed += 1;
      next.durationMsTotal += durationMs(event.durationMs);
      return next;
    case "dictation_failed":
      next.dictation_failed += 1;
      return next;
    case "recovery_used":
      next.recovery_used += 1;
      return next;
    case "destination_used":
      next.destination_used[event.destination] += 1;
      return next;
    case "voice_note_created":
      next.voice_note_created += 1;
      return next;
    case "handoff_created":
      next.handoff_created += 1;
      return next;
    case "selection_captured":
      next.selection_captured += 1;
      return next;
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled usage event: ${JSON.stringify(unhandled)}`);
    }
  }
}

function cloneTotals(totals: UsageTotals): UsageTotals {
  return {
    ...totals,
    destination_used: { ...totals.destination_used },
  };
}

function durationMs(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

/** Dictation start/fail from snapshot transitions. Completions come from timings, not here. */
export function usageEventsFromDictation(
  previous: Pick<DictationSnapshot, "state" | "utterance">,
  next: Pick<DictationSnapshot, "state" | "utterance">,
): Array<Extract<UsageEvent, { name: "dictation_started" | "dictation_failed" }>> {
  const events: Array<Extract<UsageEvent, { name: "dictation_started" | "dictation_failed" }>> = [];
  if (next.utterance > previous.utterance) events.push({ name: "dictation_started" });
  if (next.state === "ERROR" && previous.state !== "ERROR") events.push({ name: "dictation_failed" });
  return events;
}
