import { describe, expect, it } from "vitest";
import {
  assistantReducer,
  assistantStatusLabel,
  initialAssistantState,
  mergeTranscript,
  type AssistantSnapshot,
} from "@/assistant/state";

function run(actions: Parameters<typeof assistantReducer>[1][]): AssistantSnapshot {
  return actions.reduce(assistantReducer, initialAssistantState);
}

describe("assistant lifecycle", () => {
  it("moves idle to ready, through a reply, and back to ready", () => {
    const state = run([
      { type: "start" },
      { type: "ready" },
      { type: "send", id: "u1", text: "Hello" },
      { type: "output", text: "Hi" },
      { type: "turnComplete", id: "a1" },
    ]);
    expect(state.status).toBe("READY");
    expect(state.liveText).toBe("");
    expect(state.turns).toEqual([
      { id: "u1", role: "user", text: "Hello" },
      { id: "a1", role: "assistant", text: "Hi" },
    ]);
  });

  it("accepts a second turn only after the first reply finishes", () => {
    const responding = run([
      { type: "start" },
      { type: "ready" },
      { type: "send", id: "u1", text: "First" },
    ]);
    expect(assistantReducer(responding, { type: "send", id: "u2", text: "Second" })).toBe(responding);
    const ready = assistantReducer(responding, { type: "turnComplete", id: "a1" });
    const second = assistantReducer(ready, { type: "send", id: "u2", text: "Second" });
    expect(second.status).toBe("RESPONDING");
    expect(second.turns.map((turn) => turn.text)).toEqual(["First", "Second"]);
  });

  it("drops an unfinished reply on end and ignores events that arrive afterward", () => {
    const responding = run([
      { type: "start" },
      { type: "ready" },
      { type: "send", id: "u1", text: "Hello" },
      { type: "output", text: "late" },
    ]);
    const ended = assistantReducer(responding, { type: "end" });
    expect(ended.status).toBe("IDLE");
    expect(ended.liveText).toBe("");
    expect(ended.turns).toEqual([{ id: "u1", role: "user", text: "Hello" }]);
    expect(assistantReducer(ended, { type: "output", text: "still late" })).toBe(ended);
    expect(assistantReducer(ended, { type: "turnComplete", id: "a1" })).toBe(ended);
    expect(assistantReducer(ended, { type: "ready" })).toBe(ended);
  });

  it("keeps two spoken turns on one conversation and replaces the live user line", () => {
    const state = run([
      { type: "start" },
      { type: "ready" },
      { type: "userPartial", text: "forty" },
      { type: "userFinal", id: "u1", text: "My favorite test number is forty two." },
      { type: "output", text: "Forty-two." },
      { type: "turnComplete", id: "a1" },
      { type: "userFinal", id: "u2", text: "What test number did I just give you?" },
      { type: "output", text: "42." },
      { type: "turnComplete", id: "a2" },
    ]);
    expect(state.status).toBe("READY");
    expect(state.liveUser).toBe("");
    expect(state.turns.map((turn) => turn.text)).toEqual([
      "My favorite test number is forty two.",
      "Forty-two.",
      "What test number did I just give you?",
      "42.",
    ]);
  });

  it("refuses to start while another owner has the microphone", () => {
    const blocked = assistantReducer(initialAssistantState, { type: "blocked", message: "Dictation is using the microphone." });
    expect(blocked).toMatchObject({ status: "ERROR", error: "Dictation is using the microphone." });
  });

  it("surfaces a failure and can start again without keeping the partial reply", () => {
    const failed = run([
      { type: "start" },
      { type: "output", text: "nope" },
      { type: "fail", message: "Could not reach Assistant." },
    ]);
    expect(failed).toMatchObject({ status: "ERROR", error: "Could not reach Assistant.", liveText: "" });
    expect(assistantReducer(failed, { type: "start" }).status).toBe("CONNECTING");
  });

  it("reconnects without dropping committed turns", () => {
    const live = run([
      { type: "start" },
      { type: "ready" },
      { type: "userFinal", id: "u", text: "The code word is bluebird." },
      { type: "output", text: "Noted." },
      { type: "turnComplete", id: "a" },
      { type: "output", text: "Still talking" },
      { type: "reconnect", id: "partial" },
    ]);
    expect(live).toMatchObject({ status: "CONNECTING", resuming: true, liveText: "" });
    expect(live.turns.map((turn) => turn.text)).toEqual([
      "The code word is bluebird.",
      "Noted.",
      "Still talking",
    ]);
    expect(assistantReducer(live, { type: "ready" })).toMatchObject({ status: "READY", resuming: false });
  });
});

describe("mergeTranscript", () => {
  it("appends a delta and replaces a cumulative transcript", () => {
    expect(mergeTranscript("", "Assistant")).toBe("Assistant");
    expect(mergeTranscript("Assistant", " online.")).toBe("Assistant online.");
    expect(mergeTranscript("Assistant", "Assistant online.")).toBe("Assistant online.");
  });
});

describe("assistantStatusLabel", () => {
  it("says Ready when the session can take a turn", () => {
    expect(assistantStatusLabel({ ...initialAssistantState, status: "READY" }, true)).toBe("Listening");
    expect(assistantStatusLabel(initialAssistantState, false)).toBe("Sign in to use Assistant");
    expect(assistantStatusLabel({ ...initialAssistantState, status: "CONNECTING", resuming: true }, true)).toBe("Reconnecting…");
  });
});
