import { describe, expect, it } from "vitest";
import { isNewerVersion, parseVersion } from "@/updates/version";

describe("parseVersion", () => {
  it("reads versions and release tags", () => {
    expect(parseVersion("0.2.0")).toEqual([0, 2, 0]);
    expect(parseVersion("v1.10.3")).toEqual([1, 10, 3]);
  });

  it("rejects anything that isn't a plain release", () => {
    expect(parseVersion("0.2")).toBeNull();
    expect(parseVersion("0.2.0-beta.1")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("compares numerically, not as text", () => {
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("0.2.1", "0.2.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
  });

  it("never offers the same or an older version", () => {
    expect(isNewerVersion("0.2.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("v0.2.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.1.9", "0.2.0")).toBe(false);
  });

  it("never offers a malformed version", () => {
    expect(isNewerVersion("9.9", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "unknown")).toBe(false);
  });
});
