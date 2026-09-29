// Rewrites captured text with Gemini 3.5 Flash-Lite. The API key stays on the server.
// Ephemeral tokens are Live-only, so this cannot reuse gemini-token.
// Secrets: GEMINI_API_KEY. SUPABASE_URL is provided by the runtime.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";
import {
  parseModelOutput,
  TEXT_ACTION_MODEL,
  textActionInputProblem,
  textActionRequestBody,
} from "./modelOutput.ts";

const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_ACTION_MODEL}:generateContent`;

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

function requestFields(body: unknown): { selection: string; instruction: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as { selection?: unknown; instruction?: unknown };
  if (typeof record.selection !== "string" || typeof record.instruction !== "string") return null;
  return { selection: record.selection, instruction: record.instruction };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  if (!await isSignedIn(req)) return reply(401, { error: "Sign in again to rewrite a selection." });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(500, { error: "The rewrite service is not configured." });

  const fields = requestFields(await req.json().catch(() => null));
  if (!fields) return reply(400, { error: "Send the selection and the instruction." });
  const problem = textActionInputProblem(fields.selection, fields.instruction);
  if (problem) return reply(400, { error: problem });

  let response: Response;
  try {
    response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(textActionRequestBody(fields.selection, fields.instruction)),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    console.error("text-action: generate request did not complete");
    return reply(502, { error: "Could not reach Gemini." });
  }
  if (!response.ok) {
    console.error(`text-action: Gemini returned ${response.status}`);
    return reply(502, { error: "Gemini refused the rewrite." });
  }
  try {
    const text = parseModelOutput(await response.json());
    return reply(200, { text });
  } catch {
    console.error("text-action: Gemini returned no text");
    return reply(502, { error: "The rewrite was empty." });
  }
});
