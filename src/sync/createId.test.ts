import { describe, expect, it, vi } from "vitest";
import { createId } from "@/sync/createId";

describe("createId", () => {
  it("uses crypto.randomUUID when it exists", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID });
    expect(createId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const id = createId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getRandomValues).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
