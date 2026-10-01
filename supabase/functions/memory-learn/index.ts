// Reads saved Assistant user lines and asks Gemini 3.5 Flash-Lite only to highlight spans.
// The API key stays on the server. The commit RPC recomputes what may be stored.
// Not deployed. Gateway verify_jwt must be off, same as text-action, because publishable keys fail that check.
// Secrets: GEMINI_API_KEY. SUPABASE_URL is provided by the runtime.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";
import { EXTRACTOR_VERSION, filterModelSpan } from "./memoryLearn.ts";

const LEARN_MODEL = "gemini-3.5-flash-lite";
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${LEARN_MODEL}:generateContent`;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface BatchItem {
  id: string;
  body: string;
}

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** The signed-in user id, or null. The gateway's verify_jwt is off because it rejects publishable keys. */
async function signedInUser(req: Request): Promise<string | null> {
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseUrl}/auth/v1`, audience: "authenticated" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

async function rpc(name: string, body: unknown, authorization: string, apikey: string): Promise<unknown> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      apikey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error(`memory-learn: ${name} returned ${response.status}`);
    throw new Error("rpc failed");
  }
  return response.json();
}

function batchItems(value: unknown): BatchItem[] {
  if (!Array.isArray(value)) return [];
  const items: BatchItem[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { id?: unknown; body?: unknown };
    if (typeof record.id !== "string" || typeof record.body !== "string") continue;
    items.push({ id: record.id, body: record.body });
    if (items.length >= 8) break;
  }
  return items;
}

/** One text call for the batch. A failure leaves the SQL scan to decide. The body is not logged. */
async function proposeSpans(items: readonly BatchItem[], apiKey: string): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (!items.length) return found;
  const listed = items.map((item) => `id: ${item.id}\n${item.body.slice(0, 2000)}`).join("\n\n");
  let response: Response;
  try {
    response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "Return a JSON array of objects {\"id\",\"evidence\"}. evidence must be an exact substring that states the speaker's own preference, stable fact, or current project. If none, return []." }],
        },
        contents: [{ role: "user", parts: [{ text: listed }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    console.error("memory-learn: generate request did not complete");
    return found;
  }
  if (!response.ok) {
    console.error(`memory-learn: Gemini returned ${response.status}`);
    return found;
  }
  try {
    const text = modelText(await response.json());
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return found;
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as { id?: unknown; evidence?: unknown };
      if (typeof record.id !== "string" || typeof record.evidence !== "string") continue;
      const item = items.find((candidate) => candidate.id === record.id);
      if (!item || !filterModelSpan(item.body, record.evidence)) continue;
      const spans = found.get(record.id) ?? [];
      spans.push(record.evidence.trim());
      found.set(record.id, spans);
    }
  } catch {
    console.error("memory-learn: Gemini returned no spans");
  }
  return found;
}

function modelText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const candidates = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";
  const content = candidates[0] as { content?: { parts?: unknown } } | undefined;
  const parts = content?.content?.parts;
  if (!Array.isArray(parts)) return "";
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue;
    const record = part as { thought?: unknown; text?: unknown };
    if (record.thought === true || typeof record.text !== "string") continue;
    texts.push(record.text);
  }
  return texts.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  const userId = await signedInUser(req);
  const authorization = req.headers.get("Authorization");
  const apikey = req.headers.get("apikey");
  if (!userId || !authorization || !apikey) return reply(401, { error: "Sign in again to use memories." });

  let listed: unknown;
  try {
    listed = await rpc("list_assistant_learning_batch", { p_user_id: userId }, authorization, apikey);
  } catch {
    return reply(502, { error: "Couldn't read saved Assistant messages." });
  }
  const items = batchItems(listed);
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const spans = apiKey ? await proposeSpans(items, apiKey) : new Map<string, string[]>();
  if (!apiKey) console.error("memory-learn: generate is not configured");
  const batch = items.map((item) => ({ id: item.id, evidences: spans.get(item.id) ?? [] }));
  try {
    await rpc("commit_assistant_learning", { p_user_id: userId, p_batch: batch }, authorization, apikey);
  } catch {
    return reply(502, { error: "Couldn't save what was learned." });
  }
  return reply(200, { ok: true, extractor: EXTRACTOR_VERSION });
});
