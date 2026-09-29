/**
 * Word tokens from a finalized transcript. Gemini SMART cleanup may already
 * have removed fillers, so these are output words, not every word spoken.
 *
 * `Intl.Segmenter` splits Japanese and Chinese. Without it, tokens are
 * letters, numbers, and underscores separated by whitespace or punctuation.
 * That fallback is not a CJK segmenter.
 */

export interface WordSegment {
  segment: string;
  isWordLike?: boolean;
}

export interface WordSegmenter {
  segment(text: string): Iterable<WordSegment>;
}

/** Lets tests substitute a segmenter. Production uses `Intl.Segmenter` when it exists. */
export function defaultWordSegmenter(locale?: string | null): WordSegmenter | null {
  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter !== "function") return null;
  return new Segmenter(locale || undefined, { granularity: "word" });
}

/** Joins pieces the segmenter split on `_`, so `user_id` stays one token. */
export function tokensFromSegments(parts: readonly WordSegment[]): string[] {
  const tokens: string[] = [];
  let buffer = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part?.isWordLike) continue;
    buffer = part.segment;
    while (index + 2 < parts.length) {
      const bridge = parts[index + 1];
      const next = parts[index + 2];
      if (!bridge || bridge.segment !== "_" || bridge.isWordLike || !next?.isWordLike) break;
      buffer += `_${next.segment}`;
      index += 2;
    }
    tokens.push(buffer);
    buffer = "";
  }
  return tokens;
}

function fallbackTokens(text: string): string[] {
  return text.split(/[^\p{L}\p{N}_]+/u).filter((token) => token.length > 0);
}

/** Output-word tokens. Underscores stay inside a token. Punctuation does not. */
export function wordTokens(
  text: string,
  locale?: string | null,
  segmenter: WordSegmenter | null = defaultWordSegmenter(locale),
): string[] {
  if (!segmenter) return fallbackTokens(text);
  return tokensFromSegments([...segmenter.segment(text)]);
}

export function countOutputWords(text: string, locale?: string | null, segmenter?: WordSegmenter | null): number {
  return wordTokens(text, locale, segmenter).length;
}

/**
 * Appearance counts. "I worked on Persyn and then deployed Persyn" is 2 uses.
 * Matching is case-insensitive and whole-token, so `AI` does not match `email`.
 */
export function countTermUses(
  text: string,
  terms: readonly string[],
  locale?: string | null,
  segmenter?: WordSegmenter | null,
): Record<string, number> {
  const resolved = segmenter === undefined ? defaultWordSegmenter(locale) : segmenter;
  const haystack = wordTokens(text, locale, resolved).map((token) => token.toLocaleLowerCase(locale || undefined));
  const uses: Record<string, number> = {};
  for (const term of terms) {
    const needle = wordTokens(term, locale, resolved).map((token) => token.toLocaleLowerCase(locale || undefined));
    if (needle.length === 0) continue;
    let count = 0;
    for (let index = 0; index <= haystack.length - needle.length; index += 1) {
      const matches = needle.every((token, offset) => haystack[index + offset] === token);
      if (!matches) continue;
      count += 1;
      index += needle.length - 1;
    }
    if (count > 0) uses[term.toLocaleLowerCase(locale || undefined)] = (uses[term.toLocaleLowerCase(locale || undefined)] ?? 0) + count;
  }
  return uses;
}
