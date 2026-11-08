import { describe, expect, it } from "vitest";
import { parseAssistantOutputs } from "@/platform/android/AssistantAudioOutputSettings";

describe("Assistant Android audio output selection", () => {
  it("accepts only connected output entries with native ids and a valid selected state", () => {
    const result = parseAssistantOutputs({ outputs: [
      { id: "system", name: "System default", type: "Automatic", selected: false },
      { id: "audio:33", name: "Echo Dot", type: "Bluetooth media (A2DP)", selected: true },
      { id: "bt-abcdef", name: "Paired only", type: "Bluetooth", selected: true },
      { id: "audio:1", name: "Missing kind", selected: false },
    ] });
    expect(result.map(entry => entry.id)).toEqual(["system", "audio:33"]);
    expect(result[1]?.selected).toBe(true);
  });

  it("treats malformed native output responses as no available devices", () => {
    expect(parseAssistantOutputs({ outputs: null })).toEqual([]);
    expect(parseAssistantOutputs(null)).toEqual([]);
    expect(parseAssistantOutputs({ outputs: "audio:2" })).toEqual([]);
  });
});
