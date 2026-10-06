import { describe, expect, it } from "vitest";
import { readPersonalCache, writePersonalCache } from "@/sync/personalCache";
import type { KeyValueStorage } from "@/sync/personalCache";
import {
  DEFAULT_SETTINGS, MAX_ENABLED_TERMS, isLanguageCode, newTermProblem, newestTermsFirst, normalizeTerm, transcriptionPreferences,
} from "@/sync/personalData";
import { syncErrorMessage } from "@/services/personalSyncService";
import { geminiConfigFrom, setupMessage } from "@/voice/provider/gemini/GeminiProvider";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe("dictionary rules", () => {
  it("normalizes whitespace but keeps the user's casing", () => {
    expect(normalizeTerm("  model_pricing_skus ")).toBe("model_pricing_skus");
    expect(normalizeTerm("Generation \t Plan")).toBe("Generation Plan");
  });

  it("treats terms that differ only by case as duplicates", () => {
    expect(newTermProblem("UFIQ", [{ id: "1", term: "ufiq", enabled: false }])).toBe("That term is already in your dictionary.");
  });

  it("shows newest dictionary terms first without mutating their original order", () => {
    const terms = [
      { id: "old", term: "Zebra", enabled: true, createdAt: "2026-01-10T10:00:00Z" },
      { id: "new", term: "Alpha", enabled: true, createdAt: "2026-02-10T10:00:00Z" },
      { id: "middle", term: "Beta", enabled: true, createdAt: "2026-01-20T10:00:00Z" },
    ];
    expect(newestTermsFirst(terms).map((entry) => entry.term)).toEqual(["Alpha", "Beta", "Zebra"]);
    expect(terms.map((entry) => entry.term)).toEqual(["Zebra", "Alpha", "Beta"]);
  });

  it("caps the vocabulary sent to the provider at the curated limit", () => {
    const terms = Array.from({ length: MAX_ENABLED_TERMS + 5 }, (_, index) => ({ id: `${index}`, term: `t${index}`, enabled: true }));
    const preferences = transcriptionPreferences({ settings: DEFAULT_SETTINGS, terms });
    expect(preferences.vocabulary).toHaveLength(MAX_ENABLED_TERMS);
  });

  it("accepts the language codes the database accepts", () => {
    expect(isLanguageCode("en-US")).toBe(true);
    expect(isLanguageCode("fil")).toBe(true);
    expect(isLanguageCode("English")).toBe(false);
  });
});

describe("Gemini configuration from synced preferences", () => {
  it("sends enabled terms as customVocabulary with the chosen mode and language", () => {
    const config = geminiConfigFrom({ smart: false, language: "es-ES", vocabulary: ["Persyn", "Supabase"] });
    expect(setupMessage(config).setup.inputAudioTranscription).toEqual({
      mode: "VERBATIM",
      languageCodes: ["es-ES"],
      customVocabulary: ["Persyn", "Supabase"],
    });
  });

  it("uses automatic language detection and omits an empty vocabulary", () => {
    const config = geminiConfigFrom({ smart: true, language: null, vocabulary: [] });
    expect(setupMessage(config).setup.inputAudioTranscription).toEqual({ mode: "SMART", languageCodes: [] });
  });
});

describe("personal cache", () => {
  it("round-trips per account", () => {
    const storage = memoryStorage();
    const data = { settings: { ...DEFAULT_SETTINGS, smartTranscription: false, language: "ja-JP" }, terms: [{ id: "1", term: "Runware", enabled: true }] };
    writePersonalCache(storage, "u1", data);
    expect(readPersonalCache(storage, "u1")).toEqual(data);
    expect(readPersonalCache(storage, "u2")).toBeNull();
  });

  it("retains creation timestamps in the offline dictionary cache", () => {
    const storage = memoryStorage();
    const term = { id: "new", term: "New word", enabled: true, createdAt: "2026-10-06T08:00:00Z" };
    writePersonalCache(storage, "u1", { settings: DEFAULT_SETTINGS, terms: [term] });
    expect(readPersonalCache(storage, "u1")?.terms).toEqual([term]);
  });

  it("ignores corrupt or unknown-version entries", () => {
    const storage = memoryStorage();
    storage.setItem("sync.personal.u1", "{not json");
    expect(readPersonalCache(storage, "u1")).toBeNull();
    storage.setItem("sync.personal.u1", JSON.stringify({ version: 99, terms: [] }));
    expect(readPersonalCache(storage, "u1")).toBeNull();
  });

  it("drops malformed terms and invalid languages", () => {
    const storage = memoryStorage();
    storage.setItem("sync.personal.u1", JSON.stringify({
      version: 1,
      settings: { smartTranscription: "yes", language: "not a code" },
      terms: [{ id: "1", term: "Good", enabled: true }, { id: 2, term: "Bad" }],
    }));
    expect(readPersonalCache(storage, "u1")).toEqual({
      settings: DEFAULT_SETTINGS,
      terms: [{ id: "1", term: "Good", enabled: true }],
    });
  });
});

describe("syncErrorMessage", () => {
  it("maps database errors to short messages", () => {
    expect(syncErrorMessage({ code: "23505", message: "duplicate key" })).toBe("That term is already in your dictionary.");
    expect(syncErrorMessage({ code: "P0001", message: "Dictionary is limited to 200 terms." })).toBe("Dictionary is limited to 200 terms.");
    expect(syncErrorMessage({ code: "", message: "TypeError: Failed to fetch" })).toBe("Couldn't reach the sync service. Check your connection.");
    expect(syncErrorMessage({ code: "42501", message: "permission denied" })).toBe("Sign in again to sync.");
  });
});
