import {
  compactSnippetTrigger,
  expandSnippetReferences,
  snippetReference,
  type Snippet,
} from "@/snippets/snippet";

/** One editable piece of a Personal Voice message. Snippet parts store the stable id. */
export type SnippetDraftPart =
  | { kind: "text"; text: string }
  | { kind: "snippet"; id: string; label: string };

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const MAX_INLINE_WORDS = 8;
const MIN_INLINE_COMPACT = 3;

interface WordSpan {
  start: number;
  end: number;
}

/**
 * Replaces spoken triggers inside a dictated sentence with snippet tokens.
 * Surrounding words stay in place. A comma used only to separate the trigger is dropped.
 * An ambiguous span is left as text.
 */
export function applyInlineSnippetReferences(text: string, snippets: readonly Snippet[]): SnippetDraftPart[] {
  const spans = wordSpans(text);
  const parts: SnippetDraftPart[] = [];
  let cursor = 0;
  let index = 0;
  while (index < spans.length) {
    const match = longestUniqueMatch(text, spans, index, snippets);
    if (!match) {
      index += 1;
      continue;
    }
    const start = spans[index]?.start ?? cursor;
    const end = spans[match.endIndex - 1]?.end ?? start;
    const prefix = softenSeparator(text.slice(cursor, start));
    if (prefix) parts.push({ kind: "text", text: prefix });
    parts.push({ kind: "snippet", id: match.snippet.id, label: match.snippet.slug });
    cursor = end;
    index = match.endIndex;
  }
  const tail = text.slice(cursor);
  if (tail) parts.push({ kind: "text", text: tail });
  return normalizeParts(parts);
}

export function draftPlainText(parts: readonly SnippetDraftPart[], snippets: readonly Snippet[]): string {
  return refreshSnippetLabels(parts, snippets).map((part) =>
    part.kind === "text" ? part.text : snippetReference({ slug: labelOf(part, snippets) })).join("");
}

export function draftHasContent(parts: readonly SnippetDraftPart[]): boolean {
  return parts.some((part) => part.kind === "snippet" || part.text.trim() !== "");
}

export function refreshSnippetLabels(parts: readonly SnippetDraftPart[], snippets: readonly Snippet[]): SnippetDraftPart[] {
  return parts.map((part) => {
    if (part.kind === "text") return part;
    const snippet = snippets.find((item) => item.id === part.id);
    return snippet ? { ...part, label: snippet.slug || part.label } : part;
  });
}

export type DraftExpansion =
  | { ok: true; text: string }
  | { ok: false; message: string };

/**
 * Expands snippet tokens by id, then any typed `@slug` still sitting in the text.
 * A deleted or disabled snippet blocks sending instead of dropping its instructions.
 */
export function expandSnippetDraft(parts: readonly SnippetDraftPart[], snippets: readonly Snippet[]): DraftExpansion {
  const unavailable: string[] = [];
  let text = "";
  for (const part of parts) {
    if (part.kind === "text") {
      text += expandSnippetReferences(part.text, snippets);
      continue;
    }
    const snippet = snippets.find((item) => item.id === part.id);
    if (!snippet) {
      unavailable.push(`@${part.label}`);
      continue;
    }
    if (!snippet.enabled) {
      unavailable.push(`@${snippet.slug} (turned off)`);
      continue;
    }
    text += snippet.content;
  }
  if (unavailable.length) {
    const noun = unavailable.length === 1 ? "it" : "them";
    return {
      ok: false,
      message: `${unavailable.join(", ")} ${unavailable.length === 1 ? "is" : "are"} no longer available. Remove ${noun} before sending.`,
    };
  }
  return { ok: true, text };
}

/** Inserts parts at a plain-text range. A range that touches a token removes that whole token. */
export function spliceDraft(
  parts: readonly SnippetDraftPart[],
  start: number,
  end: number,
  insertion: readonly SnippetDraftPart[],
  snippets: readonly Snippet[],
): { parts: SnippetDraftPart[]; caret: number } {
  const units = unitsOf(parts, snippets);
  const from = clamp(start, 0, plainLength(units));
  const to = clamp(Math.max(end, from), 0, plainLength(units));
  const widened = widenToTokens(units, from, to);
  const next = [
    ...units.slice(0, widened.start),
    ...unitsOf(insertion, snippets),
    ...units.slice(widened.end),
  ];
  return { parts: partsFromUnits(next), caret: plainLength(units.slice(0, widened.start)) + plainLength(unitsOf(insertion, snippets)) };
}

/**
 * Removes a whole snippet token when Backspace or Delete is aimed at it.
 * Returns null when the key should edit ordinary text instead.
 */
export function editDraft(
  parts: readonly SnippetDraftPart[],
  caret: number,
  key: "backspace" | "delete",
  snippets: readonly Snippet[],
): { parts: SnippetDraftPart[]; caret: number } | null {
  const units = unitsOf(parts, snippets);
  const point = clamp(caret, 0, plainLength(units));
  let cursor = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (!unit || unit.kind !== "snippet") {
      cursor += unit?.kind === "char" ? 1 : 0;
      continue;
    }
    const size = unit.label.length + 1;
    const start = cursor;
    const end = cursor + size;
    const hit = key === "backspace" ? point === end : point === start;
    if (hit) {
      const next = units.filter((_, unitIndex) => unitIndex !== index);
      return { parts: partsFromUnits(next), caret: start };
    }
    cursor = end;
  }
  return null;
}

export function serializeSnippetDraft(parts: readonly SnippetDraftPart[]): string {
  return JSON.stringify({ v: 1, parts: normalizeParts([...parts]) });
}

export function parseSnippetDraft(raw: string): SnippetDraftPart[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("parts" in parsed) || !Array.isArray(parsed.parts)) {
      return [{ kind: "text", text: raw }];
    }
    const parts: SnippetDraftPart[] = [];
    for (const part of parsed.parts) {
      if (!part || typeof part !== "object") continue;
      if ("text" in part && typeof part.text === "string" && !("id" in part)) {
        parts.push({ kind: "text", text: part.text });
      } else if ("id" in part && typeof part.id === "string" && part.id) {
        const label = "label" in part && typeof part.label === "string" && part.label ? part.label : "snippet";
        parts.push({ kind: "snippet", id: part.id, label });
      }
    }
    return normalizeParts(parts);
  } catch {
    return [{ kind: "text", text: raw }];
  }
}

function longestUniqueMatch(
  text: string,
  spans: readonly WordSpan[],
  index: number,
  snippets: readonly Snippet[],
): { snippet: Snippet; endIndex: number } | null {
  const limit = Math.min(MAX_INLINE_WORDS, spans.length - index);
  for (let length = limit; length >= 1; length -= 1) {
    if (!contiguous(text, spans, index, length)) continue;
    const phrase = spans.slice(index, index + length).map((span) => text.slice(span.start, span.end)).join(" ");
    const key = compactSnippetTrigger(phrase);
    if (key.length < MIN_INLINE_COMPACT) continue;
    const hits = snippets.filter((snippet) => snippet.enabled && snippet.normalizedTriggers.includes(key));
    if (hits.length > 1) return null;
    const snippet = hits[0];
    if (snippet) return { snippet, endIndex: index + length };
  }
  return null;
}

function wordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  for (const match of text.matchAll(WORD)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function contiguous(text: string, spans: readonly WordSpan[], index: number, length: number): boolean {
  for (let cursor = index; cursor < index + length - 1; cursor += 1) {
    const current = spans[cursor];
    const next = spans[cursor + 1];
    if (!current || !next) return false;
    if (!/^[\s-]+$/.test(text.slice(current.end, next.start))) return false;
  }
  return true;
}

function softenSeparator(prefix: string): string {
  return prefix.replace(/,\s*$/, " ");
}

type Unit =
  | { kind: "char"; ch: string }
  | { kind: "snippet"; id: string; label: string };

function unitsOf(parts: readonly SnippetDraftPart[], snippets: readonly Snippet[]): Unit[] {
  const units: Unit[] = [];
  for (const part of refreshSnippetLabels(parts, snippets)) {
    if (part.kind === "text") {
      for (const ch of part.text) units.push({ kind: "char", ch });
    } else {
      units.push({ kind: "snippet", id: part.id, label: labelOf(part, snippets) });
    }
  }
  return units;
}

function partsFromUnits(units: readonly Unit[]): SnippetDraftPart[] {
  const parts: SnippetDraftPart[] = [];
  for (const unit of units) {
    if (unit.kind === "char") {
      const last = parts[parts.length - 1];
      if (last?.kind === "text") last.text += unit.ch;
      else parts.push({ kind: "text", text: unit.ch });
    } else {
      parts.push({ kind: "snippet", id: unit.id, label: unit.label });
    }
  }
  return normalizeParts(parts);
}

function plainLength(units: readonly Unit[]): number {
  return units.reduce((total, unit) => total + (unit.kind === "char" ? 1 : unit.label.length + 1), 0);
}

function widenToTokens(units: readonly Unit[], start: number, end: number): { start: number; end: number } {
  let cursor = 0;
  let unitStart = 0;
  let unitEnd = units.length;
  let seenStart = false;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (!unit) continue;
    const size = unit.kind === "char" ? 1 : unit.label.length + 1;
    const next = cursor + size;
    const overlaps = next > start && cursor < end;
    if (overlaps && !seenStart) {
      unitStart = index;
      seenStart = true;
    }
    if (overlaps) unitEnd = index + 1;
    cursor = next;
  }
  if (!seenStart) {
    let count = 0;
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      if (!unit) continue;
      const size = unit.kind === "char" ? 1 : unit.label.length + 1;
      if (count >= start) return { start: index, end: index };
      count += size;
    }
    return { start: units.length, end: units.length };
  }
  return { start: unitStart, end: unitEnd };
}

function labelOf(part: Extract<SnippetDraftPart, { kind: "snippet" }>, snippets: readonly Snippet[]): string {
  return snippets.find((snippet) => snippet.id === part.id)?.slug || part.label;
}

export function normalizeParts(parts: readonly SnippetDraftPart[]): SnippetDraftPart[] {
  const merged: SnippetDraftPart[] = [];
  for (const part of parts) {
    if (part.kind === "text") {
      if (!part.text) continue;
      const last = merged[merged.length - 1];
      if (last?.kind === "text") last.text += part.text;
      else merged.push({ kind: "text", text: part.text });
      continue;
    }
    if (!part.id) continue;
    merged.push({ kind: "snippet", id: part.id, label: part.label || "snippet" });
  }
  return merged;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
