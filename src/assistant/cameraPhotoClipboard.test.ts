import { describe, expect, it } from "vitest";
import { bytesToBase64, rgbaToDib } from "@/assistant/cameraPhotoClipboard";

describe("camera photo Windows clipboard bitmap", () => {
  it("creates a bottom-up, 32-bit BI_RGB bitmap for two rows", () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, // red top
      0, 255, 0, 255, // green top
      0, 0, 255, 255, // blue bottom
      255, 255, 255, 255, // white bottom
    ]);
    const dib = rgbaToDib(rgba, 2, 2);
    const header = new DataView(dib.buffer);
    expect(dib.length).toBe(56);
    expect(header.getUint32(0, true)).toBe(40);
    expect(header.getInt32(4, true)).toBe(2);
    expect(header.getInt32(8, true)).toBe(2);
    expect(header.getUint16(14, true)).toBe(32);
    expect(Array.from(dib.slice(40, 48))).toEqual([255, 0, 0, 0, 255, 255, 255, 0]);
    expect(Array.from(dib.slice(48, 56))).toEqual([0, 0, 255, 0, 0, 255, 0, 0]);
  });

  it("rejects unsupported photo sizes", () => {
    expect(() => rgbaToDib(new Uint8ClampedArray(4), 1601, 1)).toThrow();
    expect(() => rgbaToDib(new Uint8ClampedArray(4), 2, 2)).toThrow();
  });

  it("preserves Base64 encoding across chunk boundaries", () => {
    const bytes = new Uint8Array(70_001);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
