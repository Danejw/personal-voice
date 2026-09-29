import { getSupabase, supabaseConfig } from "@/services/supabase";
import { CredentialError } from "@/voice/provider/gemini/GeminiTokenSource";
import type { GeminiToken } from "@/voice/provider/gemini/GeminiTokenSource";

const FUNCTION_NAME = "gemini-token";

export type GeminiTokenPurpose = "dictation" | "assistant";

function tokenFailure(purpose: GeminiTokenPurpose, status: number): string {
  const subject = purpose === "assistant" ? "Assistant" : "transcription";
  return `Couldn't start ${subject} (token service error ${status}). Try again.`;
}

/**
 * POST for `gemini-token`. Dictation sends no body, which the function treats as
 * the existing transcribe token. Assistant names its purpose explicitly.
 */
export function geminiTokenFetchInit(
  accessToken: string,
  publishableKey: string,
  purpose: GeminiTokenPurpose = "dictation",
): RequestInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    apikey: publishableKey,
  };
  if (purpose === "assistant") {
    headers["Content-Type"] = "application/json";
    return { method: "POST", headers, body: JSON.stringify({ purpose: "assistant" }) };
  }
  return { method: "POST", headers };
}

/** Maps the `gemini-token` Edge Function response to a token or a typed failure. */
export function parseTokenResponse(status: number, body: unknown, purpose: GeminiTokenPurpose = "dictation"): GeminiToken {
  const fields = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (status < 200 || status >= 300) {
    const message = typeof fields.error === "string" ? fields.error : tokenFailure(purpose, status);
    // Signed out, not allowed, or a bad request cannot be fixed by retrying.
    throw new CredentialError(message, status !== 401 && status !== 403 && status !== 400);
  }
  const newSessionExpiresAt = typeof fields.newSessionExpireTime === "string" ? Date.parse(fields.newSessionExpireTime) : Number.NaN;
  if (typeof fields.token !== "string" || !fields.token || Number.isNaN(newSessionExpiresAt)) {
    throw new CredentialError("The token service sent an unexpected response.", true);
  }
  return { token: fields.token, newSessionExpiresAt };
}

/** Exchanges the signed-in Supabase session for a single-use Gemini Live token. */
export async function fetchGeminiToken(purpose: GeminiTokenPurpose = "dictation"): Promise<GeminiToken> {
  const client = getSupabase();
  if (!client || !supabaseConfig) throw new CredentialError("This build has no sign-in configuration.", false);
  // Refreshes the access token first if it has expired.
  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new CredentialError(purpose === "assistant" ? "Sign in to use Assistant." : "Sign in to dictate.", false);
  }

  let response: Response;
  try {
    response = await fetch(
      `${supabaseConfig.url}/functions/v1/${FUNCTION_NAME}`,
      geminiTokenFetchInit(accessToken, supabaseConfig.publishableKey, purpose),
    );
  } catch {
    const subject = purpose === "assistant" ? "Assistant" : "transcription";
    throw new CredentialError(`Couldn't connect to start ${subject}. Check your internet connection and try again.`, true);
  }
  return parseTokenResponse(response.status, await response.json().catch(() => null), purpose);
}
