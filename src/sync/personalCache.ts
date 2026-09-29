import { DEFAULT_SETTINGS, isLanguageCode } from "@/sync/personalData";
import type { DictionaryTerm, PersonalData } from "@/sync/personalData";

/** Minimal `Storage` surface, so tests can pass an in-memory map. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

const CACHE_VERSION = 1;

function cacheKey(userId: string): string {
  return `sync.personal.${userId}`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function parseTerm(value: unknown): DictionaryTerm | null {
  const fields = record(value);
  return typeof fields.id === "string" && typeof fields.term === "string" && typeof fields.enabled === "boolean"
    ? { id: fields.id, term: fields.term, enabled: fields.enabled }
    : null;
}

/** Last server-confirmed copy for this account, or `null` if missing or unreadable. */
export function readPersonalCache(storage: KeyValueStorage, userId: string): PersonalData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(cacheKey(userId)) ?? "null");
  } catch {
    return null;
  }
  const fields = record(parsed);
  if (fields.version !== CACHE_VERSION || !Array.isArray(fields.terms)) return null;
  const settings = record(fields.settings);
  const language = typeof settings.language === "string" && isLanguageCode(settings.language) ? settings.language : null;
  return {
    settings: {
      smartTranscription: typeof settings.smartTranscription === "boolean" ? settings.smartTranscription : DEFAULT_SETTINGS.smartTranscription,
      language,
      usageIntelligence: typeof settings.usageIntelligence === "boolean" ? settings.usageIntelligence : DEFAULT_SETTINGS.usageIntelligence,
      usageEpoch: typeof settings.usageEpoch === "number" && settings.usageEpoch >= 0 ? Math.floor(settings.usageEpoch) : 0,
    },
    terms: fields.terms.map(parseTerm).filter((entry): entry is DictionaryTerm => entry !== null),
  };
}

export function writePersonalCache(storage: KeyValueStorage, userId: string, data: PersonalData): void {
  storage.setItem(cacheKey(userId), JSON.stringify({ version: CACHE_VERSION, ...data }));
}

/** Stable per account on this install, so switching accounts never collides on a device row. */
export function localDeviceId(storage: KeyValueStorage, userId: string, createId: () => string): string {
  const key = `device.id.${userId}`;
  const existing = storage.getItem(key);
  if (existing) return existing;
  const id = createId();
  storage.setItem(key, id);
  return id;
}
