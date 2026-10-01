import type { RecallHit, RecallSource } from "@/assistant/recall";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AssistantRecallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantRecallError";
  }
}

/** Reads the search RPC. A bad row is dropped. The list itself must be an object. */
export function recallFromPayload(value: unknown): { kind: "needs-query" | "hits"; hits: RecallHit[] } {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new AssistantRecallError("Saved material came back unreadable.");
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new AssistantRecallError("Saved material came back unreadable.");
  }
  const record = parsed as { kind?: unknown; hits?: unknown };
  if (record.kind === "needs-query") return { kind: "needs-query", hits: [] };
  if (record.kind !== "hits" || !Array.isArray(record.hits)) {
    throw new AssistantRecallError("Saved material came back unreadable.");
  }
  const hits: RecallHit[] = [];
  for (const entry of record.hits) {
    const hit = readHit(entry);
    if (hit) hits.push(hit);
    if (hits.length >= 5) break;
  }
  return { kind: "hits", hits };
}

function readHit(value: unknown): RecallHit | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const source = readSource(record.source);
  const id = readUuid(record.id);
  if (!source || !id) return null;
  const conversationId = record.conversation_id == null ? null : readUuid(record.conversation_id);
  if (record.conversation_id != null && !conversationId) return null;
  if (typeof record.snippet !== "string" || !record.snippet.trim()) return null;
  if (typeof record.at !== "string" || !record.at.trim()) return null;
  const rank = typeof record.rank === "number" ? record.rank : Number(record.rank);
  if (!Number.isFinite(rank) || rank < 0) return null;
  return {
    source,
    id,
    conversationId,
    at: record.at,
    snippet: record.snippet.trim().slice(0, 240),
    rank,
  };
}

function readSource(value: unknown): RecallSource | null {
  switch (value) {
    case "note":
    case "dictation":
    case "conversation":
    case "memory":
      return value;
    default:
      return null;
  }
}

function readUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}
