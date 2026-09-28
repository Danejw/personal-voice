import { describe, expect, it } from "vitest";
import { CredentialError } from "../voice/provider/gemini/GeminiTokenSource";
import { parseTokenResponse } from "./geminiTokenService";

function failure(status: number, body: unknown): CredentialError {
  try {
    parseTokenResponse(status, body);
  } catch (error) {
    if (error instanceof CredentialError) return error;
  }
  throw new Error("expected a CredentialError");
}

describe("parseTokenResponse", () => {
  it("returns the token and its new-session deadline", () => {
    expect(parseTokenResponse(200, { token: "auth_tokens/x", newSessionExpireTime: "2026-09-28T00:02:00.000Z", expireTime: "later" }))
      .toEqual({ token: "auth_tokens/x", newSessionExpiresAt: Date.parse("2026-09-28T00:02:00.000Z") });
  });

  it("treats signed-out and not-allowed as non-retryable, with the server's message", () => {
    expect(failure(401, { error: "Sign in again to dictate." })).toMatchObject({ message: "Sign in again to dictate.", retryable: false });
    expect(failure(403, { error: "This account is not allowed to dictate." })).toMatchObject({ retryable: false });
  });

  it("treats server failures and malformed responses as retryable", () => {
    expect(failure(502, null)).toMatchObject({ message: "The token service failed (HTTP 502).", retryable: true });
    expect(failure(200, { token: "" })).toMatchObject({ retryable: true });
    expect(failure(200, { token: "auth_tokens/x", newSessionExpireTime: "not a date" })).toMatchObject({ retryable: true });
  });
});
