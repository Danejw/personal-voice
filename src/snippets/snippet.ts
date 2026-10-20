export interface Snippet {
  id: string;
  /** Comma-separated voice triggers, in the order the user saved them. */
  trigger: string;
  /** Individual voice triggers. Legacy rows have exactly one. */
  triggers: string[];
  /** Case-folded form of the first trigger. Kept for existing comparisons. */
  normalizedTrigger: string;
  /** Compact match keys, one per trigger. Equivalent phrases share a key. */
  normalizedTriggers: string[];
  /** Compact reference token, without `@`, taken from the first trigger. */
  slug: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const MAX_SNIPPET_TRIGGER_LENGTH = 120;
export const MAX_SNIPPET_TRIGGERS = 12;
export const MAX_SNIPPET_TRIGGER_FIELD_LENGTH = 1_600;
export const MAX_SNIPPET_CONTENT_LENGTH = 20_000;

export interface StoredSnippetFields {
  id: string;
  trigger: string;
  triggers?: readonly string[] | null;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Voice triggers ignore case, repeated whitespace, and ordinary trailing
 * sentence punctuation. This is the display/dedupe form, not the match key.
 */
export function normalizeSnippetTrigger(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.?!,;:]+$/g, "")
    .trim()
    .toLocaleLowerCase();
}

/**
 * Match key for one phrase. Hyphens and spaces are removed after ordinary
 * normalization, so "Top Load.", "top-load", and "topload" share `topload`.
 * Apostrophes and other punctuation stay, and this is not an edit-distance match.
 */
export function compactSnippetTrigger(raw: string): string {
  return normalizeSnippetTrigger(raw).replace(/[-\s]+/g, "");
}

/** Reference token for the first trigger, such as `topload` in `@topload`. */
export function snippetSlug(raw: string): string {
  return compactSnippetTrigger(raw).replace(/[^\p{L}\p{N}]/gu, "");
}

export function snippetReference(snippet: Pick<Snippet, "slug">): string {
  return `@${snippet.slug}`;
}

function cleanPhrase(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Splits a voice-trigger field on commas. Trims each phrase, drops empties,
 * and drops repeats that are the same after ordinary normalization.
 * Hyphen, space, and joined variants are kept so the editor can show them.
 */
export function parseSnippetTriggers(raw: string): string[] {
  const seen = new Set<string>();
  const triggers: string[] = [];
  for (const part of raw.split(",")) {
    const phrase = cleanPhrase(part);
    const key = normalizeSnippetTrigger(phrase);
    if (!phrase || !key || seen.has(key)) continue;
    seen.add(key);
    triggers.push(phrase);
  }
  return triggers;
}

export function formatSnippetTriggers(triggers: readonly string[]): string {
  return triggers.join(", ");
}

/**
 * Rebuilds a snippet from storage. A saved `triggers` array is kept as written.
 * Older rows and caches only have `trigger`, which stays one phrase even if it
 * contains a comma.
 */
export function snippetFromStored(fields: StoredSnippetFields): Snippet | null {
  const stored = fields.triggers?.map(cleanPhrase).filter((phrase) => normalizeSnippetTrigger(phrase));
  const triggers = stored && stored.length
    ? dedupePhrases(stored)
    : dedupePhrases([cleanPhrase(fields.trigger)].filter((phrase) => phrase));
  const primary = triggers[0];
  if (!primary || !fields.id || !fields.content) return null;
  return {
    id: fields.id,
    trigger: formatSnippetTriggers(triggers),
    triggers,
    normalizedTrigger: normalizeSnippetTrigger(primary),
    normalizedTriggers: triggers.map(compactSnippetTrigger).filter((key) => key),
    slug: snippetSlug(primary),
    content: fields.content,
    enabled: fields.enabled,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  };
}

function dedupePhrases(phrases: readonly string[]): string[] {
  const seen = new Set<string>();
  const triggers: string[] = [];
  for (const phrase of phrases) {
    const key = normalizeSnippetTrigger(phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    triggers.push(phrase);
  }
  return triggers;
}

export function snippetProblem(trigger: string, content: string): string | null {
  const cleanContent = content.trim();
  if (trigger.trim().length > MAX_SNIPPET_TRIGGER_FIELD_LENGTH) {
    return `Voice triggers can be at most ${MAX_SNIPPET_TRIGGER_FIELD_LENGTH} characters.`;
  }
  if (!trigger.trim()) return "Give the snippet a voice trigger.";
  const triggers = parseSnippetTriggers(trigger);
  if (!triggers.length) return "The trigger needs at least one word or character.";
  if (triggers.length > MAX_SNIPPET_TRIGGERS) {
    return `A snippet can have at most ${MAX_SNIPPET_TRIGGERS} voice triggers.`;
  }
  for (const phrase of triggers) {
    if (phrase.length > MAX_SNIPPET_TRIGGER_LENGTH) {
      return `Each trigger can be at most ${MAX_SNIPPET_TRIGGER_LENGTH} characters.`;
    }
    if (!compactSnippetTrigger(phrase)) return "The trigger needs at least one word or character.";
    if (!snippetSlug(phrase)) return "The trigger needs at least one letter or number.";
  }
  if (!cleanContent) return "Add the text this snippet should expand to.";
  if (cleanContent.length > MAX_SNIPPET_CONTENT_LENGTH) {
    return `Snippet text can be at most ${MAX_SNIPPET_CONTENT_LENGTH} characters.`;
  }
  return null;
}

/**
 * Equivalent triggers on another snippet, or the same `@slug` from the first
 * trigger. The snippet being edited is ignored. Disabled snippets still reserve
 * their triggers so enabling one later cannot create a silent collision.
 */
export function snippetTriggerConflict(
  triggers: readonly string[],
  snippets: readonly Snippet[],
  editingId?: string,
): string | null {
  const others = snippets.filter((snippet) => snippet.id !== editingId);
  for (const phrase of triggers) {
    const key = compactSnippetTrigger(phrase);
    if (!key) continue;
    const owner = others.find((snippet) => snippet.normalizedTriggers.includes(key));
    if (owner) {
      return `“${phrase}” matches a voice trigger already used by “${owner.trigger}”.`;
    }
  }
  const primary = triggers[0];
  const slug = primary ? snippetSlug(primary) : "";
  if (!slug) return null;
  const sameReference = others.find((snippet) => snippet.slug === slug);
  if (!sameReference) return null;
  return `“${primary}” uses @${slug}, which is already used by “${sameReference.trigger}”.`;
}

export interface SnippetResolution {
  matched: boolean;
  text: string;
  snippetId?: string;
}

export type SnippetMatch =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "match"; snippet: Snippet };

/** Whole-utterance lookup across every trigger. More than one snippet is not a match. */
export function matchSnippet(finalTranscript: string, snippets: readonly Snippet[]): SnippetMatch {
  const key = compactSnippetTrigger(finalTranscript);
  if (!key) return { kind: "none" };
  const hits = snippets.filter((snippet) =>
    snippet.enabled && snippet.normalizedTriggers.includes(key));
  if (hits.length > 1) return { kind: "ambiguous" };
  const match = hits[0];
  return match ? { kind: "match", snippet: match } : { kind: "none" };
}

/** Compact `@slug` for a whole-utterance trigger, or null when it is not a unique match. */
export function referenceForUtterance(finalTranscript: string, snippets: readonly Snippet[]): string | null {
  const match = matchSnippet(finalTranscript, snippets);
  return match.kind === "match" ? snippetReference(match.snippet) : null;
}

/** Exact whole-utterance lookup. A unique match expands to the saved text. */
export function resolveSnippet(finalTranscript: string, snippets: readonly Snippet[]): SnippetResolution {
  const match = matchSnippet(finalTranscript, snippets);
  switch (match.kind) {
    case "match":
      return { matched: true, text: match.snippet.content, snippetId: match.snippet.id };
    case "none":
    case "ambiguous":
      return { matched: false, text: finalTranscript };
    default: {
      const unhandled: never = match;
      return unhandled;
    }
  }
}

const AMBIGUOUS = Symbol("ambiguous-snippet-reference");

/**
 * Replaces standalone `@slug` tokens with that snippet's saved text.
 * A slug owned by more than one snippet is left untouched.
 */
export function expandSnippetReferences(text: string, snippets: readonly Snippet[]): string {
  const bySlug = new Map<string, Snippet | typeof AMBIGUOUS>();
  for (const snippet of snippets) {
    if (!snippet.enabled || !snippet.slug) continue;
    const key = snippet.slug.toLocaleLowerCase();
    const existing = bySlug.get(key);
    if (existing && existing !== AMBIGUOUS && existing.id !== snippet.id) {
      bySlug.set(key, AMBIGUOUS);
      continue;
    }
    if (!existing) bySlug.set(key, snippet);
  }
  return text.replace(/(^|[^\p{L}\p{N}])@([\p{L}\p{N}]+)/gu, (full, prefix: string, slug: string) => {
    const found = bySlug.get(slug.toLocaleLowerCase());
    if (!found || found === AMBIGUOUS) return full;
    return `${prefix}${found.content}`;
  });
}

/** Snippets whose name or any trigger contains the slash-command query. */
export function snippetSuggestions(query: string, snippets: readonly Snippet[]): Snippet[] {
  const needle = query.trim().toLocaleLowerCase();
  return snippets.filter((snippet) => snippet.enabled && (
    !needle
    || snippet.slug.toLocaleLowerCase().includes(needle)
    || snippet.triggers.some((trigger) => trigger.toLocaleLowerCase().includes(needle))
  )).slice(0, 8);
}

/** The `/query` token immediately before the caret, if the user is invoking a snippet. */
export function slashToken(text: string, caret: number): { start: number; query: string } | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, safeCaret);
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  if (!match) return null;
  const slash = before.lastIndexOf("/");
  if (slash < 0) return null;
  return { start: slash, query: match[1] ?? "" };
}
