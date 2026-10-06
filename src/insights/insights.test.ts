import { describe, expect, it } from "vitest";
import type { DictationRecord } from "@/history/dictation";
import {
  FIRST_RUN_MIN_DICTATIONS,
  INSIGHTS_KEEP_RECENT,
  eligibleDictations,
  insightReadiness,
  usageFacts,
} from "@/insights/insights";

function row(index: number, dayOffset = 0): DictationRecord {
  const created = new Date(2026, 9, 1 + dayOffset, 20 + (index % 3), 0, index % 60);
  return {
    id: `d-${index}`,
    text: `dictation number ${index} with enough words`,
    destination: "active-field",
    outcome: "success",
    sourceDeviceId: index % 4 === 0 ? "phone" : "desktop",
    createdAt: created.toISOString(),
  };
}

describe("Insights readiness", () => {
  it("requires enough volume and active days for the first run", () => {
    const rows = Array.from({ length: FIRST_RUN_MIN_DICTATIONS }, (_, index) => row(index, index % 3))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const readiness = insightReadiness(rows, null, new Date(2026, 9, 10));
    expect(readiness.ready).toBe(true);
    expect(readiness.eligibleForAnalysis).toBe(FIRST_RUN_MIN_DICTATIONS - INSIGHTS_KEEP_RECENT);
  });

  it("keeps the newest 50 out of analysis", () => {
    const rows = Array.from({ length: 80 }, (_, index) => row(index, index % 4))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    expect(eligibleDictations(rows, null)).toHaveLength(30);
  });
});

describe("usage facts", () => {
  it("derives free-standing deterministic facts from the analyzed rows", () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(index, 1));
    const facts = usageFacts(rows);
    expect(facts.peakDay).toBe("Friday");
    expect(facts.peakDeviceId).toBe("desktop");
    expect(facts.peakDeviceShare).toBe(75);
    expect(facts.totalWords).toBeGreaterThan(0);
    expect(facts.dayCounts.reduce((sum, count) => sum + count, 0)).toBe(rows.length);
    expect(facts.hourCounts.reduce((sum, count) => sum + count, 0)).toBe(rows.length);
    expect(facts.deviceCounts).toEqual([
      { deviceId: "desktop", count: 9 },
      { deviceId: "phone", count: 3 },
    ]);
  });
});
