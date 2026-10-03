import { describe, expect, it } from "vitest";
import { REMOTE_DICTATION_HOLD_MS } from "@/remote-dictation/constants";
import { resolveRemoteDictationGesture } from "@/remote-dictation/gesture";

describe("resolveRemoteDictationGesture", () => {
  it("cycles on a short tap and never starts hold", () => {
    expect(resolveRemoteDictationGesture({
      phase: "down",
      heldMs: REMOTE_DICTATION_HOLD_MS - 1,
      holdStarted: false,
      available: true,
    })).toBeNull();
    expect(resolveRemoteDictationGesture({
      phase: "up",
      heldMs: REMOTE_DICTATION_HOLD_MS - 1,
      holdStarted: false,
      available: true,
    })).toEqual({ action: "cycle" });
  });

  it("starts on hold threshold and stops on release without cycling", () => {
    expect(resolveRemoteDictationGesture({
      phase: "down",
      heldMs: REMOTE_DICTATION_HOLD_MS,
      holdStarted: false,
      available: true,
    })).toEqual({ action: "start-hold" });
    expect(resolveRemoteDictationGesture({
      phase: "up",
      heldMs: REMOTE_DICTATION_HOLD_MS + 50,
      holdStarted: true,
      available: true,
    })).toEqual({ action: "stop-hold" });
  });

  it("does nothing when no target is available", () => {
    expect(resolveRemoteDictationGesture({
      phase: "up",
      heldMs: 10,
      holdStarted: false,
      available: false,
    })).toBeNull();
  });
});
