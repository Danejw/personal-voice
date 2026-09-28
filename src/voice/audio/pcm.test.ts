import { describe, expect, it } from "vitest";
import { concatPcm, encodePcm16 } from "./pcm";

describe("pcm", () => {
  it("encodes clamped little-endian 16-bit samples", () => {
    const view = new DataView(encodePcm16(new Float32Array([0, 1, -1, 2, Number.NaN])));
    expect([0, 2, 4, 6, 8].map((offset) => view.getInt16(offset, true))).toEqual([0, 32767, -32768, 32767, 0]);
  });

  it("concatenates chunks in order", () => {
    const joined = concatPcm([new Uint8Array([1, 2]).buffer, new Uint8Array([]).buffer, new Uint8Array([3]).buffer]);
    expect([...new Uint8Array(joined)]).toEqual([1, 2, 3]);
  });
});
