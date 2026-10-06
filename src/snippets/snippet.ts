export interface Snippet {
  id: string;
  trigger: string;
  normalizedTrigger: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const MAX_SNIPPET_TRIGGER_LENGTH = 120;
export const MAX_SNIPPET_CONTENT_LENGTH = 20_000;

/**
 * Voice triggers are intentionally conservative: whole-utterance matching ignores
 * case, repeated whitespace, and ordinary trailing sentence punctuation only.
 */
export function normalizeSnippetTrigger(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.?!,;:]+$/g, "")
    .trim()
    .toLocaleLowerCase();
}

export function snippetProblem(trigger: string, content: string): string | null {
  const cleanTrigger = trigger.trim();
  const cleanContent = content.trim();
  if (!cleanTrigger) return "Give the snippet a voice trigger.";
  if (cleanTrigger.length > MAX_SNIPPET_TRIGGER_LENGTH) {
    return `Triggers can be at most ${MAX_SNIPPET_TRIGGER_LENGTH} characters.`;
  }
  if (!normalizeSnippetTrigger(cleanTrigger)) return "The trigger needs at least one word or character.";
  if (!cleanContent) return "Add the text this snippet should expand to.";
  if (cleanContent.length > MAX_SNIPPET_CONTENT_LENGTH) {
    return `Snippet text can be at most ${MAX_SNIPPET_CONTENT_LENGTH} characters.`;
  }
  return null;
}

export interface SnippetResolution {
  matched: boolean;
  text: string;
  snippetId?: string;
}

/** Exact whole-utterance lookup. No fuzzy or substring expansion. */
export function resolveSnippet(finalTranscript: string, snippets: readonly Snippet[]): SnippetResolution {
  const normalized = normalizeSnippetTrigger(finalTranscript);
  if (!normalized) return { matched: false, text: finalTranscript };
  const match = snippets.find((snippet) => snippet.enabled && snippet.normalizedTrigger === normalized);
  return match
    ? { matched: true, text: match.content, snippetId: match.id }
    : { matched: false, text: finalTranscript };
}
