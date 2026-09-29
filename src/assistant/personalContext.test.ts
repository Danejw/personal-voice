import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  personalContextBody,
  personalContextNote,
  PERSONAL_CONTEXT_LIMIT,
  profileFacts,
} from "@/assistant/personalContext";
import { emptyCounters } from "@/usage/usageEvents";
import type { RemoteUsageDay, UsageCounters } from "@/usage/usageEvents";

const TODAY = "2026-09-28";
const NOTE_BODY = "pineapple secret note that must not be copied";

function row(
  deviceId: string,
  day: string,
  fill: (counters: UsageCounters) => void,
): RemoteUsageDay {
  const counters = emptyCounters();
  fill(counters);
  return {
    deviceId,
    day,
    epoch: 1,
    revision: 1,
    updatedAt: `${day}T00:00:00.000Z`,
    counters,
  };
}

describe("profile facts", () => {
  it("states a device share only when the month has enough dictations", () => {
    const devices = [{ id: "pc", name: "Desk PC", platform: "windows" }, { id: "phone", name: "Phone", platform: "android" }];
    const sparse = [row("pc", "2026-09-02", (counters) => { counters.dictationCompleted = 3; })];
    expect(profileFacts(sparse, devices, TODAY)).toEqual([]);

    const rows = [
      row("pc", "2026-09-02", (counters) => { counters.dictationCompleted = 18; }),
      row("phone", "2026-09-03", (counters) => { counters.dictationCompleted = 7; }),
    ];
    const facts = profileFacts(rows, devices, TODAY);
    expect(facts.map((fact) => fact.id)).toEqual(["device"]);
    expect(facts[0]?.text).toBe("Desk PC accounts for 72% of dictations this month (18 of 25).");
    expect(facts[0]?.text).not.toContain(NOTE_BODY);
  });

  it("names the trigger, target app, terms, and pace from the same counters", () => {
    const rows = [row("pc", "2026-09-10", (counters) => {
      counters.dictationCompleted = 10;
      counters.triggers["shortcut-dictate"] = 8;
      counters.triggers["ui-button"] = 2;
      counters.targetApps.cursor = { label: "Cursor", count: 8, words: 40 };
      counters.targetApps.other = { label: "Other", count: 2, words: 4 };
      counters.terms.persyn = 8;
      counters.terms.voice = 4;
      counters.wpmWords = 120;
      counters.recordingMs = 60_000;
      counters.hours[23] = 20;
    })];
    const facts = profileFacts(rows, [{ id: "pc", name: "Desk PC" }], TODAY);
    expect(facts.map((fact) => fact.text)).toEqual([
      "Desk PC accounts for 100% of dictations this month (10 of 10).",
      "Hold to Dictate is the most-used trigger this month (80% of starts).",
      "Cursor is a frequent dictation target this month (8 pastes).",
      "Most-used dictionary terms this month are persyn (8), voice (4).",
      "Average pace this month is 120 words per minute, from measured dictations.",
    ]);
    expect(facts.some((fact) => /night|hour|weekend/i.test(fact.text))).toBe(false);
  });

  it("drops stale rows and rows outside the current month", () => {
    const devices = [{ id: "pc", name: "Desk PC" }];
    const old = [row("pc", "2026-01-02", (counters) => { counters.dictationCompleted = 40; })];
    expect(profileFacts(old, devices, TODAY)).toEqual([]);
    const lastMonth = [row("pc", "2026-08-20", (counters) => { counters.dictationCompleted = 40; })];
    expect(profileFacts(lastMonth, devices, TODAY)).toEqual([]);
  });

  it("does not copy source rows or invent a second store", () => {
    const source = readFileSync(new URL("./personalContext.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/supabase|usage_days|embedding/);
    const rows = [row("pc", "2026-09-02", (counters) => { counters.dictationCompleted = 12; })];
    const before = rows[0]?.counters.dictationCompleted;
    const first = profileFacts(rows, [{ id: "pc", name: "Desk PC" }], TODAY);
    if (first[0]) first[0].text = "changed";
    const second = profileFacts(rows, [{ id: "pc", name: "Desk PC" }], TODAY);
    expect(rows[0]?.counters.dictationCompleted).toBe(before);
    expect(second[0]?.text).toContain("Desk PC accounts for 100%");
    expect(second[0]?.text).not.toContain(NOTE_BODY);
  });
});

describe("personal context package", () => {
  it("omits analytics facts when the profile is off", () => {
    const facts = profileFacts(
      [row("pc", "2026-09-02", (counters) => { counters.dictationCompleted = 18; })],
      [{ id: "pc", name: "Desk PC" }],
      TODAY,
    );
    const off = personalContextBody({
      deviceName: "Desk PC",
      platform: "windows",
      profileEnabled: false,
      facts,
    });
    expect(off).toContain("This device is Desk PC on Windows.");
    expect(off).toContain("Analytics profile is turned off.");
    expect(off).not.toContain("72%");
    expect(off).not.toContain("accounts for");
  });

  it("clips the session note to the character budget", () => {
    const body = personalContextBody({
      deviceName: "D".repeat(4_000),
      platform: "windows",
      profileEnabled: true,
      facts: [],
    });
    const note = personalContextNote(body);
    expect(note.length).toBeLessThanOrEqual(PERSONAL_CONTEXT_LIMIT);
    expect(note).toContain("Do not invent profile facts");
  });
});
