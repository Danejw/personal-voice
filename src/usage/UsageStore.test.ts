import { describe, expect, it } from "vitest";
import { localDayKey } from "@/usage/analytics";
import { emptyCounters } from "@/usage/usageEvents";
import { UsageStore } from "@/usage/UsageStore";
import type { UsageApi, UsageDayWrite } from "@/usage/UsageStore";
import type { RemoteUsageDay } from "@/usage/usageEvents";

function memoryStorage(values = new Map<string, string>()) {
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function day(iso: string, revision: number, deviceId = "dev"): RemoteUsageDay {
  return {
    deviceId,
    day: iso,
    epoch: 0,
    revision,
    updatedAt: `${iso}T00:00:00.000Z`,
    counters: emptyCounters(),
  };
}

describe("UsageStore", () => {
  it("persists daily rollups and ignores collection while disabled", () => {
    const storage = memoryStorage();
    const now = new Date("2026-09-28T15:00:00");
    const store = new UsageStore(storage, "windows", () => now);
    store.record({ name: "selection_captured" });
    expect(store.getSnapshot().days[0]?.counters.features.selection_captured).toBe(1);
    expect(JSON.parse(storage.values.get("usage.days.v1") ?? "{}").version).toBe(1);

    store.setEnabled(false);
    store.record({ name: "selection_captured" });
    expect(store.getSnapshot().days[0]?.counters.features.selection_captured).toBe(1);

    const reloaded = new UsageStore(storage, "windows", () => now);
    expect(reloaded.getSnapshot().days[0]?.counters.features.selection_captured).toBe(1);
  });

  it("never throws when storage fails", () => {
    const store = new UsageStore({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    }, "android");
    expect(() => store.record({ name: "handoff_created" })).not.toThrow();
    expect(store.getSnapshot().days[0]?.counters.features.handoff_created).toBe(1);
    expect(store.getSnapshot().error).toBe("Usage totals could not be saved on this device.");
  });

  it("keeps an older undated blob out of the dated days", () => {
    const storage = memoryStorage();
    storage.setItem("usage.totals.v1", JSON.stringify({
      version: 1,
      totals: { dictation_completed: 4, durationMsTotal: 10, text: "secret transcript" },
    }));
    const store = new UsageStore(storage, "windows");
    expect(store.getSnapshot().legacy).toEqual({ dictationCompleted: 4, durationMs: 10 });
    expect(store.getSnapshot().days).toEqual([]);
    expect(JSON.stringify(store.getSnapshot())).not.toContain("secret");
  });

  it("adopts a remote revision instead of starting the day again at 1", () => {
    const now = new Date("2026-09-28T15:00:00");
    const store = new UsageStore(memoryStorage(), "windows", () => now);
    store.beginBootstrap(0, "dev");
    store.adoptRemote([day("2026-09-28", 40)]);
    store.record({ name: "selection_captured" });
    expect(store.getSnapshot().days[0]?.revision).toBe(41);
  });

  it("keeps a dirty local day when the remote revision is higher", () => {
    const now = new Date("2026-09-28T15:00:00");
    const store = new UsageStore(memoryStorage(), "windows", () => now);
    store.record({ name: "selection_captured" });
    store.beginBootstrap(0, "dev");
    store.adoptRemote([day("2026-09-28", 40)]);
    const local = store.getSnapshot().days.find((entry) => entry.day === "2026-09-28");
    expect(local?.revision).toBe(1);
    expect(local?.dirty).toBe(true);
  });

  it("drops other epochs and does not upload them", async () => {
    const sent: UsageDayWrite[] = [];
    const api: UsageApi = {
      upsertDay: (entry) => { sent.push(entry); return Promise.resolve(); },
      clear: () => Promise.resolve(3),
      fetchDays: () => Promise.resolve([]),
    };
    const now = new Date("2026-09-28T15:00:00");
    const store = new UsageStore(memoryStorage(), "windows", () => now, api, 60_000);
    store.beginBootstrap(0, "dev");
    store.adoptRemote([]);
    store.record({ name: "selection_captured" });
    await store.clearAnalytics();
    expect(store.getSnapshot().epoch).toBe(3);
    expect(store.getSnapshot().days).toEqual([]);
    expect(sent).toEqual([]);
    expect(store.getSnapshot().legacy).toBeNull();
  });

  it("sends a newer snapshot after an older in-flight upsert, never the other way around", async () => {
    const sent: number[] = [];
    let release: () => void = () => {};
    const api: UsageApi = {
      upsertDay: (entry) => {
        sent.push(entry.revision);
        if (entry.revision === 1) return new Promise((resolve) => { release = resolve; });
        return Promise.resolve();
      },
      clear: () => Promise.resolve(1),
      fetchDays: () => Promise.resolve([]),
    };
    const now = new Date("2026-09-28T15:00:00");
    const store = new UsageStore(memoryStorage(), "windows", () => now, api, 60_000);
    store.beginBootstrap(0, "dev");
    store.adoptRemote([]);
    store.record({ name: "selection_captured" });
    const first = store.flushNow();
    store.record({ name: "handoff_created" });
    release();
    await first;
    await store.flushNow();
    expect(sent).toEqual([1, 2]);
  });

  it("prunes clean days beyond the newest 90 and keeps a dirty day", () => {
    const store = new UsageStore(memoryStorage(), "windows", () => new Date("2026-09-28T15:00:00"));
    store.beginBootstrap(0, "dev");
    const rows: RemoteUsageDay[] = [];
    for (let index = 0; index < 91; index += 1) {
      const date = new Date(2024, 0, 1);
      date.setDate(date.getDate() + index);
      rows.push(day(localDayKey(date), 1));
    }
    store.adoptRemote(rows);
    expect(store.getSnapshot().days).toHaveLength(90);
    store.record({ name: "selection_captured" });
    const dirty = store.getSnapshot().days.find((entry) => entry.dirty);
    expect(dirty?.day).toBe("2026-09-28");
    expect(store.getSnapshot().days.length).toBeLessThanOrEqual(91);
  });
});
