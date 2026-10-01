import type { Json } from "@/types/database";
import type { ContextAttachment, StoredSummary } from "@/assistant/contextRestore";

/** Visible title, matching the continuation handoff cap. */
export const ASSISTANT_TITLE_LIMIT = 120;
/** Same text cap as voice notes and dictations. */
export const ASSISTANT_MESSAGE_LIMIT = 100_000;
/** Same cap as an Assistant tool result shown to the model. */
export const ASSISTANT_TOOL_OUTCOME_LIMIT = 8_000;
/** Same cap as grounding citations kept on a reply. */
export const ASSISTANT_CITATION_LIMIT = 8;
export const ASSISTANT_CITATION_URL_LIMIT = 2_000;
export const ASSISTANT_CITATION_TITLE_LIMIT = 300;
/** Default page size for conversation and message reads. */
export const ASSISTANT_PAGE_SIZE = 50;
/** Server rejects a larger page. */
export const ASSISTANT_PAGE_LIMIT = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HTTPS_URL = /^https:\/\/\S+$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export type AssistantStorageCode =
  | "not-signed-in"
  | "forbidden"
  | "not-found"
  | "deleted"
  | "conflict"
  | "rejected"
  | "lost"
  | "unavailable";

export type AssistantMessageRole = "user" | "assistant" | "tool";
export type AssistantMessageStatus = "final" | "interrupted";

export interface AssistantCitation {
  url: string;
  title: string;
}

/** One saved thread. Tombstones are not returned. Lease fields stay empty until a later phase. */
export interface AssistantConversation {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  leaseDeviceId: string | null;
  leaseExpiresAt: string | null;
  fence: number;
  summary: StoredSummary | null;
  contextItems: ContextAttachment[];
}

export interface AssistantStoredMessage {
  id: string;
  conversationId: string;
  role: AssistantMessageRole;
  status: AssistantMessageStatus;
  body: string;
  seq: number;
  sourceDeviceId: string;
  createdAt: string;
  citations: AssistantCitation[];
  toolName: string | null;
  toolOutcome: string | null;
}

export interface AssistantMessageInput {
  id: string;
  conversationId: string;
  role: AssistantMessageRole;
  status: AssistantMessageStatus;
  body: string;
  sourceDeviceId: string;
  citations?: readonly AssistantCitation[];
  toolName?: string | null;
  toolOutcome?: string | null;
  /** Required for an assistant or tool row. Omitted on a user line. */
  fence?: number | null;
}

export interface PreparedAssistantMessage {
  p_message_id: string;
  p_conversation_id: string;
  p_role: AssistantMessageRole;
  p_status: AssistantMessageStatus;
  p_body: string;
  p_source_device_id: string;
  p_citations: AssistantCitation[];
  p_tool_name: string | null;
  p_tool_outcome: string | null;
  p_fence: number | null;
}

/** Typed failure from conversation storage. The message is safe to show. */
export class AssistantStorageError extends Error {
  readonly code: AssistantStorageCode;

  constructor(code: AssistantStorageCode, message: string) {
    super(message);
    this.name = "AssistantStorageError";
    this.code = code;
  }
}

const FAILURES = {
  ASSISTANT_NOT_SIGNED_IN: ["not-signed-in", "Sign in again to save conversations."],
  ASSISTANT_ACCOUNT_MISMATCH: ["forbidden", "That account does not match the signed-in user."],
  ASSISTANT_CONVERSATION_NOT_FOUND: ["not-found", "That conversation was not found."],
  ASSISTANT_CONVERSATION_DELETED: ["deleted", "That conversation was deleted."],
  ASSISTANT_CONVERSATION_REJECTED: ["rejected", "That conversation was rejected."],
  ASSISTANT_MESSAGE_CONFLICT: ["conflict", "That message id was already used with different content."],
  ASSISTANT_MESSAGE_REJECTED: ["rejected", "That message was rejected."],
  ASSISTANT_PAGE_REJECTED: ["rejected", "That page was rejected."],
  ASSISTANT_LEASE_LOST: ["lost", "Another device is continuing this conversation."],
  ASSISTANT_SUMMARY_STALE: ["rejected", "That summary is out of date."],
  ASSISTANT_SUMMARY_CONFLICT: ["conflict", "Another summary was saved."],
  ASSISTANT_CONTEXT_REJECTED: ["rejected", "That attachment was rejected."],
} as const satisfies Record<string, readonly [AssistantStorageCode, string]>;

/** Stable server tokens. The migration must raise these spellings. */
export const ASSISTANT_STORAGE_TOKENS = Object.keys(FAILURES) as (keyof typeof FAILURES)[];

function rejected(message: string): AssistantStorageError {
  return new AssistantStorageError("rejected", message);
}

function unreadable(label: string): AssistantStorageError {
  return rejected(`The conversation service returned an unreadable ${label}.`);
}

/** Maps a PostgREST or Postgres failure onto a storage code. Server text is not shown raw. */
export function assistantStorageError(error: { code: string; message: string }): AssistantStorageError {
  for (const token of ASSISTANT_STORAGE_TOKENS) {
    if (error.message.includes(token)) {
      const failure = FAILURES[token];
      return new AssistantStorageError(failure[0], failure[1]);
    }
  }
  switch (error.code) {
    case "42501":
    case "PGRST301":
      return new AssistantStorageError("not-signed-in", "Sign in again to save conversations.");
    case "23505":
      return new AssistantStorageError("conflict", "That message id was already used with different content.");
    case "23514":
    case "22P02":
      return rejected("The server rejected that value.");
    case "":
      return new AssistantStorageError("unavailable", "Couldn't reach conversation storage. Check your connection.");
    default:
      return new AssistantStorageError("unavailable", `Conversation storage failed (${error.code}).`);
  }
}

/** Accepts a client-generated UUID. */
export function assistantId(value: string, label: string): string {
  if (!UUID.test(value)) throw rejected(`That ${label} id is not valid.`);
  return value;
}

/** Trims a conversation title and enforces the shared cap. */
export function prepareAssistantTitle(value: string): string {
  const title = value.trim();
  if (!title || title.length > ASSISTANT_TITLE_LIMIT) {
    throw rejected(`A conversation title must be 1–${ASSISTANT_TITLE_LIMIT} characters.`);
  }
  return title;
}

/** Page size sent to the list RPCs. Omitted means the default. */
export function preparePageLimit(limit?: number): number {
  const size = limit ?? ASSISTANT_PAGE_SIZE;
  if (!Number.isInteger(size) || size < 1 || size > ASSISTANT_PAGE_LIMIT) {
    throw rejected(`A page must contain 1–${ASSISTANT_PAGE_LIMIT} rows.`);
  }
  return size;
}

function citation(value: AssistantCitation): AssistantCitation {
  const url = value.url.trim();
  const title = value.title.trim();
  if (!HTTPS_URL.test(url) || url.length > ASSISTANT_CITATION_URL_LIMIT) {
    throw rejected("A citation must be an https URL.");
  }
  if (!title || title.length > ASSISTANT_CITATION_TITLE_LIMIT) {
    throw rejected("A citation needs a title.");
  }
  return { url, title };
}

/**
 * Builds the append arguments. Citations keep url and title only.
 * Tool name and outcome are stored for a tool result, never the call arguments.
 */
export function prepareAssistantMessage(input: AssistantMessageInput): PreparedAssistantMessage {
  const body = input.body.trim();
  if (!body || body.length > ASSISTANT_MESSAGE_LIMIT) {
    throw rejected("That message was empty or too long.");
  }
  const citations = (input.citations ?? []).map(citation);
  if (citations.length > ASSISTANT_CITATION_LIMIT) {
    throw rejected(`A message can include at most ${ASSISTANT_CITATION_LIMIT} citations.`);
  }
  const toolName = input.toolName ?? null;
  const toolOutcome = input.toolOutcome?.trim() ?? null;
  if (input.role === "tool") {
    if (input.status !== "final" || !toolName || !TOOL_NAME.test(toolName)) {
      throw rejected("A tool result needs a final status and a plain tool name.");
    }
    if (!toolOutcome || toolOutcome.length > ASSISTANT_TOOL_OUTCOME_LIMIT) {
      throw rejected("A tool result needs an outcome.");
    }
  } else if (toolName || input.toolOutcome) {
    throw rejected("Only a tool result can include a tool outcome.");
  }
  const fence = input.fence ?? null;
  if (fence !== null && (!Number.isSafeInteger(fence) || fence < 0)) throw rejected("That lease was rejected.");
  return {
    p_message_id: assistantId(input.id, "message"),
    p_conversation_id: assistantId(input.conversationId, "conversation"),
    p_role: input.role,
    p_status: input.status,
    p_body: body,
    p_source_device_id: assistantId(input.sourceDeviceId, "device"),
    p_citations: citations,
    p_tool_name: input.role === "tool" ? toolName : null,
    p_tool_outcome: input.role === "tool" ? toolOutcome : null,
    p_fence: fence,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value) as unknown);
    } catch {
      throw unreadable("row");
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw unreadable("row");
  return value as Record<string, unknown>;
}

function readUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw unreadable(label);
  return value;
}

function readCount(value: unknown, label: string, minimum: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw unreadable(label);
  return parsed;
}

function readTimestamp(value: unknown, label: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw unreadable(label);
    return value.toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  throw unreadable(label);
}

function readNullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  return readTimestamp(value, label);
}

function readRole(value: unknown): AssistantMessageRole {
  switch (value) {
    case "user":
    case "assistant":
    case "tool":
      return value;
    default:
      throw unreadable("message role");
  }
}

function readStatus(value: unknown): AssistantMessageStatus {
  switch (value) {
    case "final":
    case "interrupted":
      return value;
    default:
      throw unreadable("message status");
  }
}

function readCitations(value: unknown): AssistantCitation[] {
  if (!Array.isArray(value) || value.length > ASSISTANT_CITATION_LIMIT) throw unreadable("citations");
  return value.map((item) => {
    if (typeof item !== "object" || item === null) throw unreadable("citations");
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some((key) => key !== "url" && key !== "title")) throw unreadable("citations");
    const url = record.url;
    const title = record.title;
    if (typeof url !== "string" || typeof title !== "string") throw unreadable("citations");
    return { url, title };
  });
}

/** Reads a claim. `acquired` is false when another device still holds an unexpired lease. */
export function readClaimResult(value: unknown): { conversation: AssistantConversation; acquired: boolean } {
  const record = asRecord(value);
  if (typeof record.acquired !== "boolean") throw unreadable("lease");
  return { conversation: conversationFromPayload(value), acquired: record.acquired };
}
export function conversationFromPayload(value: unknown): AssistantConversation {
  const record = asRecord(value);
  if (record.deleted_at != null) {
    throw new AssistantStorageError("deleted", "That conversation was deleted.");
  }
  const title = record.title;
  if (typeof title !== "string" || !title.trim()) throw unreadable("title");
  const leaseDeviceId = record.lease_device_id;
  if (leaseDeviceId !== null && typeof leaseDeviceId !== "string") throw unreadable("lease");
  return {
    id: readUuid(record.id, "conversation id"),
    title,
    revision: readCount(record.revision, "revision", 0),
    createdAt: readTimestamp(record.created_at, "timestamp"),
    updatedAt: readTimestamp(record.updated_at, "timestamp"),
    leaseDeviceId: leaseDeviceId === null ? null : readUuid(leaseDeviceId, "lease"),
    leaseExpiresAt: readNullableTimestamp(record.lease_expires_at, "lease"),
    fence: readCount(record.fence, "fence", 0),
    summary: readSummary(record),
    contextItems: readContextItems(record.context_items),
  };
}

/** Reads one stored message. Unknown roles and extra citation fields fail. */
export function messageFromPayload(value: unknown): AssistantStoredMessage {
  const record = asRecord(value);
  const body = record.body;
  const toolName = record.tool_name;
  const toolOutcome = record.tool_outcome;
  if (typeof body !== "string" || !body) throw unreadable("message");
  if (toolName !== null && typeof toolName !== "string") throw unreadable("tool result");
  if (toolOutcome !== null && typeof toolOutcome !== "string") throw unreadable("tool result");
  return {
    id: readUuid(record.id, "message id"),
    conversationId: readUuid(record.conversation_id, "conversation id"),
    role: readRole(record.role),
    status: readStatus(record.status),
    body,
    seq: readCount(record.seq, "sequence", 1),
    sourceDeviceId: readUuid(record.source_device_id, "device id"),
    createdAt: readTimestamp(record.created_at, "timestamp"),
    citations: readCitations(record.citations),
    toolName,
    toolOutcome,
  };
}

function readSummary(record: Record<string, unknown>): StoredSummary | null {
  const body = record.summary_body;
  const through = record.summary_through_seq;
  const fingerprint = record.summary_fingerprint;
  if (body == null && through == null && fingerprint == null) return null;
  if (typeof body !== "string" || typeof fingerprint !== "string" || !/^[0-9a-f]{8}$/.test(fingerprint)) {
    throw unreadable("summary");
  }
  return { body, throughSeq: readCount(through, "summary", 1), fingerprint };
}

function readContextItems(value: unknown): ContextAttachment[] {
  if (value == null) return [];
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw unreadable("attachment");
    }
  }
  if (!Array.isArray(parsed)) throw unreadable("attachment");
  return parsed.map((item) => {
    const record = asRecord(item);
    const kind = record.kind;
    const body = record.body;
    const source = record.source;
    if ((kind !== "note" && kind !== "selection" && kind !== "handoff" && kind !== "screenshot")
      || typeof record.id !== "string"
      || !record.id
      || typeof body !== "string"
      || typeof source !== "string") {
      throw unreadable("attachment");
    }
    return {
      kind,
      id: record.id,
      body,
      capturedAt: readTimestamp(record.captured_at, "attachment"),
      source,
    };
  });
}

export function readSummaryResult(value: unknown): { conversation: AssistantConversation; saved: boolean } {
  const record = asRecord(value);
  if (typeof record.saved !== "boolean") throw unreadable("summary");
  return { conversation: conversationFromPayload(record), saved: record.saved };
}

/** Create RPC payload, including the idempotent `created` flag. */
export function readCreateResult(value: unknown): { conversation: AssistantConversation; created: boolean } {
  const record = asRecord(value);
  if (typeof record.created !== "boolean") throw unreadable("create result");
  return { conversation: conversationFromPayload(record), created: record.created };
}

/** Append RPC payload. `revision` is the conversation revision, not a message column. */
export function readAppendResult(value: unknown): {
  message: AssistantStoredMessage;
  appended: boolean;
  revision: number;
} {
  const record = asRecord(value);
  if (typeof record.appended !== "boolean") throw unreadable("append result");
  return {
    message: messageFromPayload(record),
    appended: record.appended,
    revision: readCount(record.revision, "revision", 0),
  };
}

/** Citations column passed through PostgREST. */
export function citationsJson(citations: readonly AssistantCitation[]): Json {
  return citations.map((item) => ({ url: item.url, title: item.title }));
}
