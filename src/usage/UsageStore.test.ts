import { describe, expect, it } from "vitest";
import { UsageStore } from "@/usage/UsageStore";

function memoryStorage(values = new Map<string, string>()) {
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("UsageStore", () => {
  it("persists aggregates and ignores collection while disabled", () => {
    const storage = memoryStorage();
    const store = new UsageStore(storage, "windows");
    store.record({ name: "selection_captured" });
    expect(store.getSnapshot().totals.selection_captured).toBe(1);
    expect(JSON.parse(storage.values.get("usage.totals.v1") ?? "{}")).toMatchObject({
      version: 1,
      platform: "windows",
      totals: { selection_captured: 1 },
    });

    store.setEnabled(false);
    store.record({ name: "dictation_started" });
    expect(store.getSnapshot().totals.dictation_started).toBe(0);

    const reloaded = new UsageStore(storage, "windows");
    expect(reloaded.getSnapshot().totals.selection_captured).toBe(1);
  });

  it("never throws when storage fails", () => {
    const store = new UsageStore({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    }, "android");
    expect(() => store.record({ name: "handoff_created" })).not.toThrow();
    expect(store.getSnapshot().totals.handoff_created).toBe(1);
    expect(store.getSnapshot().error).toBe("Usage totals could not be saved on this device.");
  });

  it("drops a stored text field if one were ever written", () => {
    const storage = memoryStorage();
    storage.setItem("usage.totals.v1", JSON.stringify({
      version: 1,
      totals: { dictation_completed: 4, text: "secret transcript" },
    }));
    const store = new UsageStore(storage, "windows");
    expect(store.getSnapshot().totals.dictation_completed).toBe(4);
    expect(JSON.stringify(store.getSnapshot())).not.toContain("secret");
  });
});
