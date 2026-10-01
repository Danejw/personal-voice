import {
  memorySuppressed,
  prepareMemoryKey,
  prepareMemoryKind,
  prepareMemoryValue,
  type AssistantMemory,
  type MemoryKind,
  type MemoryOrigin,
  type MemoryStatus,
} from "@/assistant/memory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AssistantMemoryCode =
  | "not-signed-in"
  | "forbidden"
  | "not-found"
  | "exists"
  | "conflict"
  | "rejected"
  | "unavailable";

const FAILURES = {
  ASSISTANT_NOT_SIGNED_IN: ["not-signed-in", "Sign in again to use memories."],
  ASSISTANT_ACCOUNT_MISMATCH: ["forbidden", "That account does not match the signed-in user."],
  ASSISTANT_MEMORY_NOT_FOUND: ["not-found", "That preference is not remembered."],
  ASSISTANT_MEMORY_EXISTS: ["exists", "That preference is already remembered. Change it instead."],
  ASSISTANT_MEMORY_CONFLICT: ["conflict", "Another device changed that preference."],
  ASSISTANT_MEMORY_REJECTED: ["rejected", "That memory was rejected."],
} as const satisfies Record<string, readonly [AssistantMemoryCode, string]>;

/** Stable server tokens. The migration must raise these spellings. */
export const ASSISTANT_MEMORY_TOKENS = Object.keys(FAILURES) as (keyof typeof FAILURES)[];

export class AssistantMemoryError extends Error {
  constructor(readonly code: AssistantMemoryCode, message: string) {
    super(message);
    this.name = "AssistantMemoryError";
  }
}

export interface RememberMemoryInput {
  id: string;
  kind: MemoryKind;
  key: string;
  value: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  replace: boolean;
  expectedRevision: number | null;
}

export interface ForgetMemoryInput {
  key: string;
  expectedRevision: number;
}

/** One finalized user line the server still allows this extractor to read. */
export interface LearningBatchMessage {
  id: string;
  conversationId: string;
  body: string;
}

/** Evidence spans for one message. The server recomputes the proposal from the stored body. */
export interface LearningCommitMessage {
  id: string;
  evidences: string[];
}

/** Maps a PostgREST or Postgres failure onto a memory code. Server text is not shown raw. */
export function assistantMemoryError(error: { code: string; message: string }): AssistantMemoryError {
  for (const token of ASSISTANT_MEMORY_TOKENS) {
    if (error.message.includes(token)) {
      const failure = FAILURES[token];
      return new AssistantMemoryError(failure[0], failure[1]);
    }
  }
  switch (error.code) {
    case "42501":
    case "PGRST301":
      return new AssistantMemoryError("not-signed-in", "Sign in again to use memories.");
    case "23505":
      return new AssistantMemoryError("exists", "That preference is already remembered. Change it instead.");
    case "23514":
    case "22P02":
      return new AssistantMemoryError("rejected", "That memory was rejected.");
    case "":
      return new AssistantMemoryError("unavailable", "Couldn't reach memory storage. Check your connection.");
    default:
      return new AssistantMemoryError("unavailable", `Memory storage failed (${error.code}).`);
  }
}

/** Reads the learning batch. Message text is only what the server stored for this account. */
export function learningBatchFromPayload(value: unknown): LearningBatchMessage[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) throw new AssistantMemoryError("rejected", "The memory service returned an unreadable list.");
  return parsed.map(learningMessageFromPayload);
}

/** Checks a commit batch before it is sent. At most eight messages. */
export function prepareLearningCommit(batch: readonly LearningCommitMessage[]): LearningCommitMessage[] {
  if (batch.length > 8) throw new AssistantMemoryError("rejected", "That memory was rejected.");
  return batch.map((item) => {
    if (!UUID.test(item.id)) throw new AssistantMemoryError("rejected", "That memory was rejected.");
    const evidences = item.evidences.filter((evidence) => evidence.trim().length > 0 && evidence.length <= 500);
    return { id: item.id, evidences };
  });
}

/** Reads the list returned by the memory RPCs. */
export function memoriesFromPayload(value: unknown): AssistantMemory[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) throw new AssistantMemoryError("rejected", "The memory service returned an unreadable list.");
  return parsed.map(memoryFromPayload);
}

/** Client checks before a remember or change call. */
export function prepareRemember(input: {
  id: string;
  kind: unknown;
  key: unknown;
  value: unknown;
  sourceConversationId: string | null;
  sourceMessageId?: string | null;
  replace: boolean;
  expectedRevision: number | null;
}): RememberMemoryInput {
  if (!UUID.test(input.id)) throw new AssistantMemoryError("rejected", "That memory id is not valid.");
  const kind = prepareMemoryKind(input.kind);
  if ("error" in kind) throw new AssistantMemoryError("rejected", kind.error);
  const key = prepareMemoryKey(input.key);
  if ("error" in key) throw new AssistantMemoryError("rejected", key.error);
  const value = prepareMemoryValue(input.value);
  if ("error" in value) throw new AssistantMemoryError("rejected", value.error);
  const source = input.sourceConversationId;
  if (source !== null && !UUID.test(source)) throw new AssistantMemoryError("rejected", "That source conversation is not valid.");
  const message = input.sourceMessageId ?? null;
  if (message !== null && !UUID.test(message)) throw new AssistantMemoryError("rejected", "That source message is not valid.");
  return {
    id: input.id,
    kind: kind.kind,
    key: key.key,
    value: value.value,
    sourceConversationId: source,
    sourceMessageId: message,
    replace: input.replace,
    expectedRevision: input.expectedRevision,
  };
}

/** True when the loaded rows still block passive learning from that conversation. */
export function sourceStillSuppressed(
  rows: readonly AssistantMemory[],
  key: string,
  sourceConversationId: string | null,
): boolean {
  const parsed = prepareMemoryKey(key);
  if ("error" in parsed) return false;
  return memorySuppressed(rows, parsed.key, sourceConversationId);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AssistantMemoryError("rejected", "The memory service returned an unreadable list.");
  }
}

function learningMessageFromPayload(value: unknown): LearningBatchMessage {
  if (typeof value !== "object" || value === null) {
    throw new AssistantMemoryError("rejected", "The memory service returned an unreadable list.");
  }
  const record = value as Record<string, unknown>;
  const body = record.body;
  return {
    id: readUuid(record.id),
    conversationId: readUuid(record.conversation_id),
    body: typeof body === "string" ? body : "",
  };
}

function memoryFromPayload(value: unknown): AssistantMemory {
  if (typeof value !== "object" || value === null) {
    throw new AssistantMemoryError("rejected", "The memory service returned an unreadable memory.");
  }
  const record = value as Record<string, unknown>;
  const key = prepareMemoryKey(record.memory_key);
  const kind = prepareMemoryKind(record.kind);
  const body = prepareMemoryValue(record.value);
  if ("error" in key || "error" in kind || "error" in body) {
    throw new AssistantMemoryError("rejected", "The memory service returned an unreadable memory.");
  }
  return {
    id: readUuid(record.id),
    kind: kind.kind,
    key: key.key,
    value: body.value,
    scope: "account",
    status: readStatus(record.status),
    origin: readOrigin(record.origin),
    sourceConversationId: readOptionalUuid(record.source_conversation_id),
    sourceMessageId: readOptionalUuid(record.source_message_id),
    supersedesId: readOptionalUuid(record.supersedes_id),
    revision: readRevision(record.revision),
    createdAt: readTime(record.created_at),
    updatedAt: readTime(record.updated_at),
    forgottenAt: record.forgotten_at == null ? null : readTime(record.forgotten_at),
  };
}

function readUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new AssistantMemoryError("rejected", "The memory service returned an unreadable memory.");
  }
  return value;
}

function readOptionalUuid(value: unknown): string | null {
  if (value == null) return null;
  return readUuid(value);
}

function readRevision(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AssistantMemoryError("rejected", "The memory service returned an unreadable memory.");
  }
  return parsed;
}

function readTime(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AssistantMemoryError("rejected", "The memory service returned an unreadable memory.");
  }
  return value;
}

function readStatus(value: unknown): MemoryStatus {
  if (value === "active" || value === "superseded" || value === "forgotten" || value === "candidate") return value;
  throw new AssistantMemoryError("rejected", "The memory service returned an unreadable memory.");
}

function readOrigin(value: unknown): MemoryOrigin {
  if (value === "explicit" || value === "extracted") return value;
  throw new AssistantMemoryError("rejected", "The memory service returned an unreadable memory.");
}
