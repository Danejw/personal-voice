// One-time titles plus conservative reusable grouping for explicitly saved Notes.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";

const MODEL = "gemini-3.5-flash-lite";
const GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";
const MAX_NOTES = 40;
const MAX_GROUPS = 60;
const MAX_TEXT_CHARS = 2_000;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const jwks = createRemoteJWKSet(new URL(supabaseUrl + "/auth/v1/.well-known/jwks.json"));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface InputNote {
  id: string;
  text: string;
  title: string | null;
  groupId: string | null;
}

interface InputGroup {
  id: string;
  name: string;
}

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
    const { payload } = await jwtVerify(token, jwks, {
      issuer: supabaseUrl + "/auth/v1",
      audience: "authenticated",
    });
    return typeof payload.sub === "string";
  } catch {
    return false;
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function parseInput(body: unknown): { notes: InputNote[]; groups: InputGroup[] } | null {
  const root = objectOf(body);
  if (!root || !Array.isArray(root.notes) || !Array.isArray(root.groups)) return null;
  if (root.notes.length < 1 || root.notes.length > MAX_NOTES || root.groups.length > MAX_GROUPS) return null;

  const notes: InputNote[] = [];
  for (const value of root.notes) {
    const row = objectOf(value);
    if (!row || typeof row.id !== "string" || typeof row.text !== "string") return null;
    if (row.text.length > MAX_TEXT_CHARS) return null;
    if (row.title !== null && typeof row.title !== "string") return null;
    if (row.groupId !== null && typeof row.groupId !== "string") return null;
    notes.push({
      id: row.id,
      text: row.text,
      title: row.title as string | null,
      groupId: row.groupId as string | null,
    });
  }

  const groups: InputGroup[] = [];
  for (const value of root.groups) {
    const row = objectOf(value);
    if (!row || typeof row.id !== "string" || typeof row.name !== "string" || !row.name.trim()) return null;
    groups.push({ id: row.id, name: row.name.trim().slice(0, 120) });
  }

  return { notes, groups };
}

function modelText(body: unknown): string {
  const root = objectOf(body);
  const candidates = root?.candidates;
  if (!Array.isArray(candidates)) throw new Error("No candidate");
  const first = objectOf(candidates[0]);
  const content = objectOf(first?.content);
  const parts = content?.parts;
  if (!Array.isArray(parts)) throw new Error("No parts");
  const text = parts
    .map((part) => objectOf(part))
    .filter((part): part is Record<string, unknown> => Boolean(part) && part?.thought !== true)
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
  if (!text) throw new Error("No text");
  return text;
}

function cleanTitle(text: string): string {
  const first = text.trim().split(/\n|[.!?](?:\s|$)/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!first) return "Untitled note";
  return first.length <= 72 ? first : first.slice(0, 69).trimEnd() + "…";
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function sanitizeOutput(raw: unknown, notes: InputNote[], groups: InputGroup[]) {
  const root = objectOf(raw) ?? {};
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const existingByName = new Map(groups.map((group) => [nameKey(group.name), group]));
  const assigned = new Set<string>();

  const modelTitles = new Map<string, string>();
  if (Array.isArray(root.titles)) {
    for (const value of root.titles) {
      const row = objectOf(value);
      const note = typeof row?.noteId === "string" ? noteById.get(row.noteId) : undefined;
      const title = typeof row?.title === "string" ? row.title.trim().slice(0, 120) : "";
      if (note && note.title === null && title) modelTitles.set(note.id, title);
    }
  }

  const titles = notes
    .filter((note) => note.title === null)
    .map((note) => ({ noteId: note.id, title: modelTitles.get(note.id) ?? cleanTitle(note.text) }));

  const existingGroupAssignments: { noteId: string; groupId: string }[] = [];
  if (Array.isArray(root.existingGroupAssignments)) {
    for (const value of root.existingGroupAssignments) {
      const row = objectOf(value);
      const note = typeof row?.noteId === "string" ? noteById.get(row.noteId) : undefined;
      const group = typeof row?.groupId === "string" ? groupById.get(row.groupId) : undefined;
      if (!note || note.groupId !== null || !group || assigned.has(note.id)) continue;
      assigned.add(note.id);
      existingGroupAssignments.push({ noteId: note.id, groupId: group.id });
    }
  }

  const newGroups: { name: string; noteIds: string[] }[] = [];
  if (Array.isArray(root.newGroups)) {
    for (const value of root.newGroups) {
      const row = objectOf(value);
      const name = typeof row?.name === "string" ? row.name.trim().slice(0, 120) : "";
      const rawIds = Array.isArray(row?.noteIds) ? row.noteIds : [];
      const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string"))]
        .filter((id) => {
          const note = noteById.get(id);
          return Boolean(note && note.groupId === null && !assigned.has(id));
        });
      if (!name || ids.length < 3) continue;

      const existing = existingByName.get(nameKey(name));
      if (existing) {
        for (const id of ids) {
          assigned.add(id);
          existingGroupAssignments.push({ noteId: id, groupId: existing.id });
        }
        continue;
      }

      for (const id of ids) assigned.add(id);
      newGroups.push({ name, noteIds: ids });
    }
  }

  return { titles, existingGroupAssignments, newGroups };
}

function promptFor(notes: InputNote[], groups: InputGroup[]): string {
  return [
    "Organize personal notes for fast visual scanning.",
    "",
    "Rules:",
    "- Generate a concise 3-8 word title ONLY when a note's title is null. Never rewrite an existing title.",
    "- Prefer an existing group whenever it clearly fits.",
    "- Never move a note that already has a groupId.",
    "- It is fine to leave a note ungrouped.",
    "- Create a new group only when at least THREE currently ungrouped notes share a clear durable topic/project.",
    "- Never create a new group for one or two notes, vague similarity, or a one-off subject.",
    "- Group names should be concise, stable project/topic names, not sentences.",
    "- Do not create duplicates or near-duplicates of existing group names.",
    "",
    "Return JSON only with exactly these keys:",
    '{"titles":[{"noteId":"...","title":"..."}],"existingGroupAssignments":[{"noteId":"...","groupId":"..."}],"newGroups":[{"name":"...","noteIds":["...","...","..."]}]}',
    "",
    "Existing groups:",
    JSON.stringify(groups),
    "",
    "Notes:",
    JSON.stringify(notes),
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  if (!await isSignedIn(req)) return reply(401, { error: "Sign in again to organize notes." });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(500, { error: "The note organizer is not configured." });

  const input = parseInput(await req.json().catch(() => null));
  if (!input) return reply(400, { error: "Send valid notes and groups to organize." });

  let response: Response;
  try {
    response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are a conservative notes librarian. Preserve stable user organization. Return only valid JSON.",
          }],
        },
        contents: [{ role: "user", parts: [{ text: promptFor(input.notes, input.groups) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    console.error("notes-organize: generate request did not complete");
    return reply(502, { error: "Could not reach the note organizer." });
  }

  if (!response.ok) {
    console.error("notes-organize: Gemini returned " + response.status);
    return reply(502, { error: "The note organizer refused the request." });
  }

  try {
    const parsed = JSON.parse(modelText(await response.json()));
    return reply(200, sanitizeOutput(parsed, input.notes, input.groups));
  } catch {
    console.error("notes-organize: invalid model output");
    return reply(502, { error: "The note organizer returned invalid data." });
  }
});
