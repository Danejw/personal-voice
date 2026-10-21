import { describe, expect, it } from "vitest";
import {
  clipboardImageMime,
  detectClipboardImageFormat,
  encodeBmpFromPixels,
} from "@/clipboard/clipboardImageCodec";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("clipboard image codec", () => {
  it("detects PNG and BMP signatures", () => {
    expect(detectClipboardImageFormat(PNG)).toBe("png");
    expect(clipboardImageMime(PNG)).toBe("image/png");
    expect(detectClipboardImageFormat(new Uint8Array([0x42, 0x4d, 0]))).toBe("bmp");
    expect(detectClipboardImageFormat(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("encodes RGBA pixels as a bottom-up BGRA BMP", () => {
    // Top row red and green, bottom row blue and white.
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    const bmp = encodeBmpFromPixels(2, 2, rgba);
    expect(bmp.length).toBe(54 + 16);
    expect(String.fromCharCode(bmp[0] ?? 0, bmp[1] ?? 0)).toBe("BM");
    // The first stored row is the bottom row in BGRA: blue, then white.
    expect([...bmp.slice(54, 62)]).toEqual([255, 0, 0, 255, 255, 255, 255, 255]);
    expect(detectClipboardImageFormat(bmp)).toBe("bmp");
  });

  it("rejects pixel data that does not match the dimensions", () => {
    expect(() => encodeBmpFromPixels(2, 2, new Uint8ClampedArray(4))).toThrow();
  });
});
