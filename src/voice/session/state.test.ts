import { describe, expect, it } from "vitest";
import { initialVoiceState, voiceReducer } from "@/voice/session/state";
import type { VoiceAction, VoiceState } from "@/voice/session/state";

describe("voice lifecycle foundation", () => {
  it("follows the specified lifecycle back to idle", () => {
    const actions: VoiceAction[] = [
      { type: "start" }, { type: "connected" }, { type: "finish" },
      { type: "transcribed" }, { type: "delivered" },
    ];
    let state: VoiceState = initialVoiceState;
    const states = actions.map((action) => (state = voiceReducer(state, action)));
    expect(states).toEqual(["CONNECTING", "LISTENING", "FINALIZING", "INSERTING", "IDLE"]);
  });

  it("ignores duplicate starts and out-of-order completion actions", () => {
    expect(voiceReducer("LISTENING", { type: "start" })).toBe("LISTENING");
    expect(voiceReducer("IDLE", { type: "transcribed" })).toBe("IDLE");
    expect(voiceReducer("INSERTING", { type: "transcribed" })).toBe("INSERTING");
    expect(voiceReducer("CONNECTING", { type: "delivered" })).toBe("CONNECTING");
  });

  it("finishes from CONNECTING or LISTENING only", () => {
    expect(voiceReducer("CONNECTING", { type: "finish" })).toBe("FINALIZING");
    expect(voiceReducer("LISTENING", { type: "finish" })).toBe("FINALIZING");
    for (const state of ["IDLE", "FINALIZING", "INSERTING", "ERROR"] as const) {
      expect(voiceReducer(state, { type: "finish" })).toBe(state);
    }
  });

  it("cancels an utterance before insertion begins, but not during or after it", () => {
    for (const state of ["CONNECTING", "LISTENING", "FINALIZING"] as const) {
      expect(voiceReducer(state, { type: "cancel" })).toBe("IDLE");
    }
    for (const state of ["IDLE", "INSERTING", "ERROR"] as const) {
      expect(voiceReducer(state, { type: "cancel" })).toBe(state);
    }
  });

  it.each<VoiceState>(["CONNECTING", "LISTENING", "FINALIZING", "INSERTING"])(
    "allows a failure in %s to reset before a new start", (state) => {
      const failed = voiceReducer(state, { type: "fail" });
      expect(failed).toBe("ERROR");
      expect(voiceReducer(failed, { type: "start" })).toBe("ERROR");
      expect(voiceReducer(voiceReducer(failed, { type: "reset" }), { type: "start" })).toBe("CONNECTING");
    },
  );
});
