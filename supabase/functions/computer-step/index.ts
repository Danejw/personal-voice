// One supervised Computer Use step. The permanent key stays here.
// The client cannot choose the model, the tool, or a shell command.
// Docs checked 2026-09-28: https://ai.google.dev/gemini-api/docs/computer-use
// Model gemini-3.8-flash, Interactions API, desktop environment, prompt-injection detection on.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.8-flash";
const IMAGE_LIMIT = 2_000_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const tool = {
  type: "computer_use",
  environment: "desktop",
  enable_prompt_injection_detection: true,
  excluded_predefined_functions: ["drag_and_drop", "mouse_down", "mouse_up", "key_down", "key_up", "navigate"],
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

function imageData(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > IMAGE_LIMIT) return null;
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  if (!await isSignedIn(req)) return reply(401, { error: "Sign in again." });

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return reply(400, { error: "The screen task request was not valid." });
  }
  if (typeof parsed !== "object" || parsed === null) return reply(400, { error: "The screen task request was not valid." });
  const fields = parsed as {
    goal?: unknown;
    image?: unknown;
    previousInteractionId?: unknown;
    functionResult?: { name?: unknown; result?: unknown; acknowledgement?: unknown; image?: unknown };
  };
  const goal = typeof fields.goal === "string" ? fields.goal.trim() : "";
  if (!fields.previousInteractionId && (!goal || goal.length > 500)) {
    return reply(400, { error: "Say what the screen task should do." });
  }
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(500, { error: "Computer Use is not configured." });

  let body: Record<string, unknown>;
  if (typeof fields.previousInteractionId === "string" && fields.previousInteractionId && fields.functionResult) {
    const name = fields.functionResult.name;
    const result = fields.functionResult.result;
    if (typeof name !== "string" || typeof result !== "string" || name === "run_shell") {
      return reply(400, { error: "That action is not available." });
    }
    const image = imageData(fields.functionResult.image);
    body = {
      model: MODEL,
      previous_interaction_id: fields.previousInteractionId,
      tools: [tool],
      input: [{
        type: "function_result",
        name,
        result: [{ type: "text", text: result.slice(0, 2000) }],
        ...(fields.functionResult.acknowledgement === true ? { safety_acknowledgement: true } : {}),
        ...(image ? { parts: [{ type: "image", data: image, mime_type: "image/jpeg" }] } : {}),
      }],
    };
  } else {
    const image = imageData(fields.image);
    const input: unknown[] = [{ type: "text", text: goal }];
    if (image) input.push({ type: "image", data: image, mime_type: "image/jpeg" });
    body = { model: MODEL, tools: [tool], input };
  }

  let response: Response;
  try {
    response = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    console.error("computer-step: request did not complete");
    return reply(502, { error: "Could not reach Computer Use." });
  }
  if (!response.ok) {
    console.error(`computer-step: interactions status ${response.status}`);
    return reply(502, { error: "Computer Use did not accept that step." });
  }
  const interaction = await response.json().catch(() => null) as { id?: unknown; steps?: unknown } | null;
  return reply(200, {
    id: interaction && typeof interaction.id === "string" ? interaction.id : null,
    steps: interaction && Array.isArray(interaction.steps) ? interaction.steps : [],
  });
});
