import { describe, expect, it } from "vitest";
import { initialDictationSnapshot } from "./DictationController";
import { indicatorFor, isCancellable } from "./indicator";
import type { VoiceState } from "./state";

const at = (state: VoiceState, error: string | null = null) => ({ ...initialDictationSnapshot, state, error });

describe("indicator mapping", () => {
  it("shows listening as soon as the key is down, finalizing through insertion, and hides when idle", () => {
    expect(indicatorFor(at("IDLE"))).toBeNull();
    expect(indicatorFor(at("CONNECTING"))).toEqual({ kind: "listening" });
    expect(indicatorFor(at("LISTENING"))).toEqual({ kind: "listening" });
    expect(indicatorFor(at("FINALIZING"))).toEqual({ kind: "finalizing" });
    expect(indicatorFor(at("INSERTING"))).toEqual({ kind: "finalizing" });
    expect(indicatorFor(at("ERROR", "No microphone was found."))).toEqual({ kind: "error", message: "No microphone was found." });
  });

  it("routes Escape to cancel only before insertion", () => {
    const cancellable = (["IDLE", "CONNECTING", "LISTENING", "FINALIZING", "INSERTING", "ERROR"] as const).filter(isCancellable);
    expect(cancellable).toEqual(["CONNECTING", "LISTENING", "FINALIZING"]);
  });
});
