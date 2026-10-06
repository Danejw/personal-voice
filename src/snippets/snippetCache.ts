import type { KeyValueStorage } from "@/sync/personalCache";
import type { Snippet } from "@/snippets/snippet";
import { normalizeSnippetTrigger } from "@/snippets/snippet";

const CACHE_VERSION = 1;

function key(userId: string): string {
  return `snippets.cache.${userId}`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function parseSnippet(value: unknown): Snippet | null {
  const fields = record(value);
  if (
    typeof fields.id !== "string"
    || typeof fields.trigger !== "string"
    || typeof fields.content !== "string"
    || typeof fields.enabled !== "boolean"
    || typeof fields.createdAt !== "string"
    || typeof fields.updatedAt !== "string"
  ) return null;
  return {
    id: fields.id,
    trigger: fields.trigger,
    normalizedTrigger: typeof fields.normalizedTrigger === "string"
      ? fields.normalizedTrigger
      : normalizeSnippetTrigger(fields.trigger),
    content: fields.content,
    enabled: fields.enabled,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  };
}

/** Last server-confirmed snippets for this account. */
export function readSnippetCache(storage: KeyValueStorage, userId: string): Snippet[] {
  try {
    const fields = record(JSON.parse(storage.getItem(key(userId)) ?? "null"));
    if (fields.version !== CACHE_VERSION || !Array.isArray(fields.snippets)) return [];
    return fields.snippets.map(parseSnippet).filter((item): item is Snippet => item !== null);
  } catch {
    return [];
  }
}

export function writeSnippetCache(storage: KeyValueStorage, userId: string, snippets: readonly Snippet[]): void {
  try {
    storage.setItem(key(userId), JSON.stringify({ version: CACHE_VERSION, snippets }));
  } catch {
    // Cache failure must never block a server-confirmed snippet mutation or dictation.
  }
}
