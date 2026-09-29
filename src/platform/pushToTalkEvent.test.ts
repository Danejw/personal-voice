import { describe, expect, it } from "vitest";
import { parsePushToTalk } from "@/platform/pushToTalkEvent";

describe("parsePushToTalk", () => {
  it("accepts the three events, with an optional destination on press", () => {
    expect(parsePushToTalk({ event: "press" })).toEqual({ event: "press" });
    expect(parsePushToTalk({ event: "press", destination: "voice-note" }))
      .toEqual({ event: "press", destination: "voice-note" });
    expect(parsePushToTalk({ event: "release" })).toEqual({ event: "release" });
    expect(parsePushToTalk({ event: "cancel" })).toEqual({ event: "cancel" });
    expect(parsePushToTalk({ event: "capture-selection" })).toEqual({ event: "capture-selection" });
    expect(parsePushToTalk("press")).toEqual({ event: "press" });
    expect(parsePushToTalk({ event: "tap" })).toBeNull();
    expect(parsePushToTalk(null)).toBeNull();
  });
});
