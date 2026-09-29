import { describe, expect, it } from "vitest";
import { TARGET_APP_LIMIT, applyUsageEvent, averageWpm, emptyCounters, parseCounters, usageEventsFromDictation } from "@/usage/usageEvents";
import { windowsShortcutTrigger } from "@/platform/pushToTalkEvent";

describe("applyUsageEvent", () => {
  it("counts output words, completion time, and recording speed separately", () => {
    let counters = emptyCounters();
    counters = applyUsageEvent(counters, {
      name: "dictation_completed",
      outputWords: 10,
      completionMs: 8_000,
      recordingMs: 5_000,
      termUses: { persyn: 2 },
    }, 9);
    expect(counters.outputWords).toBe(10);
    expect(counters.completionMs).toBe(8_000);
    expect(counters.recordingMs).toBe(5_000);
    expect(counters.wpmWords).toBe(10);
    expect(counters.terms.persyn).toBe(2);
    expect(counters.hours[9]).toBe(1);
    expect(averageWpm(counters.wpmWords, counters.recordingMs)).toBeCloseTo(120);
    expect(JSON.stringify(counters)).not.toMatch(/hello|transcript|pcm/i);
  });

  it("skips words-per-minute when recording time was not measured", () => {
    const counters = applyUsageEvent(emptyCounters(), {
      name: "dictation_completed",
      outputWords: 12,
      completionMs: 9_000,
      recordingMs: null,
      termUses: {},
    }, 10);
    expect(counters.outputWords).toBe(12);
    expect(counters.wpmWords).toBe(0);
    expect(counters.recordingMs).toBe(0);
    expect(counters.fastestWpm).toBeNull();
  });

  it("ignores a short utterance for fastest and slowest", () => {
    const short = applyUsageEvent(emptyCounters(), {
      name: "dictation_completed",
      outputWords: 2,
      completionMs: 4_000,
      recordingMs: 1_000,
      termUses: {},
    }, 8);
    expect(short.fastestWpm).toBeNull();
    const paced = applyUsageEvent(short, {
      name: "dictation_completed",
      outputWords: 20,
      completionMs: 20_000,
      recordingMs: 10_000,
      termUses: {},
    }, 8);
    expect(paced.fastestWpm).toBeCloseTo(120);
    expect(paced.slowestWpm).toBeCloseTo(120);
  });

  it("copies the trigger that the start source already chose", () => {
    const counters = applyUsageEvent(emptyCounters(), { name: "dictation_started", trigger: "android-floating-mic" }, 1);
    expect(counters.triggers["android-floating-mic"]).toBe(1);
    expect(counters.triggers["shortcut-dictate"]).toBe(0);
  });
});

describe("target apps", () => {
  it("counts a paste by file name and drops a window title or a path", () => {
    const counters = applyUsageEvent(emptyCounters(), {
      name: "target_app",
      appId: "C:\\Users\\keali\\AppData\\Local\\slack.exe",
      appLabel: "Slack",
      words: 4,
    }, 9);
    expect(counters.targetApps["slack.exe"]).toEqual({ label: "Slack", count: 1, words: 4 });
    expect(JSON.stringify(counters)).not.toMatch(/keali/);
    const titled = applyUsageEvent(counters, {
      name: "target_app",
      appId: "Inbox - Gmail",
      appLabel: "Inbox - Gmail",
      words: 3,
    }, 9);
    expect(titled.targetApps["slack.exe"]?.count).toBe(1);
    expect(Object.keys(titled.targetApps)).toEqual(["slack.exe"]);
  });

  it("folds a new app past the daily cap into other", () => {
    let counters = emptyCounters();
    for (let index = 0; index < TARGET_APP_LIMIT + 1; index += 1) {
      counters = applyUsageEvent(counters, {
        name: "target_app",
        appId: `app${index}.exe`,
        appLabel: `App ${index}`,
        words: 1,
      }, 1);
    }
    const named = Object.keys(counters.targetApps).filter((id) => id !== "other");
    expect(named).toHaveLength(TARGET_APP_LIMIT);
    expect(counters.targetApps.other).toEqual({ label: "Other", count: 1, words: 1 });
    counters = applyUsageEvent(counters, {
      name: "target_app",
      appId: "app0.exe",
      appLabel: "App 0",
      words: 2,
    }, 1);
    expect(counters.targetApps["app0.exe"]?.count).toBe(2);
    expect(counters.targetApps.other?.count).toBe(1);
  });

  it("reads an older day that has no target apps", () => {
    expect(parseCounters({ outputWords: 3 }).targetApps).toEqual({});
  });
});

describe("usageEventsFromDictation", () => {
  it("records a start when the utterance counter advances", () => {
    expect(usageEventsFromDictation(
      { state: "IDLE", utterance: 0 },
      { state: "CONNECTING", utterance: 1 },
      "ui-button",
    )).toEqual([{ name: "dictation_started", trigger: "ui-button" }]);
  });

  it("records a failure when the machine enters ERROR", () => {
    expect(usageEventsFromDictation(
      { state: "FINALIZING", utterance: 2 },
      { state: "ERROR", utterance: 2 },
      null,
    )).toEqual([{ name: "dictation_failed" }]);
  });

  it("does not treat cancel-to-idle as a failure", () => {
    expect(usageEventsFromDictation(
      { state: "LISTENING", utterance: 1 },
      { state: "IDLE", utterance: 1 },
      null,
    )).toEqual([]);
  });
});

describe("shortcut identity", () => {
  it("maps Windows bindings and leaves the Android mic as its own trigger", () => {
    expect(windowsShortcutTrigger(undefined)).toBe("shortcut-dictate");
    expect(windowsShortcutTrigger("voice-note")).toBe("shortcut-note");
    expect(windowsShortcutTrigger("send-to-device")).toBe("shortcut-handoff");
    expect(windowsShortcutTrigger("active-field")).not.toBe("android-floating-mic");
  });
});
