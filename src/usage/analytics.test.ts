import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAnalytics,
  collectUsagePages,
  deviceLabel,
  heatMapDays,
  insightsFrom,
  longestUsageStreak,
  mergeUsageDays,
  platformUsage,
  sumCounters,
  panelRanges,
  shiftDays,
  usageStreak,
} from "@/usage/analytics";
import { emptyCounters } from "@/usage/usageEvents";
import type { RemoteUsageDay } from "@/usage/usageEvents";
import { settingsFromRow, settingsUpsertRow } from "@/services/personalSyncService";
import { DEFAULT_SETTINGS } from "@/sync/personalData";

function row(day: string, deviceId: string, completed: number, words = 0): RemoteUsageDay {
  const counters = emptyCounters();
  counters.dictationCompleted = completed;
  counters.outputWords = words;
  return {
    deviceId,
    day,
    epoch: 0,
    revision: 1,
    updatedAt: `${day}T00:00:00.000Z`,
    counters,
  };
}

describe("usage pages", () => {
  it("keeps requesting until a short page and does not ask the 14-day view for older days", async () => {
    const seen: { from?: string; to?: string; offset: number }[] = [];
    const rows = await collectUsagePages(async (query) => {
      seen.push(query);
      if (query.offset < 4) return [query.offset, query.offset + 1];
      return [query.offset];
    }, undefined, 2);
    expect(rows).toEqual([0, 1, 2, 3, 4]);
    expect(seen.map((query) => query.offset)).toEqual([0, 2, 4]);

    const rangeCalls: { from?: string; to?: string }[] = [];
    const ranges = panelRanges(new Date(2026, 8, 28, 12));
    await collectUsagePages(async (query) => {
      rangeCalls.push(query);
      return [];
    }, ranges.recent);
    expect(rangeCalls[0]?.from).toBe(shiftDays("2026-09-28", -13));
    expect(rangeCalls[0]?.to).toBe("2026-09-28");
    expect(ranges.month.from).toBe("2026-09-01");
  });

  it("counts a streak that continues across a page boundary", () => {
    const first = [row("2026-09-28", "dev", 1), row("2026-09-27", "dev", 1)];
    const second = [row("2026-09-26", "dev", 1), row("2026-09-24", "dev", 1)];
    expect(usageStreak([...first, ...second], "2026-09-28")).toBe(3);
  });
});

describe("dashboard merge", () => {
  it("replaces this device's remote day with the local snapshot", () => {
    const remote = [row("2026-09-28", "dev", 4, 40), row("2026-09-28", "other", 2, 10)];
    const local = [{
      day: "2026-09-28",
      epoch: 0,
      revision: 5,
      updatedAt: "2026-09-28T00:00:00.000Z",
      dirty: true,
      counters: { ...emptyCounters(), dictationCompleted: 1, outputWords: 7 },
    }];
    const merged = mergeUsageDays(remote, local, "dev");
    const mine = merged.find((entry) => entry.deviceId === "dev");
    const other = merged.find((entry) => entry.deviceId === "other");
    expect(mine?.counters.dictationCompleted).toBe(1);
    expect(other?.counters.dictationCompleted).toBe(2);
    expect(merged.filter((entry) => entry.deviceId === "dev")).toHaveLength(1);
  });

  it("labels a missing device row", () => {
    expect(deviceLabel("gone", [])).toBe("Removed device");
    expect(deviceLabel("desk", [{ id: "desk", name: "Desktop" }])).toBe("Desktop");
  });

  it("stays quiet until there is enough history for a pattern", () => {
    expect(insightsFrom([row("2026-09-28", "dev", 1)], "2026-09-28")).toEqual([]);
  });

  it("adds the same application from two devices and names a dominant one", () => {
    const desk = row("2026-09-28", "desk", 6);
    const phone = row("2026-09-28", "phone", 6);
    desk.counters.targetApps["slack.exe"] = { label: "Slack", count: 5, words: 20 };
    phone.counters.targetApps["slack.exe"] = { label: "Slack", count: 2, words: 8 };
    phone.counters.targetApps["com.whatsapp"] = { label: "WhatsApp", count: 1, words: 3 };
    expect(sumCounters([desk, phone]).targetApps["slack.exe"]).toEqual({ label: "Slack", count: 7, words: 28 });
    expect(insightsFrom([desk], "2026-09-28")).toContain("Most of your pasted transcripts go into Slack.");
  });

  it("splits words between Windows and Android devices", () => {
    const desk = row("2026-09-20", "desk", 4, 80);
    const phone = row("2026-09-21", "phone", 2, 20);
    expect(platformUsage([desk, phone], [
      { id: "desk", name: "PC", platform: "windows" },
      { id: "phone", name: "Phone", platform: "android" },
    ])).toEqual([
      { id: "windows", label: "Windows", count: 80, words: 80, share: 80 },
      { id: "android", label: "Android", count: 20, words: 20, share: 20 },
    ]);
  });

  it("tracks the longest completion streak and builds heatmap days", () => {
    const rows = [
      row("2026-09-20", "desk", 1, 10),
      row("2026-09-21", "desk", 1, 20),
      row("2026-09-22", "desk", 1, 30),
      row("2026-09-25", "desk", 1, 5),
    ];
    expect(longestUsageStreak(rows)).toBe(3);
    expect(usageStreak(rows, "2026-09-25")).toBe(1);
    const heat = heatMapDays(rows, "2026-09-25", 2);
    expect(heat).toHaveLength(14);
    expect(heat.find((day) => day.day === "2026-09-22")?.words).toBe(30);
  });

  it("exposes all-time words separately from this month", () => {
    const lifetime = [
      row("2026-08-10", "desk", 2, 100),
      row("2026-09-05", "desk", 1, 40),
      row("2026-09-20", "desk", 1, 60),
    ];
    const month = lifetime.filter((item) => item.day >= "2026-09-01");
    const model = buildAnalytics({
      lifetime,
      month,
      recent: month,
      weeks: month,
      devices: [{ id: "desk", name: "PC", platform: "windows" }],
      dictionary: [],
      today: "2026-09-28",
    });
    expect(model.lifetimeWords).toBe(200);
    expect(model.monthWords).toBe(100);
  });
});

describe("settings epoch", () => {
  it("treats a missing settings row as epoch 0 and omits the epoch from ordinary saves", () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsFromRow(null).usageEpoch).toBe(0);
    expect(settingsFromRow(null).cloudDictationHistory).toBe(false);
    const row = settingsUpsertRow("user", { ...DEFAULT_SETTINGS, usageEpoch: 4, usageIntelligence: false });
    expect(row).not.toHaveProperty("usage_epoch");
    expect(row).not.toHaveProperty("assistant_learning_since");
    expect(row.usage_intelligence).toBe(false);
    expect(row.cloud_dictation_history).toBe(false);
    expect(row.assistant_memory_learning).toBe(false);
  });
});

describe("usage sql", () => {
  it("revokes direct writes and locks the clear and upsert functions together", () => {
    const sql = readFileSync("supabase/migrations/20260928230000_usage_days.sql", "utf8");
    expect(sql).toContain("revoke all on table public.usage_days from public, anon, authenticated");
    expect(sql).toContain("grant select on table public.usage_days to authenticated");
    expect(sql).toContain("security definer");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("if not found then");
    expect(sql).toContain("current_epoch := 0");
    expect(sql).toContain("insert into public.settings");
    expect(sql).toContain("where days.revision < excluded.revision");
  });
});
