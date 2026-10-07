import { describe, expect, it } from "vitest";
import { dictationCueShape } from "@/platform/windows/dictationCue";

describe("Windows dictation cues", () => {
  it("keeps ready and done cues short, subtle, and distinguishable", () => {
    const ready = dictationCueShape("ready");
    const done = dictationCueShape("done");

    expect(ready.durationMs).toBeLessThan(100);
    expect(done.durationMs).toBeLessThan(100);
    expect(ready.gain).toBeLessThan(0.05);
    expect(done.gain).toBeLessThan(0.05);
    expect(ready.toHz).toBeGreaterThan(ready.fromHz);
    expect(done.toHz).toBeLessThan(done.fromHz);
  });
});
