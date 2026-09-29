import { describe, expect, it } from "vitest";
import { preferMobileNav } from "@/app/AppNav";

describe("preferMobileNav", () => {
  it("always uses the mobile shell on Android, even when the viewport is wide", () => {
    expect(preferMobileNav("Mozilla/5.0 (Linux; Android 14; SM-S918B)", false)).toBe(true);
    expect(preferMobileNav("Mozilla/5.0 (Linux; Android 14; SM-S918B)", true)).toBe(true);
  });

  it("on Windows follows the narrow viewport only", () => {
    expect(preferMobileNav("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false)).toBe(false);
    expect(preferMobileNav("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", true)).toBe(true);
  });
});
