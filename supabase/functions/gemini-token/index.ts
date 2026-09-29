// Mints a short-lived Gemini Live credential for any signed-in user.
// Default (no purpose) stays gemini-3.5-transcribe-live on v1alpha.
// `{ "purpose": "assistant" }` locks gemini-3.8-live on v1alpha.
// Verified against https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens (2026-09-15).
// Secrets: GEMINI_API_KEY. SUPABASE_URL is provided by the runtime.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";
import { geminiMintRequest, readTokenPurpose } from "./tokenRequest.ts";

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

  const raw = await req.text();
  let purpose: "dictation" | "assistant" = "dictation";
  if (raw.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply(400, { error: "The token request was not valid." });
    }
    const read = readTokenPurpose(parsed);
    if (read === "invalid") return reply(400, { error: "The token request was not valid." });
    purpose = read;
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(500, { error: "The token service is not configured." });

  const minted = geminiMintRequest(purpose, Date.now());
  let response: Response;
  try {
    response = await fetch(minted.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(minted.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error("gemini-token: token request did not complete");
    return reply(502, { error: "Could not reach Gemini." });
  }
  if (!response.ok) {
    // Status + Google's short message for ops; never echo the body to the client.
    const googleBody = await response.text().catch(() => "");
    const googleMessage = (() => {
      try {
        const parsed = JSON.parse(googleBody) as { error?: { message?: unknown } };
        const message = parsed.error?.message;
        return typeof message === "string" ? message.slice(0, 200) : "";
      } catch {
        return "";
      }
    })();
    console.error(`gemini-token: Gemini returned ${response.status}${googleMessage ? ` (${googleMessage})` : ""}`);
    return reply(502, { error: "Gemini refused the token request." });
  }
  const created = await response.json().catch(() => null) as { name?: unknown } | null;
  if (typeof created?.name !== "string") return reply(502, { error: "Gemini sent an unexpected token response." });
  return reply(200, { token: created.name, newSessionExpireTime: minted.newSessionExpireTime, expireTime: minted.expireTime });
});
