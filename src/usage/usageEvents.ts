import type { PlatformName } from "@/platform/PlatformAdapter";
import type { DictationSnapshot } from "@/voice/session/DictationController";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

/**
 * How an utterance was started. Set at the call site, then copied onto the
 * start event. The state transition does not choose this.
 */
export type UsageTrigger =
  | "ui-button"
  | "shortcut-dictate"
  | "shortcut-note"
  | "shortcut-handoff"
  | "overlay"
  | "android-floating-mic";

export const USAGE_TRIGGERS: readonly UsageTrigger[] = [
  "ui-button",
  "shortcut-dictate",
  "shortcut-note",
  "shortcut-handoff",
  "overlay",
  "android-floating-mic",
];

export type UsageFeature =
  | "selection_captured"
  | "voice_note_created"
  | "handoff_created"
  | "history_inserted"
  | "shared_clipboard";

export const USAGE_FEATURES: readonly UsageFeature[] = [
  "selection_captured",
  "voice_note_created",
  "handoff_created",
  "history_inserted",
  "shared_clipboard",
];

export const DESTINATION_IDS: readonly TranscriptDestinationId[] = ["active-field", "voice-note", "remote-dictation"];

/** Rollup schema. Later Personal Insights can tell this shape from a newer one. */
export const COUNTERS_VERSION = 1;

/** Fastest and slowest ignore shorter utterances so a two-word phrase cannot win. */
export const WPM_MIN_RECORDING_MS = 3_000;
export const WPM_MIN_WORDS = 8;

export const CLEAN_DAY_KEEP = 90;

/** A day stores at most this many named applications. Further apps fold into `other`. */
export const TARGET_APP_LIMIT = 40;

export const OTHER_TARGET_APP = "other";

const TARGET_APP_ID = /^[a-z0-9._-]+$/;

export interface TargetAppCount {
  label: string;
  count: number;
  words: number;
}

export interface UsageCounters {
  version: typeof COUNTERS_VERSION;
  dictationStarted: number;
  dictationCompleted: number;
  dictationFailed: number;
  recoveryUsed: number;
  /** Finalized transcript tokens, after SMART cleanup. */
  outputWords: number;
  longestWords: number;
  /** Output words from utterances that had a measured recording interval. */
  wpmWords: number;
  /** First captured microphone chunk until recording stopped. */
  recordingMs: number;
  /** Press until the destination finished. Includes transcription and delivery. */
  completionMs: number;
  fastestWpm: number | null;
  slowestWpm: number | null;
  destinations: Record<TranscriptDestinationId, number>;
  triggers: Record<UsageTrigger, number>;
  features: Record<UsageFeature, number>;
  /** Completed dictations by local hour, index 0–23. */
  hours: number[];
  /** Lowercased dictionary term → appearances. */
  terms: Record<string, number>;
  /** File or package name → pastes into that application. */
  targetApps: Record<string, TargetAppCount>;
}

export interface UsageDay {
  day: string;
  epoch: number;
  revision: number;
  updatedAt: string;
  dirty: boolean;
  counters: UsageCounters;
}

/** A row read from `usage_days`. It has no dirty flag. */
export interface RemoteUsageDay {
  deviceId: string;
  day: string;
  epoch: number;
  revision: number;
  updatedAt: string;
  counters: UsageCounters;
}

/** Undated PV17 blob. Shown apart from week and month totals. */
export interface LegacyUsage {
  dictationCompleted: number;
  durationMs: number;
}

export interface UsageSnapshot {
  platform: PlatformName;
  epoch: number;
  days: UsageDay[];
  /** Last fetched server rows, before this device's local days replace their matches. */
  remote: RemoteUsageDay[];
  legacy: LegacyUsage | null;
  error: string | null;
  /** False while this sign-in is still adopting server revisions. */
  ready: boolean;
}

export type UsageEvent =
  | { name: "dictation_started"; trigger: UsageTrigger | null }
  | {
    name: "dictation_completed";
    outputWords: number;
    completionMs: number;
    recordingMs: number | null;
    termUses: Record<string, number>;
  }
  | { name: "dictation_failed" }
  | { name: "recovery_used" }
  | { name: "destination_used"; destination: TranscriptDestinationId }
  | { name: "selection_captured" }
  | { name: "voice_note_created" }
  | { name: "handoff_created" }
  | { name: "history_inserted" }
  | { name: "shared_clipboard" }
  | { name: "target_app"; appId: string; appLabel: string; words: number };

export function emptyDestinations(): Record<TranscriptDestinationId, number> {
  return { "active-field": 0, "voice-note": 0, "remote-dictation": 0 };
}

export function emptyTriggers(): Record<UsageTrigger, number> {
  return {
    "ui-button": 0,
    "shortcut-dictate": 0,
    "shortcut-note": 0,
    "shortcut-handoff": 0,
    overlay: 0,
    "android-floating-mic": 0,
  };
}

export function emptyFeatures(): Record<UsageFeature, number> {
  return {
    selection_captured: 0,
    voice_note_created: 0,
    handoff_created: 0,
    history_inserted: 0,
    shared_clipboard: 0,
  };
}

export function emptyCounters(): UsageCounters {
  return {
    version: COUNTERS_VERSION,
    dictationStarted: 0,
    dictationCompleted: 0,
    dictationFailed: 0,
    recoveryUsed: 0,
    outputWords: 0,
    longestWords: 0,
    wpmWords: 0,
    recordingMs: 0,
    completionMs: 0,
    fastestWpm: null,
    slowestWpm: null,
    destinations: emptyDestinations(),
    triggers: emptyTriggers(),
    features: emptyFeatures(),
    hours: Array.from({ length: 24 }, () => 0),
    terms: {},
    targetApps: {},
  };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function rate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isTrigger(value: string): value is UsageTrigger {
  return (USAGE_TRIGGERS as readonly string[]).includes(value);
}

function isFeature(value: string): value is UsageFeature {
  return (USAGE_FEATURES as readonly string[]).includes(value);
}

function isDestination(value: string): value is TranscriptDestinationId {
  return (DESTINATION_IDS as readonly string[]).includes(value);
}

/** File or package name only. A path loses its directories. A window title does not match. */
export function normalizeTargetAppId(raw: string): string | null {
  const file = raw.trim().split(/[/\\]/).pop()?.trim() ?? "";
  const id = file.toLocaleLowerCase();
  if (!id || id.length > 120 || !TARGET_APP_ID.test(id)) return null;
  return id;
}

function targetLabel(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned || fallback.slice(0, 60);
}

function rememberTargetApp(apps: Record<string, TargetAppCount>, id: string, label: string, words: number): void {
  const existing = apps[id];
  if (existing) {
    existing.count += 1;
    existing.words += words;
    if (label) existing.label = label;
    return;
  }
  const named = Object.keys(apps).filter((key) => key !== OTHER_TARGET_APP).length;
  const key = id === OTHER_TARGET_APP || named >= TARGET_APP_LIMIT ? OTHER_TARGET_APP : id;
  const current = apps[key] ?? { label: key === OTHER_TARGET_APP ? "Other" : label, count: 0, words: 0 };
  current.count += 1;
  current.words += words;
  if (key !== OTHER_TARGET_APP && label) current.label = label;
  apps[key] = current;
}

function parseTargetApps(value: unknown): Record<string, TargetAppCount> {
  const apps: Record<string, TargetAppCount> = {};
  if (typeof value !== "object" || value === null) return apps;
  for (const [rawId, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = normalizeTargetAppId(rawId);
    if (!id) continue;
    const fields = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const observed = count(fields.count);
    if (observed <= 0) continue;
    const current = apps[id] ?? { label: targetLabel(typeof fields.label === "string" ? fields.label : "", id), count: 0, words: 0 };
    current.count += observed;
    current.words += count(fields.words);
    current.label = targetLabel(typeof fields.label === "string" ? fields.label : current.label, id);
    apps[id] = current;
  }
  return capTargetApps(apps);
}

function capTargetApps(apps: Record<string, TargetAppCount>): Record<string, TargetAppCount> {
  const named = Object.entries(apps)
    .filter(([id]) => id !== OTHER_TARGET_APP)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  if (named.length <= TARGET_APP_LIMIT) return apps;
  const kept: Record<string, TargetAppCount> = {};
  for (const [id, stat] of named.slice(0, TARGET_APP_LIMIT)) kept[id] = stat;
  const folded = apps[OTHER_TARGET_APP] ? { ...apps[OTHER_TARGET_APP] } : { label: "Other", count: 0, words: 0 };
  for (const [, stat] of named.slice(TARGET_APP_LIMIT)) {
    folded.count += stat.count;
    folded.words += stat.words;
  }
  if (folded.count > 0) kept[OTHER_TARGET_APP] = folded;
  return kept;
}

/** Accepts a stored counters object. Unknown text fields are dropped. */
export function parseCounters(value: unknown): UsageCounters {
  const fields = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const destinations = emptyDestinations();
  const destinationSource = typeof fields.destinations === "object" && fields.destinations !== null
    ? fields.destinations as Record<string, unknown>
    : {};
  for (const id of DESTINATION_IDS) destinations[id] = count(destinationSource[id]);
  // Pre-Remote-Dictation counters used send-to-device for immediate device delivery.
  destinations["remote-dictation"] += count(destinationSource["send-to-device"]);
  const triggers = emptyTriggers();
  const triggerSource = typeof fields.triggers === "object" && fields.triggers !== null
    ? fields.triggers as Record<string, unknown>
    : {};
  for (const id of USAGE_TRIGGERS) triggers[id] = count(triggerSource[id]);
  const features = emptyFeatures();
  const featureSource = typeof fields.features === "object" && fields.features !== null
    ? fields.features as Record<string, unknown>
    : {};
  for (const id of USAGE_FEATURES) features[id] = count(featureSource[id]);
  const hours = Array.from({ length: 24 }, () => 0);
  if (Array.isArray(fields.hours)) {
    for (let hour = 0; hour < 24; hour += 1) hours[hour] = count(fields.hours[hour]);
  }
  const terms: Record<string, number> = {};
  if (typeof fields.terms === "object" && fields.terms !== null) {
    for (const [term, uses] of Object.entries(fields.terms as Record<string, unknown>)) {
      if (!term || term.length > 100) continue;
      const observed = count(uses);
      if (observed > 0) terms[term] = observed;
    }
  }
  return {
    version: COUNTERS_VERSION,
    dictationStarted: count(fields.dictationStarted),
    dictationCompleted: count(fields.dictationCompleted),
    dictationFailed: count(fields.dictationFailed),
    recoveryUsed: count(fields.recoveryUsed),
    outputWords: count(fields.outputWords),
    longestWords: count(fields.longestWords),
    wpmWords: count(fields.wpmWords),
    recordingMs: count(fields.recordingMs),
    completionMs: count(fields.completionMs),
    fastestWpm: rate(fields.fastestWpm),
    slowestWpm: rate(fields.slowestWpm),
    destinations,
    triggers,
    features,
    hours,
    terms,
    targetApps: parseTargetApps(fields.targetApps),
  };
}

export function cloneCounters(counters: UsageCounters): UsageCounters {
  return {
    ...counters,
    destinations: { ...counters.destinations },
    triggers: { ...counters.triggers },
    features: { ...counters.features },
    hours: [...counters.hours],
    terms: { ...counters.terms },
    targetApps: Object.fromEntries(Object.entries(counters.targetApps).map(([id, stat]) => [id, { ...stat }])),
  };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Folds one event into a day's counters. The transcript itself is never stored. */
export function applyUsageEvent(counters: UsageCounters, event: UsageEvent, hour: number): UsageCounters {
  const next = cloneCounters(counters);
  switch (event.name) {
    case "dictation_started":
      next.dictationStarted += 1;
      if (event.trigger && isTrigger(event.trigger)) next.triggers[event.trigger] += 1;
      return next;
    case "dictation_completed": {
      const words = nonNegative(event.outputWords);
      next.dictationCompleted += 1;
      next.outputWords += words;
      next.longestWords = Math.max(next.longestWords, words);
      next.completionMs += nonNegative(event.completionMs);
      const recording = nonNegative(event.recordingMs ?? 0);
      if (recording > 0) {
        next.wpmWords += words;
        next.recordingMs += recording;
        if (recording >= WPM_MIN_RECORDING_MS && words >= WPM_MIN_WORDS) {
          const pace = words / (recording / 60_000);
          next.fastestWpm = next.fastestWpm === null ? pace : Math.max(next.fastestWpm, pace);
          next.slowestWpm = next.slowestWpm === null ? pace : Math.min(next.slowestWpm, pace);
        }
      }
      if (hour >= 0 && hour < 24) {
        const slot = next.hours[hour] ?? 0;
        next.hours[hour] = slot + 1;
      }
      for (const [term, uses] of Object.entries(event.termUses)) {
        const observed = nonNegative(uses);
        if (observed > 0) next.terms[term] = (next.terms[term] ?? 0) + observed;
      }
      return next;
    }
    case "dictation_failed":
      next.dictationFailed += 1;
      return next;
    case "recovery_used":
      next.recoveryUsed += 1;
      return next;
    case "destination_used":
      if (isDestination(event.destination)) next.destinations[event.destination] += 1;
      return next;
    case "selection_captured":
    case "voice_note_created":
    case "handoff_created":
    case "history_inserted":
    case "shared_clipboard":
      if (isFeature(event.name)) next.features[event.name] += 1;
      return next;
    case "target_app": {
      const id = normalizeTargetAppId(event.appId);
      if (!id) return next;
      rememberTargetApp(next.targetApps, id, targetLabel(event.appLabel, id), nonNegative(event.words));
      return next;
    }
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled usage event: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Dictation start/fail from snapshot transitions. Completions come from timings, not here. */
export function usageEventsFromDictation(
  previous: Pick<DictationSnapshot, "state" | "utterance">,
  next: Pick<DictationSnapshot, "state" | "utterance">,
  trigger: UsageTrigger | null,
): UsageEvent[] {
  const events: UsageEvent[] = [];
  if (next.utterance > previous.utterance) events.push({ name: "dictation_started", trigger });
  if (next.state === "ERROR" && previous.state !== "ERROR") events.push({ name: "dictation_failed" });
  return events;
}

export function averageWpm(wpmWords: number, recordingMs: number): number | null {
  if (recordingMs <= 0 || wpmWords < 0) return null;
  return wpmWords / (recordingMs / 60_000);
}
