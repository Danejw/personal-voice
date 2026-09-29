import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fitSnapshotEdge,
  snapshotContextText,
  snapshotDetachedText,
  snapshotFromNative,
} from "@/assistant/snapshot";

const TINY_JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff));

function jpegBase64(length: number): string {
  const bytes = new Uint8Array(length);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

describe("screen snapshot", () => {
  it("fits a readable frame and refuses an empty or huge one", () => {
    expect(fitSnapshotEdge(100, 50)).toEqual({ width: 100, height: 50 });
    expect(fitSnapshotEdge(2560, 1440)).toEqual({ width: 1280, height: 720 });
    expect(() => fitSnapshotEdge(0, 10)).toThrow(/empty/);
    expect(() => fitSnapshotEdge(8_001, 10)).toThrow(/too large/);
  });

  it("accepts a JPEG from Android and encodes an RGBA frame from Windows", () => {
    const encoded = snapshotFromNative(
      { source: "screen", jpeg: TINY_JPEG },
      () => { throw new Error("Android already sent a JPEG."); },
      () => "2026-09-28T12:00:00.000Z",
    );
    expect(encoded).toMatchObject({ source: "screen", jpeg: TINY_JPEG, capturedAt: "2026-09-28T12:00:00.000Z" });

    const rgba = btoa(String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8));
    const windowShot = snapshotFromNative(
      { source: "window", sourceApp: "Notes", width: 2, height: 1, rgba },
      (got, width, height) => {
        expect(got).toBe(rgba);
        expect(width).toBe(2);
        expect(height).toBe(1);
        return TINY_JPEG;
      },
      () => "2026-09-28T12:00:00.000Z",
    );
    expect(windowShot).toMatchObject({
      source: "window",
      sourceApp: "Notes",
      jpeg: TINY_JPEG,
      width: 2,
      height: 1,
    });
    expect(snapshotContextText(windowShot)).toContain("active window");
    expect(snapshotContextText(windowShot)).toContain("look again");
    expect(snapshotContextText(windowShot)).toContain("capture_screen");
    expect(snapshotContextText(windowShot)).toContain("Notes");
    expect(snapshotContextText(encoded)).toContain("the screen");
    expect(snapshotDetachedText()).toContain("removed");
  });

  it("rejects a bad payload, a short buffer, a non-JPEG, and an oversized JPEG", () => {
    const encode = () => TINY_JPEG;
    expect(() => snapshotFromNative(null, encode)).toThrow(/could not be read/);
    expect(() => snapshotFromNative({ source: "camera", jpeg: TINY_JPEG }, encode)).toThrow(/could not be read/);
    expect(() => snapshotFromNative({ source: "screen", width: 2, height: 2, rgba: "AA==" }, encode)).toThrow(/could not be read/);
    expect(() => snapshotFromNative({ source: "screen", jpeg: btoa("not-a-jpeg") }, encode)).toThrow(/could not be read/);
    expect(() => snapshotFromNative({ source: "screen", jpeg: jpegBase64(1_000_001) }, encode)).toThrow(/too large to send/);
  });

  it("keeps the screenshot in the returned object and does not persist it", () => {
    const sources = ["snapshot.ts", "snapshotEncode.ts"].map((name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
    const combined = sources.join("\n");
    expect(combined).not.toMatch(/localStorage|indexedDB|writeFile|MediaStore/);
    const shot = snapshotFromNative({ source: "screen", jpeg: TINY_JPEG }, () => TINY_JPEG);
    expect(shot.jpeg).toBe(TINY_JPEG);
  });
});
