import type { AssistantMemory } from "@/assistant/memory";
import type { DictionaryTerm } from "@/sync/personalData";
import type { Snippet } from "@/snippets/snippet";
import { normalizeSnippetTrigger } from "@/snippets/snippet";
import type { TransformProfile } from "@/transforms/transformProfile";
import type { InsightCandidateKind } from "@/insights/insights";

export interface ProposedCandidate {
  kind: InsightCandidateKind;
  title: string;
  payload: Record<string, unknown>;
  evidenceCount: number;
  confidence: "high" | "medium";
  reason: string;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function tokens(value: string): Set<string> {
  return new Set(normalized(value).split(/[^\p{L}\p{N}_]+/u).filter((token) => token.length >= 3));
}

function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function stringField(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === "string" ? String(payload[key]).trim() : "";
}

export function candidateFingerprint(candidate: ProposedCandidate): string {
  switch (candidate.kind) {
    case "dictionary":
      return `dictionary:${normalized(stringField(candidate.payload, "term"))}`;
    case "snippet":
      return `snippet:${normalizeSnippetTrigger(stringField(candidate.payload, "trigger"))}`;
    case "transform":
      return `transform:${normalized(stringField(candidate.payload, "name"))}`;
    case "memory":
      return `memory:${normalized(stringField(candidate.payload, "key")).replace(/[\s-]+/g, "_")}`;
    default: {
      const unhandled: never = candidate.kind;
      return unhandled;
    }
  }
}

export interface ExistingKnowledge {
  dictionary: readonly DictionaryTerm[];
  snippets: readonly Snippet[];
  transforms: readonly TransformProfile[];
  memories: readonly AssistantMemory[];
  seenFingerprints: ReadonlySet<string>;
}

export function isExistingCandidate(candidate: ProposedCandidate, existing: ExistingKnowledge): boolean {
  const fingerprint = candidateFingerprint(candidate);
  if (existing.seenFingerprints.has(fingerprint)) return true;

  switch (candidate.kind) {
    case "dictionary": {
      const term = normalized(stringField(candidate.payload, "term"));
      return !term || existing.dictionary.some((item) => normalized(item.term) === term);
    }
    case "snippet": {
      const trigger = normalizeSnippetTrigger(stringField(candidate.payload, "trigger"));
      const content = stringField(candidate.payload, "content");
      if (!trigger || !content) return true;
      return existing.snippets.some((item) =>
        item.normalizedTrigger === trigger
        || similarity(item.content, content) >= 0.72
      );
    }
    case "transform": {
      const name = normalized(stringField(candidate.payload, "name"));
      const instruction = stringField(candidate.payload, "instruction");
      if (!name || !instruction) return true;
      return existing.transforms.some((item) =>
        normalized(item.name) === name
        || similarity(item.instruction, instruction) >= 0.68
      );
    }
    case "memory": {
      const key = normalized(stringField(candidate.payload, "key")).replace(/[\s-]+/g, "_");
      return !key || existing.memories.some((item) => normalized(item.key) === key);
    }
    default: {
      const unhandled: never = candidate.kind;
      return unhandled;
    }
  }
}

export function uniqueNewCandidates(candidates: readonly ProposedCandidate[], existing: ExistingKnowledge): ProposedCandidate[] {
  const fingerprints = new Set(existing.seenFingerprints);
  const kept: ProposedCandidate[] = [];
  for (const candidate of candidates) {
    const fingerprint = candidateFingerprint(candidate);
    if (!fingerprint || fingerprints.has(fingerprint) || isExistingCandidate(candidate, { ...existing, seenFingerprints: fingerprints })) continue;
    fingerprints.add(fingerprint);
    kept.push(candidate);
  }
  return kept;
}
