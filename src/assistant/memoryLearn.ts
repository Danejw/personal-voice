/**
 * What may be learned from one saved Assistant user turn.
 * Live microphone audio is not an input. Assistant replies are not personal truth.
 * The same phrases are enforced again in the learning migration.
 */

export const EXTRACTOR_VERSION = "memory-learn-1";
export const LEARN_BATCH = 8;
export const LEARN_TURN_CHARS = 2_000;

/** Whole-turn markers. Any one of these blocks learning from that message. */
export const LEARN_REJECT_MARKERS = [
  "draft",
  "hypothetically",
  "what if",
  "suppose",
  "for example",
  "if i ",
  "she said",
  "he said",
  "they said",
  "my friend",
  "email",
  "tell them",
  "write to",
  "say to",
  "screenshot",
] as const;

export type LearningCategory = "preference" | "fact" | "project";
export type LearningDisposition = "active" | "candidate";

export interface LearningProposal {
  key: string;
  value: string;
  kind: "preference" | "fact";
  category: LearningCategory;
  confidence: "high" | "low";
  evidence: string;
  disposition: LearningDisposition;
}

export interface LearningCommitInput {
  learning: boolean;
  conversationDeleted: boolean;
  alreadyJobbed: boolean;
  forgottenKey: boolean;
  active: { origin: "explicit" | "extracted"; value: string } | null;
  proposal: LearningProposal | null;
}

export type LearningCommit =
  | { action: "skip"; reason: "off" | "deleted" | "jobbed" | "empty" | "forgotten" | "same" }
  | { action: "candidate"; reason: "uncertain" | "explicit-wins" }
  | { action: "activate"; reason: "clear" }
  | { action: "replace-extracted"; reason: "clear" };

/** Proposals for one finalized user message. Assistant and tool text must not be passed in. */
export function classifyTurn(body: string): LearningProposal[] {
  const text = body.trim();
  if (!text || text.length > LEARN_TURN_CHARS) return [];
  if (rejected(text)) return [];
  const sentences = text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const found: LearningProposal[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences.length ? sentences : [text]) {
    const proposal = classifySentence(sentence);
    if (!proposal || seen.has(proposal.key)) continue;
    seen.add(proposal.key);
    found.push(proposal);
    if (found.length >= 3) break;
  }
  return found;
}

/**
 * A model span is kept only when this turn allows it and the span itself classifies.
 * The model's own key and value are not used.
 */
export function filterModelSpan(body: string, evidence: string): LearningProposal | null {
  const text = body.trim();
  const span = evidence.trim();
  if (!text || !span || !text.includes(span)) return null;
  if (rejected(text)) return null;
  return classifySentence(span);
}

/**
 * Commit decision for one proposal. Explicit memory is never replaced.
 * A forgotten key is not learned again. The same value is not stored twice.
 */
export function planLearningCommit(input: LearningCommitInput): LearningCommit {
  if (!input.learning) return { action: "skip", reason: "off" };
  if (input.conversationDeleted) return { action: "skip", reason: "deleted" };
  if (input.alreadyJobbed) return { action: "skip", reason: "jobbed" };
  if (!input.proposal) return { action: "skip", reason: "empty" };
  if (input.forgottenKey) return { action: "skip", reason: "forgotten" };
  if (input.active && input.active.value === input.proposal.value) return { action: "skip", reason: "same" };
  if (input.active?.origin === "explicit") return { action: "candidate", reason: "explicit-wins" };
  if (input.proposal.disposition === "candidate") return { action: "candidate", reason: "uncertain" };
  if (input.active?.origin === "extracted") return { action: "replace-extracted", reason: "clear" };
  return { action: "activate", reason: "clear" };
}

function rejected(text: string): boolean {
  const lower = text.toLowerCase();
  if (LEARN_REJECT_MARKERS.some((marker) => lower.includes(marker))) return true;
  if (/["“”]/.test(text)) return true;
  if (/\b(he|she|they) prefers\b/i.test(text)) return true;
  return false;
}

function classifySentence(sentence: string): LearningProposal | null {
  const text = sentence.trim();
  if (!text || rejected(text)) return null;
  const short = /^(?:please remember that )?i prefer short answers\.?$/i;
  if (short.test(text)) return proposal("answer_length", "Prefer short answers.", "preference", "preference", "high", "active", text);
  const detailed = /^(?:please remember that )?i prefer (?:detailed|long) answers\.?$/i;
  if (detailed.test(text)) return proposal("answer_length", "Prefer detailed answers.", "preference", "preference", "high", "active", text);
  const name = /^(?:please remember that )?my name is ([A-Za-z][A-Za-z' -]{0,40})\.?$/i.exec(text);
  const nameValue = name?.[1]?.trim();
  if (nameValue) return proposal("name", nameValue, "fact", "fact", "high", "active", text);
  const project = /^(?:please remember that )?i(?: am|'m) working on ([A-Za-z0-9][A-Za-z0-9' -]{0,60})\.?$/i.exec(text);
  const projectValue = project?.[1]?.trim().replace(/^(?:the|a|an)\s+/i, "");
  if (projectValue) return proposal(projectKey(projectValue), projectValue, "fact", "project", "high", "active", text);
  if (/^(?:please remember that )?(?:i think|i might|maybe|i'm not sure|i am not sure)\b/i.test(text)
    && /\bprefer short answers\b/i.test(text)
    && !/\b(he|she|they)\b/i.test(text)) {
    return proposal("answer_length", "Prefer short answers.", "preference", "preference", "low", "candidate", text);
  }
  const loose = /^i prefer ([a-z][a-z ]{1,40})\.?$/i.exec(text);
  const looseValue = loose?.[1]?.trim();
  if (looseValue && looseValue !== "short answers" && looseValue !== "detailed answers" && looseValue !== "long answers") {
    const key = `prefer_${looseValue.replace(/\s+/g, "_").replace(/[^a-z_]/g, "").slice(0, 40)}`;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) return null;
    return proposal(key, `Prefers ${looseValue}.`, "preference", "preference", "low", "candidate", text);
  }
  return null;
}

function proposal(
  key: string,
  value: string,
  kind: "preference" | "fact",
  category: LearningCategory,
  confidence: "high" | "low",
  disposition: LearningDisposition,
  evidence: string,
): LearningProposal {
  return { key, value, kind, category, confidence, disposition, evidence };
}

function projectKey(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
  return `project_${slug || "work"}`;
}
