// One supervised Computer Use step. The permanent key stays here.
// The client cannot choose an arbitrary model, the tool, or a shell command.
// Docs checked 2026-09-28: https://ai.google.dev/gemini-api/docs/computer-use
// Model gemini-3.8-flash, Interactions API, desktop environment, prompt-injection detection on.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";
import { PRIMARY_COMPUTER_MODEL, FALLBACK_COMPUTER_MODEL, requestComputerUseWithFallback, type ComputerUseModel } from "./retry.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

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
    model?: unknown;
    functionResult?: { name?: unknown; callId?: unknown; result?: unknown; acknowledgement?: unknown; image?: unknown };
  };
  const goal = typeof fields.goal === "string" ? fields.goal.trim() : "";
  if (!fields.previousInteractionId && (!goal || goal.length > 500)) {
    return reply(400, { error: "Say what the screen task should do." });
  }
  // A continuation must use the same model that produced its call ID.
  // The initial request always starts with the primary model.
  const continuation = typeof fields.previousInteractionId === "string" && !!fields.previousInteractionId;
  if (continuation && fields.model !== undefined &&
      fields.model !== PRIMARY_COMPUTER_MODEL && fields.model !== FALLBACK_COMPUTER_MODEL) {
    return reply(400, { error: "Invalid Computer Use continuation model." });
  }
  const selected: ComputerUseModel = continuation && fields.model === FALLBACK_COMPUTER_MODEL
    ? FALLBACK_COMPUTER_MODEL : PRIMARY_COMPUTER_MODEL;
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(500, { error: "Computer Use is not configured." });

  let body: Record<string, unknown>;
  if (typeof fields.previousInteractionId === "string" && fields.previousInteractionId && fields.functionResult) {
    const name = fields.functionResult.name;
    const callId = fields.functionResult.callId;
    const result = fields.functionResult.result;
    if (typeof name !== "string" || typeof callId !== "string" || !callId ||
        typeof result !== "string" || name === "run_shell") {
      return reply(400, { error: "That action is not available." });
    }
    const image = imageData(fields.functionResult.image);
    body = {
      model: selected,
      previous_interaction_id: fields.previousInteractionId,
      tools: [tool],
      input: [{
        type: "function_result",
        name,
        call_id: callId,
        result: [
          { type: "text", text: result.slice(0, 2000) },
          ...(image ? [{ type: "image", data: image, mime_type: "image/jpeg" }] : []),
        ],
        ...(fields.functionResult.acknowledgement === true ? { safety_acknowledgement: true } : {}),
      }],
    };
  } else {
    const image = imageData(fields.image);
    const input: unknown[] = [{ type: "text", text: goal }];
    if (image) input.push({ type: "image", data: image, mime_type: "image/jpeg" });
    body = { model: selected, tools: [tool], input };
  }

  let response: Response;
  let model: ComputerUseModel;
  try {
    const outcome = await requestComputerUseWithFallback(
      (candidate) => fetch(INTERACTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ ...body, model: candidate }),
        signal: AbortSignal.timeout(20_000),
      }),
      selected, !continuation,
      {
        onRetry: (status, attempt) => console.warn(
          `computer-step: transient provider ${status}; retry ${attempt}/2`,
        ),
      },
    );
    response = outcome.response;
    model = outcome.model;
    if (!continuation && model === FALLBACK_COMPUTER_MODEL) {
      console.warn("computer-step: primary model unavailable; used fallback model");
    }
  } catch {
    console.error("computer-step: request did not complete");
    return reply(502, { error: "Could not reach Computer Use." });
  }
  if (!response.ok) {
    // No raw upstream body, screenshots, prompts or credentials in logs.
    const upstream = await response.json().catch(() => null) as { error?: { status?: unknown; code?: unknown } } | null;
    const code = typeof upstream?.error?.status === "string"
      && /^[A-Z][A-Z_]{2,50}$/.test(upstream.error.status) ? upstream.error.status : "UNKNOWN";
    console.error(`computer-step: upstream HTTP ${response.status}; model=${model}; code=${code}`);
    if (response.status === 429) return reply(503, { error: "Computer Use is rate-limited. The task was not completed." });
    if (response.status === 401 || response.status === 403) {
      return reply(502, { error: "Computer Use upstream authentication or access failed. Check the server API key and model access." });
    }
    if (response.status === 400 || response.status === 404) {
      return reply(502, { error: `Computer Use rejected the request (upstream HTTP ${response.status}, ${code}). No action was completed.` });
    }
    return reply(502, { error: `Computer Use service failed (upstream HTTP ${response.status}). The task was not completed.` });
  }
  const interaction = await response.json().catch(() => null) as { id?: unknown; steps?: unknown; text?: unknown } | null;
  return reply(200, {
    model,
    id: interaction && typeof interaction.id === "string" ? interaction.id : null,
    steps: interaction && Array.isArray(interaction.steps) ? interaction.steps : [],
    text: interaction && typeof interaction.text === "string" ? interaction.text.slice(0, 1200) : "",
  });
});
