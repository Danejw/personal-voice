/**
 * Gemini ephemeral-token request for dictation or Assistant.
 * Both use v1alpha `auth_tokens` + constrained Live. Dictation locks
 * gemini-3.5-transcribe-live; Assistant locks gemini-3.8-live. Ephemeral
 * tokens on the constrained socket are proven on v1alpha in this app;
 * v1beta mint succeeds but the constrained session closes with 1011.
 * REST CreateAuthToken uses `bidiGenerateContentSetup` + `fieldMask`
 * (https://ai.google.dev/api/live#authToken).
 * This file is copied to `supabase/functions/gemini-token/tokenRequest.ts`. Keep the copies identical.
 */

export const DICTATION_MODEL = "models/gemini-3.5-transcribe-live";
export const ASSISTANT_MODEL = "models/gemini-3.8-live";
export const DICTATION_TOKEN_URL = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";
export const ASSISTANT_TOKEN_URL = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";

/** A cached, unused token must start its session within this window. */
const NEW_SESSION_WINDOW_MS = 2 * 60_000;
/** Covers a 5-minute utterance plus replay recovery, started at the end of the new-session window. */
const DICTATION_LIFETIME_MS = 15 * 60_000;
/** Documented Live default. This phase does not resume a session after it. */
const ASSISTANT_LIFETIME_MS = 30 * 60_000;

export type TokenPurpose = "dictation" | "assistant";

/**
 * Reads `purpose` from the token-function body.
 * A missing purpose is dictation, so existing clients keep the transcribe token.
 * Returns `invalid` when the body is not an object or names an unknown purpose.
 */
export function readTokenPurpose(body: unknown): TokenPurpose | "invalid" {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "invalid";
  const purpose = (body as { purpose?: unknown }).purpose;
  if (purpose === undefined) return "dictation";
  if (purpose === "dictation" || purpose === "assistant") return purpose;
  return "invalid";
}

export interface GeminiMintRequest {
  url: string;
  expireTime: string;
  newSessionExpireTime: string;
  body: unknown;
}

/** Google CreateAuthToken body for one purpose. The permanent API key is not part of this body. */
export function geminiMintRequest(purpose: TokenPurpose, now: number): GeminiMintRequest {
  const newSessionExpireTime = new Date(now + NEW_SESSION_WINDOW_MS).toISOString();
  if (purpose === "assistant") {
    const expireTime = new Date(now + ASSISTANT_LIFETIME_MS).toISOString();
    return {
      url: ASSISTANT_TOKEN_URL,
      expireTime,
      newSessionExpireTime,
      body: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        // Same pattern as dictation: lock the model; client setup sends AUDIO and the rest.
        bidiGenerateContentSetup: { model: ASSISTANT_MODEL },
        fieldMask: "model",
      },
    };
  }
  const expireTime = new Date(now + DICTATION_LIFETIME_MS).toISOString();
  return {
    url: DICTATION_TOKEN_URL,
    expireTime,
    newSessionExpireTime,
    body: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      bidiGenerateContentSetup: { model: DICTATION_MODEL },
      fieldMask: "model",
    },
  };
}
