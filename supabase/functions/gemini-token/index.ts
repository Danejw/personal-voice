// Mints a short-lived Gemini Live credential for any signed-in user.
// Verified against https://ai.google.dev/gemini-api/docs/ephemeral-tokens and
// https://ai.google.dev/api/live#ephemeral-auth-tokens (Sep 2026).
// Secrets: GEMINI_API_KEY. SUPABASE_URL is provided by the runtime.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";

const MODEL = "models/gemini-3.5-transcribe-live";
const CREATE_TOKEN_URL = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";
/** A cached, unused token must start its session within this window. */
const NEW_SESSION_WINDOW_MS = 2 * 60_000;
/** Covers a 5-minute utterance plus replay recovery, started at the end of the new-session window. */
const TOKEN_LIFETIME_MS = 15 * 60_000;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** True for a valid user access token. The gateway's verify_jwt is off because it rejects publishable keys. */
async function isSignedIn(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseUrl}/auth/v1`, audience: "authenticated" });
    return typeof payload.sub === "string";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  if (!await isSignedIn(req)) return reply(401, { error: "Sign in again to dictate." });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(500, { error: "The token service is not configured." });

  const now = Date.now();
  const newSessionExpireTime = new Date(now + NEW_SESSION_WINDOW_MS).toISOString();
  const expireTime = new Date(now + TOKEN_LIFETIME_MS).toISOString();
  let response: Response;
  try {
    response = await fetch(CREATE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime,
        // Lock only the model; the client still sends its own transcription config.
        bidiGenerateContentSetup: { model: MODEL },
        fieldMask: "model",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error("gemini-token: token request did not complete");
    return reply(502, { error: "Could not reach Gemini." });
  }
  if (!response.ok) {
    // Status only: Google error bodies are not needed here and must never be echoed to the client.
    console.error(`gemini-token: Gemini returned ${response.status}`);
    return reply(502, { error: "Gemini refused the token request." });
  }
  const created = await response.json().catch(() => null) as { name?: unknown } | null;
  if (typeof created?.name !== "string") return reply(502, { error: "Gemini sent an unexpected token response." });
  return reply(200, { token: created.name, newSessionExpireTime, expireTime });
});
