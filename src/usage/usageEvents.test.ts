import { describe, expect, it } from "vitest";
import { applyUsageEvent, EMPTY_USAGE_TOTALS, usageEventsFromDictation } from "@/usage/usageEvents";

describe("applyUsageEvent", () => {
  it("increments counters without storing text", () => {
    let totals = EMPTY_USAGE_TOTALS;
    totals = applyUsageEvent(totals, { name: "dictation_started" });
    totals = applyUsageEvent(totals, { name: "dictation_completed", durationMs: 1200 });
    totals = applyUsageEvent(totals, { name: "recovery_used" });
    totals = applyUsageEvent(totals, { name: "destination_used", destination: "voice-note" });
    expect(totals).toEqual({
      dictation_started: 1,
      dictation_completed: 1,
      dictation_failed: 0,
      recovery_used: 1,
      destination_used: { "active-field": 0, "voice-note": 1, "send-to-device": 0 },
      voice_note_created: 0,
      handoff_created: 0,
      selection_captured: 0,
      durationMsTotal: 1200,
    });
    expect(JSON.stringify(totals)).not.toMatch(/hello|transcript|pcm/i);
  });
});

describe("usageEventsFromDictation", () => {
  it("records a start when the utterance counter advances", () => {
    expect(usageEventsFromDictation(
      { state: "IDLE", utterance: 0 },
      { state: "CONNECTING", utterance: 1 },
    )).toEqual([{ name: "dictation_started" }]);
  });

  it("records a failure when the machine enters ERROR", () => {
    expect(usageEventsFromDictation(
      { state: "FINALIZING", utterance: 2 },
      { state: "ERROR", utterance: 2 },
    )).toEqual([{ name: "dictation_failed" }]);
  });

  it("does not treat cancel-to-idle as a failure", () => {
    expect(usageEventsFromDictation(
      { state: "LISTENING", utterance: 1 },
      { state: "IDLE", utterance: 1 },
    )).toEqual([]);
  });
});
