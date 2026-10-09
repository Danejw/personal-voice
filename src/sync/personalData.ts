import type { TranscriptionPreferences } from "@/voice/provider/VoiceProvider";

/** Settings that follow the account across devices. Per-device preferences stay on the device. */
export interface SyncedSettings {
  smartTranscription: boolean;
  /** BCP-47 code, or `null` for automatic detection. */
  language: string | null;
  /** When false, this device stops recording usage counters. The preference syncs. */
  usageIntelligence: boolean;
  /** When true, finalized dictation text is stored on the account. Off until the user opts in. */
  cloudDictationHistory: boolean;
  /**
   * When true, finalized Assistant user lines saved after the switch may become memories.
   * Enabled for new accounts. Existing users retain their saved preference.
   * This is not consent to read dictation history.
   */
  assistantMemoryLearning: boolean;
  /**
   * Server-owned analytics generation. Loads may read it. `saveSettings` must not write it.
   * A missing settings row means `0`.
   */
  usageEpoch: number;
}

export interface DictionaryTerm {
  id: string;
  term: string;
  enabled: boolean;
  /** When this term was added; older cached copies may not include it. */
  createdAt?: string;
}

export interface PersonalData {
  settings: SyncedSettings;
  terms: DictionaryTerm[];
}

export const DEFAULT_SETTINGS: SyncedSettings = {
  smartTranscription: true,
  language: null,
  usageIntelligence: true,
  usageEpoch: 0,
  cloudDictationHistory: false,
  assistantMemoryLearning: true,
};
export const EMPTY_PERSONAL_DATA: PersonalData = { settings: DEFAULT_SETTINGS, terms: [] };

/** Mirrors the `enforce_dictionary_limit` trigger and `dictionary.term` check in the migration. */
export const MAX_TERMS = 200;
export const MAX_TERM_LENGTH = 100;
/** Gemini accepts more, but recognition is best with about 100 terms, so the active list stays curated. */
export const MAX_ENABLED_TERMS = 100;

/** Mirrors the `settings.language` check constraint. */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export const LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "es-US", label: "Spanish (US)" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
  { value: "it-IT", label: "Italian" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ja-JP", label: "Japanese" },
  { value: "ko-KR", label: "Korean" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
  { value: "hi-IN", label: "Hindi" },
] as const;

export function isLanguageCode(value: string): boolean {
  return LANGUAGE_CODE.test(value);
}

/** Trims and collapses inner whitespace so `" Super  base "` and `"Super base"` are the same term. */
export function normalizeTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Case-insensitive, matching the `(user_id, lower(term))` unique index. */
function sameTerm(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function enabledCount(terms: DictionaryTerm[]): number {
  return terms.filter((entry) => entry.enabled).length;
}

/** Returns why `term` (already normalized) can't be added, or `null` if it can. */
export function newTermProblem(term: string, terms: DictionaryTerm[]): string | null {
  if (!term) return "Type a word or phrase first.";
  if (term.length > MAX_TERM_LENGTH) return `Terms can be at most ${MAX_TERM_LENGTH} characters.`;
  if (terms.some((entry) => sameTerm(entry.term, term))) return "That term is already in your dictionary.";
  if (terms.length >= MAX_TERMS) return `Your dictionary is full (${MAX_TERMS} terms). Delete one first.`;
  if (enabledCount(terms) >= MAX_ENABLED_TERMS) return `${MAX_ENABLED_TERMS} terms are already active. Turn one off first.`;
  return null;
}

export function sortTerms(terms: DictionaryTerm[]): DictionaryTerm[] {
  return [...terms].sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

/** Display order only: newest entries first, without changing transcription vocabulary order. */
export function newestTermsFirst(terms: DictionaryTerm[]): DictionaryTerm[] {
  const created = (entry: DictionaryTerm) => {
    const value = Date.parse(entry.createdAt ?? "");
    return Number.isFinite(value) ? value : 0;
  };
  return [...terms].sort((a, b) => created(b) - created(a)
    || a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

/** What the next transcription session is configured with. */
export function transcriptionPreferences(data: PersonalData): TranscriptionPreferences {
  return {
    smart: data.settings.smartTranscription,
    language: data.settings.language,
    vocabulary: data.terms.filter((entry) => entry.enabled).map((entry) => entry.term).slice(0, MAX_ENABLED_TERMS),
  };
}
