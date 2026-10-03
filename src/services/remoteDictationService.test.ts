import { describe, expect, it } from "vitest";
import { remoteDictationErrorMessage } from "@/services/remoteDictationService";

describe("remoteDictationErrorMessage", () => {
  it("maps same-device and text rejections", () => {
    expect(remoteDictationErrorMessage({ message: "REMOTE_DICTATION_SAME_DEVICE" }))
      .toMatch(/cannot target this device/i);
    expect(remoteDictationErrorMessage({ message: "REMOTE_DICTATION_TEXT" }))
      .toMatch(/empty or too long/i);
    expect(remoteDictationErrorMessage({ message: "REMOTE_DICTATION_TARGET" }))
      .toMatch(/not on this account/i);
  });
});
