import { describe, expect, it, vi } from "vitest";
import { PRIMARY_COMPUTER_MODEL, FALLBACK_COMPUTER_MODEL, requestComputerUseWithFallback, retryTransientModelRequest } from "../../supabase/functions/computer-step/retry";

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
  it("fails over a first proposal after three provider 503s, preserving the selected model", async () => {
    const attempts: string[] = [];
    const send = vi.fn(async (model: string) => {
      attempts.push(model);
      return new Response(null, { status: model === PRIMARY_COMPUTER_MODEL ? 503 : 200 });
    });
    const result = await requestComputerUseWithFallback(send, PRIMARY_COMPUTER_MODEL, true, {
      sleep: async () => undefined,
    });
    expect(result.model).toBe(FALLBACK_COMPUTER_MODEL);
    expect(result.response.status).toBe(200);
    expect(attempts).toEqual([
      PRIMARY_COMPUTER_MODEL, PRIMARY_COMPUTER_MODEL, PRIMARY_COMPUTER_MODEL, FALLBACK_COMPUTER_MODEL,
    ]);
  });

  it("does not switch models on a continuation or an invalid/authentication response", async () => {
    const send = vi.fn(async () => new Response(null, { status: 503 }));
    const continued = await requestComputerUseWithFallback(send, PRIMARY_COMPUTER_MODEL, false, {
      sleep: async () => undefined,
    });
    expect(continued.response.status).toBe(503);
    expect(continued.model).toBe(PRIMARY_COMPUTER_MODEL);
    expect(send).toHaveBeenCalledTimes(3);
    const invalid = vi.fn(async () => new Response(null, { status: 403 }));
    const denied = await requestComputerUseWithFallback(invalid, PRIMARY_COMPUTER_MODEL, true);
    expect(denied.response.status).toBe(403);
    expect(invalid).toHaveBeenCalledTimes(1);
    const fallback = vi.fn(async () => new Response(null, { status: 503 }));
    const fallbackContinuation = await requestComputerUseWithFallback(fallback, FALLBACK_COMPUTER_MODEL, false, {
      sleep: async () => undefined,
    });
    expect(fallbackContinuation.model).toBe(FALLBACK_COMPUTER_MODEL);
    expect(fallback).toHaveBeenCalledTimes(3);
  });
});
