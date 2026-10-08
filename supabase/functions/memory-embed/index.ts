// PR16: authenticated per-account memory indexing and hybrid retrieval.
// Gemini API credentials never reach the Tauri client. No paid work happens unless invoked.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";

const MODEL = "gemini-embedding-2";
const DIMENSIONS = 1536;
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const GOOGLE_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const ACCEPTED_MIME: Record<string, "image" | "audio" | "video" | "pdf"> = {
  "image/png": "image",
  "image/jpeg": "image",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "video/mp4": "video",
  "video/quicktime": "video",
  "application/pdf": "pdf",
};

type Item = {
  id: string; kind: "memory" | "note" | "message" | "dictation" | "asset";
  fingerprint: string; text: string; leaseToken: string;
  assetPath?: string | null; mimeType?: string | null;
};
function reply(status: number, data: Record<string, unknown>): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
async function account(auth: string | null): Promise<string | null> {
  const token = auth?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`, audience: "authenticated",
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
async function rpc(name: string, body: Record<string, unknown>, auth: string, apiKey: string): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: auth, apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Supabase RPC ${name} failed: HTTP ${response.status}`);
  return response.json();
}
function validateVector(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") throw new Error("Gemini returned an invalid embedding.");
  const obj = payload as { embedding?: { values?: unknown }; embeddings?: { values?: unknown }[] };
  const values = obj.embedding?.values ?? obj.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== DIMENSIONS ||
      !values.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new Error("Gemini returned incorrect embedding dimensions.");
  }
  return values;
}
async function embed(part: Record<string, unknown>): Promise<number[]> {
  if (!GOOGLE_KEY) throw new Error("Gemini embedding service is not configured.");
  const response = await fetch(EMBED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GOOGLE_KEY },
    body: JSON.stringify({
      model: `models/${MODEL}`, content: { parts: [part] },
      output_dimensionality: DIMENSIONS,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Gemini embedding failed: HTTP ${response.status}`);
  return validateVector(await response.json());
}
function asBase64(bytes: Uint8Array): string {
  let output = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    output += String.fromCharCode(...chunk);
  }
  return btoa(output);
}
async function attachment(item: Item, auth: string, apiKey: string): Promise<{
  part: Record<string, unknown>; modality: "image" | "audio" | "video" | "pdf";
}> {
  const mime = item.mimeType ?? "";
  const modality = ACCEPTED_MIME[mime];
  if (!modality || !item.assetPath || !/^[0-9a-f-]{36}\//i.test(item.assetPath) ||
      item.assetPath.includes("..")) throw new Error("Unsupported or invalid memory attachment.");
  const path = item.assetPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/assistant-memory/${path}`, {
    headers: { Authorization: auth, apikey: apiKey }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Private memory attachment could not be read.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 7340032) throw new Error("Attachment exceeds inline embedding limit.");
  // Provider duration/page limits are also enforced by Gemini. Unsupported longer
  // media must be chunked before indexing, not mislabeled as successfully indexed.
  return { modality, part: { inline_data: { mime_type: mime, data: asBase64(bytes) } } };
}
/** Conservative extraction of named entities from explicitly remembered text only. */
async function extractEntities(item: Item, uid: string, auth: string, apiKey: string): Promise<void> {
  if (item.kind !== "memory" || !item.text || !GOOGLE_KEY) return;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GOOGLE_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text:
          "Extract at most 4 clear named entities from a person's explicit saved memory. " +
          "Return ONLY JSON array items {kind,label,evidence}. kind must be one of person, project, organization, goal, concept, decision, event. " +
          "label must be an exact substring of evidence, and evidence an exact substring of input. " +
          "Do not infer sensitive traits, identity, diagnoses, or relationships. Return [] when unsupported."
        }] },
        contents: [{ role: "user", parts: [{ text: item.text.slice(0, 1200) }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return;
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const json = body.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("") ?? "[]";
    const proposals: unknown = JSON.parse(json);
    if (!Array.isArray(proposals)) return;
    for (const row of proposals.slice(0, 4)) {
      if (!row || typeof row !== "object") continue;
      const proposal = row as Record<string, unknown>;
      const kind = proposal.kind, label = proposal.label, evidence = proposal.evidence;
      if (typeof kind !== "string" || typeof label !== "string" || typeof evidence !== "string" ||
        !item.text.toLocaleLowerCase().includes(evidence.toLocaleLowerCase()) ||
        !evidence.toLocaleLowerCase().includes(label.toLocaleLowerCase())) continue;
      await rpc("assistant_memory_link_entity", {
        p_user_id: uid, p_source_id: item.id, p_kind: kind, p_label: label, p_evidence: evidence,
      }, auth, apiKey).catch(() => undefined);
    }
  } catch {
    // Entity extraction is optional enrichment; indexing itself has already succeeded.
  }
}

async function indexBatch(uid: string, auth: string, apiKey: string): Promise<Record<string, unknown>> {
  await rpc("assistant_memory_queue_sources", { p_user_id: uid, p_limit: 40 }, auth, apiKey);
  const batch = await rpc("assistant_memory_claim_batch", { p_user_id: uid, p_limit: 3 }, auth, apiKey);
  if (!Array.isArray(batch)) throw new Error("Malformed memory job response.");
  let done = 0;
  let failed = 0;
  for (const raw of batch) {
    const item = raw as Item;
    try {
      if (typeof item.id !== "string" || typeof item.fingerprint !== "string" || typeof item.leaseToken !== "string") throw new Error("Malformed memory job.");
      const media = item.kind === "asset"
        ? await attachment(item, auth, apiKey)
        : { modality: "text" as const, part: {
            text: `title: none | text: ${item.text.slice(0, 12000)}`,
          } };
      const vector = await embed(media.part);
      const committed = await rpc("assistant_memory_complete_embedding", {
        p_user_id: uid, p_source_id: item.id, p_fingerprint: item.fingerprint,
        p_modality: media.modality, p_values: JSON.stringify(vector), p_lease_token: item.leaseToken,
      }, auth, apiKey);
      if (committed === true) {
        done++;
        await extractEntities(item, uid, auth, apiKey);
      } else failed++;
    } catch (error) {
      failed++;
      if (typeof item?.id === "string" && typeof item?.fingerprint === "string") {
        await rpc("assistant_memory_fail_embedding", {
          p_user_id: uid, p_source_id: item.id, p_fingerprint: item.fingerprint, p_lease_token: item.leaseToken,
        }, auth, apiKey).catch(() => undefined);
      }
      console.error("memory-embed: one source failed", error instanceof Error ? error.message : "Unknown error");
    }
  }
  return { processed: done, failed, claimed: batch.length, model: MODEL, dimensions: DIMENSIONS };
}
async function search(query: string, uid: string, auth: string, apiKey: string) {
  if (query.length < 2 || query.length > 300) return reply(400, { error: "Query length must be 2 to 300 characters." });
  // Search remains useful as keyword-only when embedding configuration is unavailable.
  let vector: string | null = null;
  if (GOOGLE_KEY) {
    try { vector = JSON.stringify(await embed({ text: `task: search result | query: ${query}` })); }
    catch (error) {
      console.error("memory-embed: semantic retrieval unavailable", error instanceof Error ? error.message : "Unknown error");
    }
  }
  const hits = await rpc("search_assistant_memory_hybrid", {
    p_user_id: uid, p_query: query, p_query_vector: vector, p_limit: 8,
  }, auth, apiKey);
  return reply(200, { hits: Array.isArray(hits) ? hits : [], mode: vector ? "hybrid" : "keyword", dimensions: DIMENSIONS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  const auth = req.headers.get("authorization");
  const apiKey = req.headers.get("apikey");
  const uid = await account(auth);
  if (!uid || !auth || !apiKey) return reply(401, { error: "Sign in to use personal memory." });
  let body: { action?: unknown; query?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Expected JSON body." }); }
  try {
    if (body.action === "index") return reply(200, await indexBatch(uid, auth, apiKey));
    if (body.action === "search" && typeof body.query === "string") {
      return await search(body.query.trim(), uid, auth, apiKey);
    }
    return reply(400, { error: "Unknown memory action." });
  } catch (error) {
    console.error("memory-embed: request failed", error instanceof Error ? error.message : "Unknown error");
    return reply(502, { error: "Memory service is temporarily unavailable." });
  }
});
