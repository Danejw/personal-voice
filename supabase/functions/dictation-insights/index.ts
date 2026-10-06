// Dictation Insights semantic analysis. The API key stays on the server.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";
import {
  INSIGHTS_MODEL,
  insightRequestBody,
  parseChunkInsight,
  parseFinalInsight,
  parseGeminiJson,
} from "./model.ts";

const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${INSIGHTS_MODEL}:generateContent`;
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

function fields(value: unknown): { mode: "chunk" | "merge"; input: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as { mode?: unknown; input?: unknown };
  if ((body.mode !== "chunk" && body.mode !== "merge") || typeof body.input !== "string") return null;
  return { mode: body.mode, input: body.input };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  if (!await isSignedIn(req)) return reply(401, { error: "Sign in again to analyze Insights." });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(500, { error: "The Insights service is not configured." });

  const request = fields(await req.json().catch(() => null));
  if (!request) return reply(400, { error: "Send an Insights mode and input." });

  let payload: Record<string, unknown>;
  try {
    payload = insightRequestBody(request.mode, request.input);
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : "Invalid Insights input." });
  }

  let response: Response;
  try {
    response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    console.error("dictation-insights: generate request did not complete");
    return reply(502, { error: "Could not reach Gemini for Insights." });
  }

  if (!response.ok) {
    console.error(`dictation-insights: Gemini returned ${response.status}`);
    return reply(502, { error: "Gemini refused the Insights analysis." });
  }

  try {
    const json = parseGeminiJson(await response.json());
    return reply(200, request.mode === "chunk" ? parseChunkInsight(json) : parseFinalInsight(json));
  } catch {
    console.error("dictation-insights: Gemini returned invalid JSON");
    return reply(502, { error: "The Insights analysis was incomplete." });
  }
});
