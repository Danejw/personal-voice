import { describe, expect, it } from "vitest";
import { GeminiTokenSource } from "./GeminiTokenSource";
import type { GeminiToken } from "./GeminiTokenSource";

function source(windowMs = 120_000) {
  let clock = 0;
  let count = 0;
  const failures: Error[] = [];
  const fetched: string[] = [];
  const tokens = new GeminiTokenSource(async (): Promise<GeminiToken> => {
    const failure = failures.shift();
    if (failure) throw failure;
    const token = `t${++count}`;
    fetched.push(token);
    return { token, newSessionExpiresAt: clock + windowMs };
  }, () => clock);
  return { tokens, fetched, failures, advance: (ms: number) => { clock += ms; } };
}

describe("GeminiTokenSource", () => {
  it("hands out each token once and keeps exactly one replacement warm", async () => {
    const { tokens, fetched } = source();
    expect(await tokens.take()).toBe("t1");
    expect(await tokens.take()).toBe("t2");
    expect(fetched).toEqual(["t1", "t2", "t3"]);
  });

  it("uses a prefetched token while its new-session window is still safely open", async () => {
    const { tokens, fetched, advance } = source();
    tokens.prefetch();
    tokens.prefetch();
    advance(60_000);
    expect(await tokens.take()).toBe("t1");
    expect(fetched).toEqual(["t1", "t2"]);
  });

  it("discards a cached token that is about to stop accepting new sessions", async () => {
    const { tokens, advance } = source();
    tokens.prefetch();
    await Promise.resolve();
    advance(110_000);
    expect(await tokens.take()).toBe("t2");
  });

  it("falls back to a fresh fetch when the prefetch failed", async () => {
    const { tokens, failures } = source();
    failures.push(new Error("offline"));
    tokens.prefetch();
    expect(await tokens.take()).toBe("t1");
  });

  it("surfaces a failure when no token can be fetched", async () => {
    const { tokens, failures } = source();
    failures.push(new Error("signed out"));
    await expect(tokens.take()).rejects.toThrow("signed out");
  });

  it("forgets the cached token on clear", async () => {
    const { tokens, fetched } = source();
    tokens.prefetch();
    tokens.clear();
    expect(await tokens.take()).toBe("t2");
    expect(fetched[0]).toBe("t1");
  });
});
