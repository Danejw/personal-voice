import { CredentialError } from "../voice/provider/gemini/GeminiTokenSource";
import type { GeminiToken } from "../voice/provider/gemini/GeminiTokenSource";
import { getSupabase, supabaseConfig } from "./supabase";

const FUNCTION_NAME = "gemini-token";

/** Maps the `gemini-token` Edge Function response to a token or a typed failure. */
export function parseTokenResponse(status: number, body: unknown): GeminiToken {
  const fields = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (status < 200 || status >= 300) {
    const message = typeof fields.error === "string" ? fields.error : `The token service failed (HTTP ${status}).`;
    // Signed out or not allowlisted cannot be fixed by retrying.
    throw new CredentialError(message, status !== 401 && status !== 403);
  }
  const newSessionExpiresAt = typeof fields.newSessionExpireTime === "string" ? Date.parse(fields.newSessionExpireTime) : Number.NaN;
  if (typeof fields.token !== "string" || !fields.token || Number.isNaN(newSessionExpiresAt)) {
    throw new CredentialError("The token service sent an unexpected response.", true);
  }
  return { token: fields.token, newSessionExpiresAt };
}

/** Exchanges the signed-in Supabase session for a single-use Gemini Live token. */
export async function fetchGeminiToken(): Promise<GeminiToken> {
  const client = getSupabase();
  if (!client || !supabaseConfig) throw new CredentialError("This build has no sign-in configuration.", false);
  // Refreshes the access token first if it has expired.
  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new CredentialError("Sign in to dictate.", false);

  let response: Response;
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, apikey: supabaseConfig.publishableKey },
    });
  } catch {
    throw new CredentialError("Could not reach the sign-in service. Check your connection.", true);
  }
  return parseTokenResponse(response.status, await response.json().catch(() => null));
}
