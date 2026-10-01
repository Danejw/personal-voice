import { describe, expect, it } from "vitest";
import { shouldAutoInstallUpdate, shouldOfferUpdateToast } from "@/updates/updatePrompt";

describe("updatePrompt", () => {
  it("offers a toast only when auto-update is off and the version was not dismissed", () => {
    expect(shouldOfferUpdateToast(true, "0.4.0", null)).toBe(false);
    expect(shouldOfferUpdateToast(false, "0.4.0", null)).toBe(true);
    expect(shouldOfferUpdateToast(false, "0.4.0", "0.4.0")).toBe(false);
    expect(shouldOfferUpdateToast(false, "0.4.0", "0.3.0")).toBe(true);
  });

  it("auto-installs when preferred, idle, and not already attempted", () => {
    expect(shouldAutoInstallUpdate(true, false, false)).toBe(true);
    expect(shouldAutoInstallUpdate(true, true, false)).toBe(false);
    expect(shouldAutoInstallUpdate(true, false, true)).toBe(false);
    expect(shouldAutoInstallUpdate(false, false, false)).toBe(false);
  });
});
