import { describe, expect, it, vi } from "vitest";
import { DictationHistoryStore } from "@/history/DictationHistoryStore";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("DictationHistoryStore", () => {
  it("keeps only the newest entries up to the retention limit", () => {
    const storage = memoryStorage();
    let tick = 0;
    const store = new DictationHistoryStore(
      storage,
      3,
      () => new Date(Date.UTC(2026, 8, 28, 12, 0, tick++)),
    );

    store.record({ text: "One", destination: "active-field", outcome: "success" });
    store.record({ text: "Two", destination: "voice-note", outcome: "success" });
    store.record({ text: "Three", destination: "send-to-device", outcome: "failure" });
    store.record({ text: "Four", destination: "active-field", outcome: "success" });

    expect(store.getSnapshot().entries.map((entry) => entry.text)).toEqual(["Four", "Three", "Two"]);
    expect(new DictationHistoryStore(storage, 3).getSnapshot().entries).toEqual(store.getSnapshot().entries);
  });

  it("clears persisted history", () => {
    const storage = memoryStorage();
    const store = new DictationHistoryStore(storage);
    store.record({ text: "Recover me.", destination: "active-field", outcome: "failure" });
    expect(store.getSnapshot().entries).toHaveLength(1);

    store.clear();

    expect(store.getSnapshot()).toEqual({ entries: [], error: null });
    expect(new DictationHistoryStore(storage).getSnapshot().entries).toEqual([]);
  });

  it("shows a finished dictation immediately and persists after delivery returns", () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const store = new DictationHistoryStore(storage);
      const seen: string[][] = [];
      store.subscribe(() => seen.push(store.getSnapshot().entries.map((entry) => entry.text)));

      store.recordLater({ text: "Later.", destination: "active-field", outcome: "success" });

      expect(store.getSnapshot().entries[0]?.text).toBe("Later.");
      expect(seen).toEqual([["Later."]]);
      expect(new DictationHistoryStore(storage).getSnapshot().entries).toEqual([]);

      vi.runAllTimers();
      expect(new DictationHistoryStore(storage).getSnapshot().entries[0]?.text).toBe("Later.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a just-finished dictation when storage has not caught up", () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const store = new DictationHistoryStore(storage);
      store.recordLater({ text: "Fresh.", destination: "active-field", outcome: "success" });

      store.reload();

      expect(store.getSnapshot().entries[0]?.text).toBe("Fresh.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reloads a newer entry saved while this view was away", () => {
    const storage = memoryStorage();
    const store = new DictationHistoryStore(storage, 75, () => new Date("2026-09-28T12:00:00.000Z"));
    store.record({ text: "First.", destination: "active-field", outcome: "success" });

    const other = new DictationHistoryStore(storage, 75, () => new Date("2026-09-28T12:05:00.000Z"));
    other.record({ text: "Second.", destination: "voice-note", outcome: "success" });

    store.reload();

    expect(store.getSnapshot().entries.map((entry) => entry.text)).toEqual(["Second.", "First."]);
  });

  it("keeps in-memory recovery available when local persistence fails", () => {
    const store = new DictationHistoryStore({
      getItem: () => null,
      setItem: () => { throw new Error("Storage unavailable."); },
    });

    expect(() => store.record({
      text: "Still visible.",
      destination: "send-to-device",
      outcome: "failure",
    })).not.toThrow();
    expect(store.getSnapshot()).toMatchObject({
      entries: [{ text: "Still visible.", outcome: "failure" }],
      error: "Recent history could not be saved on this device.",
    });
  });
});
