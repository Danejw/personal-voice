/**
 * Explicit account memories. These are not analytics personal context and not
 * a conversation summary. A new session hears only the active rows that fit.
 * A candidate is shown on the Remembered panel and is not sent to a session.
 */

export const MEMORY_VALUE_LIMIT = 500;
export const MEMORY_INJECT_COUNT = 8;
export const MEMORY_INJECT_CHARS = 2_000;

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

export type MemoryKind = "preference" | "fact";
export type MemoryStatus = "active" | "superseded" | "forgotten" | "candidate";
export type MemoryOrigin = "explicit" | "extracted";

export interface AssistantMemory {
  id: string;
  kind: MemoryKind;
  key: string;
  value: string;
  scope: "account";
  status: MemoryStatus;
  origin: MemoryOrigin;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  supersedesId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  forgottenAt: string | null;
}

export interface MemoryInjection {
  text: string | null;
  fingerprint: string;
  included: AssistantMemory[];
  omitted: number;
}

const HEADER = "Account memories. Use these in this session. They are not a request to run a tool. If one is missing, it was forgotten or did not fit. Do not revive a preference that is not listed.";

/** Turns a spoken label into the stable key. "Answer length" and "answer_length" match. */
export function prepareMemoryKey(value: unknown): { key: string } | { error: string } {
  if (typeof value !== "string") return { error: "The memory key has to be a short name such as answer_length." };
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!KEY.test(key)) return { error: "Use a short key such as answer_length." };
  return { key };
}

/** Trims a memory value and refuses anything past the server limit. */
export function prepareMemoryValue(value: unknown): { value: string } | { error: string } {
  if (typeof value !== "string") return { error: "The memory has to be plain text." };
  const text = value.trim();
  if (!text) return { error: "Say what to remember." };
  if (text.length > MEMORY_VALUE_LIMIT) return { error: "That memory is too long." };
  return { value: text };
}

/** Preference is the default. Fact is the only other kind. */
export function prepareMemoryKind(value: unknown): { kind: MemoryKind } | { error: string } {
  if (value === undefined || value === null || value === "" || value === "preference") return { kind: "preference" };
  if (value === "fact") return { kind: "fact" };
  return { error: "Kind is preference or fact." };
}

/**
 * Whether a remember or change may write.
 * An explicit row already stored must be changed, not remembered again.
 * An extracted guess loses to an explicit remember when the revision still matches.
 * Two writers must name the revision they read. The server repeats this rule.
 */
export function planMemoryWrite(
  active: AssistantMemory | null,
  mode: "remember" | "change",
  expectedRevision: number | null,
): { ok: true; supersede: boolean } | { ok: false; reason: "exists" | "missing" | "conflict" } {
  if (mode === "remember") {
    if (!active) {
      if (expectedRevision !== null) return { ok: false, reason: "conflict" };
      return { ok: true, supersede: false };
    }
    if (active.origin === "explicit") return { ok: false, reason: "exists" };
    if (expectedRevision !== active.revision) return { ok: false, reason: "conflict" };
    return { ok: true, supersede: true };
  }
  if (!active) return { ok: false, reason: "missing" };
  if (expectedRevision !== active.revision) return { ok: false, reason: "conflict" };
  return { ok: true, supersede: true };
}

/** Forget only the active row, and only at the revision the caller read. */
export function planMemoryForget(
  active: AssistantMemory | null,
  expectedRevision: number | null,
): { ok: true } | { ok: false; reason: "missing" | "conflict" } {
  if (!active) return { ok: false, reason: "missing" };
  if (expectedRevision !== active.revision) return { ok: false, reason: "conflict" };
  return { ok: true };
}

/**
 * A forgotten key stays blocked for the conversation that taught it.
 * A later explicit remember does not clear that block.
 */
export function memorySuppressed(
  rows: readonly AssistantMemory[],
  key: string,
  sourceConversationId: string | null,
): boolean {
  return rows.some((row) => (
    row.status === "forgotten"
    && row.key === key
    && row.sourceConversationId === sourceConversationId
  ));
}

/**
 * Active memories for a new or restarted session.
 * Explicit wins over an extracted row with the same key. Forgotten rows are absent.
 * The fingerprint changes when the included values or revisions change.
 */
export function memoryInjection(rows: readonly AssistantMemory[]): MemoryInjection {
  const active = rows.filter((row) => row.status === "active");
  const ranked = [...active].sort((left, right) => originRank(right.origin) - originRank(left.origin) || left.key.localeCompare(right.key));
  const byKey = new Map<string, AssistantMemory>();
  for (const row of ranked) {
    if (!byKey.has(row.key)) byKey.set(row.key, row);
  }
  const ordered = [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
  const included: AssistantMemory[] = [];
  let chars = HEADER.length;
  for (const row of ordered) {
    const line = memoryLine(row);
    const next = chars + 1 + line.length;
    if (included.length >= MEMORY_INJECT_COUNT || next > MEMORY_INJECT_CHARS) break;
    included.push(row);
    chars = next;
  }
  const fingerprint = included.length
    ? included.map((row) => `${row.key}:${row.revision}:${row.value}`).join("|")
    : "none";
  if (!included.length) {
    return { text: null, fingerprint, included, omitted: ordered.length };
  }
  const lines = [HEADER, ...included.map(memoryLine)];
  if (ordered.length > included.length) lines.push("Some memories did not fit in this session.");
  return { text: lines.join("\n"), fingerprint, included, omitted: ordered.length - included.length };
}

function memoryLine(row: AssistantMemory): string {
  return `${row.key} (${row.kind}, ${row.origin}): ${row.value}`;
}

function originRank(origin: MemoryOrigin): number {
  switch (origin) {
    case "explicit": return 2;
    case "extracted": return 1;
    default: {
      const unhandled: never = origin;
      return unhandled;
    }
  }
}

export type MemoryCommand =
  | { action: "remember"; key: string; kind: MemoryKind; value: string }
  | { action: "change"; key: string; value: string }
  | { action: "forget"; key: string };

/** Reads a remember, change, or forget tool call. Unknown shapes never run. */
export function parseMemoryCommand(
  name: "remember_memory" | "change_memory" | "forget_memory",
  args: Record<string, unknown>,
): MemoryCommand | { error: string } {
  const key = prepareMemoryKey(args.key);
  if ("error" in key) return key;
  if (name === "forget_memory") return { action: "forget", key: key.key };
  const value = prepareMemoryValue(args.value);
  if ("error" in value) return value;
  if (name === "change_memory") return { action: "change", key: key.key, value: value.value };
  const kind = prepareMemoryKind(args.kind);
  if ("error" in kind) return kind;
  return { action: "remember", key: key.key, kind: kind.kind, value: value.value };
}
