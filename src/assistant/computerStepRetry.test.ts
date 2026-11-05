import { describe, expect, it, vi } from "vitest";
import { retryTransientModelRequest } from "../../supabase/functions/computer-step/retry";

describe("Computer Use model recovery", () => {
  it("recovers after provider 503s without creating any native action", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn(async (ms: number) => { expect(ms).toBeGreaterThan(0); });
    const retried: Array<number | "network"> = [];
    const result = await retryTransientModelRequest(send, {
      sleep,
      onRetry: status => retried.push(status),
    });
    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(3);
    expect(retried).toEqual([503, 503]);
    expect(sleep.mock.calls.map(args => args[0])).toEqual([500, 1000]);
  });

  it("returns a persistent 503 after three bounded requests", async () => {
    const send = vi.fn(async () => new Response(null, { status: 503 }));
    const result = await retryTransientModelRequest(send, { sleep: async () => undefined });
    expect(result.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("never retries permanent authentication or invalid-input responses", async () => {
    for (const code of [400, 401, 403, 404]) {
      const send = vi.fn(async () => new Response(null, { status: code }));
      const result = await retryTransientModelRequest(send, { sleep: async () => undefined });
      expect(result.status).toBe(code);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it("retries a temporary network error and propagates non-network errors", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect((await retryTransientModelRequest(send, { sleep: async () => undefined })).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    const permanent = vi.fn(async () => { throw new Error("Invalid request state"); });
    await expect(retryTransientModelRequest(permanent, { sleep: async () => undefined }))
      .rejects.toThrow("Invalid request state");
    expect(permanent).toHaveBeenCalledTimes(1);
  });
});
