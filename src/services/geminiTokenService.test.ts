import { describe, expect, it } from "vitest";
import { geminiTokenFetchInit, parseTokenResponse } from "@/services/geminiTokenService";
import { CredentialError } from "@/voice/provider/gemini/GeminiTokenSource";

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
    expect(failure(502, null)).toMatchObject({ message: "Couldn't start transcription (token service error 502). Try again.", retryable: true });
    expect(failure(200, { token: "" })).toMatchObject({ retryable: true });
    expect(failure(200, { token: "auth_tokens/x", newSessionExpireTime: "not a date" })).toMatchObject({ retryable: true });
  });

  it("does not retry a rejected token request", () => {
    expect(failure(400, { error: "The token request was not valid." })).toMatchObject({ retryable: false });
  });

  it("uses Assistant wording when that purpose fails", () => {
    expect(() => parseTokenResponse(502, null, "assistant")).toThrow(CredentialError);
    try {
      parseTokenResponse(502, null, "assistant");
    } catch (error) {
      expect(error).toMatchObject({ message: "Couldn't start Assistant (token service error 502). Try again.", retryable: true });
    }
  });
});

describe("geminiTokenFetchInit", () => {
  it("sends no body for dictation", () => {
    const init = geminiTokenFetchInit("access-token", "publishable");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(JSON.stringify(init.headers)).not.toContain("assistant");
  });

  it("sends only the assistant purpose in the body", () => {
    const init = geminiTokenFetchInit("access-token", "publishable", "assistant");
    expect(init.body).toBe(JSON.stringify({ purpose: "assistant" }));
    expect(String(init.body)).not.toContain("access-token");
  });
});
