import { describe, expect, it } from "vitest";
import { microphoneOptions } from "@/platform/microphones";

const inputs = [
  { deviceId: "default", label: "Default - Microphone Array (Realtek)" },
  { deviceId: "communications", label: "Communications - Microphone Array (Realtek)" },
  { deviceId: "array", label: "Microphone Array (Realtek)" },
  { deviceId: "usb", label: "" },
];

describe("microphoneOptions", () => {
  it("lists the system default first, then real devices without the Chromium aliases", () => {
    expect(microphoneOptions(inputs, null)).toEqual([
      { value: "", label: "System default (Microphone Array (Realtek))" },
      { value: "array", label: "Microphone Array (Realtek)" },
      { value: "usb", label: "Microphone 2" },
    ]);
  });

  it("keeps a chosen microphone that is unplugged", () => {
    expect(microphoneOptions(inputs, "headset").at(-1)).toEqual({ value: "headset", label: "Chosen microphone (not connected)" });
    expect(microphoneOptions(inputs, "usb")).toHaveLength(3);
  });

  it("works before any labels are available", () => {
    expect(microphoneOptions([], null)).toEqual([{ value: "", label: "System default" }]);
  });
});
