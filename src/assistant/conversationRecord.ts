import type { AssistantTurn } from "@/assistant/state";
import {
  ASSISTANT_CITATION_LIMIT,
  ASSISTANT_CITATION_TITLE_LIMIT,
  ASSISTANT_CITATION_URL_LIMIT,
  ASSISTANT_TITLE_LIMIT,
  assistantId,
  type AssistantCitation,
  type AssistantStoredMessage,
} from "@/services/assistantConversations";
import type { KeyValueStorage } from "@/sync/personalCache";

/** Title used until the first user line supplies one. */
export const ASSISTANT_DEFAULT_TITLE = "New conversation";

const PENDING_VERSION = 1;

export interface PendingAssistantMessage {
  id: string;
  role: "user" | "assistant";
  status: "final" | "interrupted";
  body: string;
  sourceDeviceId: string;
  citations: AssistantCitation[];
  /** Set when the line needs the producer's fence. User lines leave this empty. */
  fence: number | null;
  sessionId?: string | null;
}

/** One append that must survive a crash between the server commit and the local ack. */
export interface PendingAssistantWrite {
  userId: string;
  conversationId: string;
  title: string;
  message: PendingAssistantMessage;
}

function pendingKey(userId: string): string {
  return `assistant.pending.v1.${userId}`;
}

function openKey(userId: string): string {
  return `assistant.open.v1.${userId}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** First user line, clipped to the title cap. Blank text stays the default title. */
export function conversationTitleFrom(text: string): string {
  const title = text.trim().replace(/\s+/g, " ");
  if (!title) return ASSISTANT_DEFAULT_TITLE;
  return title.length <= ASSISTANT_TITLE_LIMIT ? title : title.slice(0, ASSISTANT_TITLE_LIMIT).trimEnd();
}

/** Keeps https citations the message RPC will accept. A bad citation is dropped, not the message. */
export function citationsFromSources(sources: readonly { url: string; title: string }[]): AssistantCitation[] {
  const citations: AssistantCitation[] = [];
  for (const source of sources) {
    const url = source.url.trim();
    const title = source.title.trim();
    if (!url.startsWith("https://") || url.length > ASSISTANT_CITATION_URL_LIMIT) continue;
    if (!title || title.length > ASSISTANT_CITATION_TITLE_LIMIT) continue;
    citations.push({ url, title });
    if (citations.length >= ASSISTANT_CITATION_LIMIT) break;
  }
  return citations;
}

/** Builds the durable write for a committed turn. Empty text is not a message. */
export function pendingWriteFromTurn(input: {
  userId: string;
  conversationId: string;
  title: string;
  sourceDeviceId: string;
  turn: AssistantTurn;
  fence?: number | null;
  sessionId?: string | null;
}): PendingAssistantWrite | null {
  const body = input.turn.text.trim();
  if (!body || (input.turn.role !== "user" && input.turn.role !== "assistant")) return null;
  return {
    userId: input.userId,
    conversationId: input.conversationId,
    title: input.title,
    message: {
      id: input.turn.id,
      role: input.turn.role,
      status: input.turn.status === "interrupted" ? "interrupted" : "final",
      body,
      sourceDeviceId: input.sourceDeviceId,
      citations: citationsFromSources(input.turn.sources ?? []),
      fence: input.fence ?? null,
      sessionId: input.sessionId ?? null,
    },
  };
}

function readCitations(value: unknown): AssistantCitation[] {
  if (!Array.isArray(value)) return [];
  const citations: AssistantCitation[] = [];
  for (const entry of value) {
    const fields = record(entry);
    if (!fields || citations.length >= ASSISTANT_CITATION_LIMIT) continue;
    const url = typeof fields.url === "string" ? fields.url.trim() : "";
    const title = typeof fields.title === "string" ? fields.title.trim() : "";
    if (!url.startsWith("https://") || url.length > ASSISTANT_CITATION_URL_LIMIT) continue;
    if (!title || title.length > ASSISTANT_CITATION_TITLE_LIMIT) continue;
    citations.push({ url, title });
  }
  return citations;
}

function readWrite(value: unknown, userId: string): PendingAssistantWrite | null {
  const fields = record(value);
  const message = fields ? record(fields.message) : null;
  if (!fields || !message) return null;
  if (fields.userId !== userId || typeof fields.conversationId !== "string" || typeof fields.title !== "string") return null;
  if (typeof message.id !== "string" || !message.id || typeof message.body !== "string" || !message.body.trim()) return null;
  if (message.role !== "user" && message.role !== "assistant") return null;
  if (message.status !== "final" && message.status !== "interrupted") return null;
  if (typeof message.sourceDeviceId !== "string" || !message.sourceDeviceId) return null;
  const fence = typeof message.fence === "number" && Number.isSafeInteger(message.fence) && message.fence >= 0
    ? message.fence
    : typeof message.fence === "string" && message.fence.trim() && Number.isSafeInteger(Number(message.fence))
      ? Number(message.fence)
      : null;
  return {
    userId,
    conversationId: fields.conversationId,
    title: fields.title.trim() || ASSISTANT_DEFAULT_TITLE,
    message: {
      id: message.id,
      role: message.role,
      status: message.status,
      body: message.body,
      sourceDeviceId: message.sourceDeviceId,
      citations: readCitations(message.citations),
      fence,
      sessionId: typeof message.sessionId === "string" ? message.sessionId : null,
    },
  };
}

/** Account-scoped queue. Unreadable storage is an empty queue, not another account's data. */
export function readPending(storage: KeyValueStorage, userId: string): PendingAssistantWrite[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(pendingKey(userId)) ?? "null");
  } catch {
    return [];
  }
  const fields = record(parsed);
  if (!fields || fields.version !== PENDING_VERSION || !Array.isArray(fields.writes)) return [];
  return fields.writes.map((entry) => readWrite(entry, userId)).filter((entry): entry is PendingAssistantWrite => entry !== null);
}

/** Replaces this account's queue. An empty queue is stored so a removed write cannot come back. */
export function writePending(storage: KeyValueStorage, userId: string, writes: readonly PendingAssistantWrite[]): void {
  storage.setItem(pendingKey(userId), JSON.stringify({ version: PENDING_VERSION, writes }));
}

/** Last thread this account had open on this install. Other accounts keep their own key. */
export function readOpenConversation(storage: KeyValueStorage, userId: string): string | null {
  const value = storage.getItem(openKey(userId));
  if (!value) return null;
  try {
    return assistantId(value, "conversation");
  } catch {
    return null;
  }
}

/** Remembers the open thread for this account. Pass null when nothing is open. */
export function writeOpenConversation(storage: KeyValueStorage, userId: string, id: string | null): void {
  storage.setItem(openKey(userId), id ?? "");
}

/** Adds a write once. The same message id updates the title and does not become a second row. */
export function enqueuePending(queue: readonly PendingAssistantWrite[], item: PendingAssistantWrite): PendingAssistantWrite[] {
  const titled = queue.map((entry) => entry.conversationId === item.conversationId ? { ...entry, title: item.title } : entry);
  if (titled.some((entry) => entry.message.id === item.message.id)) return titled;
  return [...titled, item];
}

/** Drops every queued write for a deleted thread so a retry cannot recreate its text. */
export function dropConversation(queue: readonly PendingAssistantWrite[], conversationId: string): PendingAssistantWrite[] {
  return queue.filter((entry) => entry.conversationId !== conversationId);
}

/**
 * Server rows in sequence order, then queued writes the server does not have yet.
 * Tool rows are not transcript turns.
 */
export function turnsFromStored(
  messages: readonly AssistantStoredMessage[],
  pending: readonly PendingAssistantWrite[],
): AssistantTurn[] {
  const turns: AssistantTurn[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    seen.add(message.id);
    turns.push({
      id: message.id,
      role: message.role,
      text: message.body,
      ...(message.status === "interrupted" ? { status: "interrupted" as const } : {}),
      ...(message.citations.length ? { sources: message.citations.map((citation) => ({ url: citation.url, title: citation.title })) } : {}),
    });
  }
  for (const item of pending) {
    if (seen.has(item.message.id)) continue;
    seen.add(item.message.id);
    turns.push({
      id: item.message.id,
      role: item.message.role,
      text: item.message.body,
      ...(item.message.status === "interrupted" ? { status: "interrupted" as const } : {}),
      ...(item.message.citations.length ? { sources: item.message.citations.map((citation) => ({ url: citation.url, title: citation.title })) } : {}),
    });
  }
  return turns;
}

const CACHE_VERSION = 1;
const CACHE_THREAD_LIMIT = 30;
const CACHE_TURN_LIMIT = 80;

export interface CachedAssistantThread {
  id: string;
  title: string;
}

export interface CachedAssistantTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "interrupted";
}

export interface AssistantTranscriptCache {
  threads: CachedAssistantThread[];
  transcripts: { id: string; turns: CachedAssistantTurn[] }[];
}

export interface RecoveredAssistantLine {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function cacheKey(userId: string): string {
  return `assistant.cache.v1.${userId}`;
}

function recoveryKey(userId: string): string {
  return `assistant.recovery.v1.${userId}`;
}

function readJson(storage: KeyValueStorage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function readCachedTurn(value: unknown): CachedAssistantTurn | null {
  const fields = record(value);
  if (!fields || (fields.role !== "user" && fields.role !== "assistant")) return null;
  if (typeof fields.id !== "string" || !fields.id || typeof fields.text !== "string" || !fields.text) return null;
  return {
    id: fields.id,
    role: fields.role,
    text: fields.text,
    ...(fields.status === "interrupted" ? { status: "interrupted" as const } : {}),
  };
}

/** Last transcripts this account loaded on this install. Another account's key is never read. */
export function readAssistantCache(storage: KeyValueStorage, userId: string): AssistantTranscriptCache | null {
  const fields = record(readJson(storage, cacheKey(userId)));
  if (!fields || fields.version !== CACHE_VERSION || !Array.isArray(fields.threads) || !Array.isArray(fields.transcripts)) return null;
  const threads = fields.threads.map((entry) => {
    const row = record(entry);
    return row && typeof row.id === "string" && typeof row.title === "string" ? { id: row.id, title: row.title } : null;
  }).filter((entry): entry is CachedAssistantThread => entry !== null).slice(0, CACHE_THREAD_LIMIT);
  const transcripts = fields.transcripts.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.id !== "string" || !Array.isArray(row.turns)) return null;
    const turns = row.turns.map(readCachedTurn).filter((turn): turn is CachedAssistantTurn => turn !== null).slice(-CACHE_TURN_LIMIT);
    return { id: row.id, turns };
  }).filter((entry): entry is { id: string; turns: CachedAssistantTurn[] } => entry !== null).slice(-CACHE_THREAD_LIMIT);
  return { threads, transcripts };
}

/** Remembers a short copy of what this account already loaded. */
export function writeAssistantCache(storage: KeyValueStorage, userId: string, cache: AssistantTranscriptCache): void {
  const threads = cache.threads.slice(0, CACHE_THREAD_LIMIT);
  const transcripts = cache.transcripts.slice(-CACHE_THREAD_LIMIT).map((entry) => ({
    id: entry.id,
    turns: entry.turns.slice(-CACHE_TURN_LIMIT),
  }));
  storage.setItem(cacheKey(userId), JSON.stringify({ version: CACHE_VERSION, threads, transcripts }));
}

/** Lines that must not be merged into the shared thread. Kept for the person to dismiss. */
export function readRecovery(storage: KeyValueStorage, userId: string): RecoveredAssistantLine[] {
  const fields = record(readJson(storage, recoveryKey(userId)));
  if (!fields || fields.version !== CACHE_VERSION || !Array.isArray(fields.lines)) return [];
  return fields.lines.map((entry) => {
    const row = record(entry);
    if (!row || (row.role !== "user" && row.role !== "assistant")) return null;
    if (typeof row.id !== "string" || !row.id || typeof row.text !== "string" || !row.text) return null;
    return { id: row.id, role: row.role, text: row.text };
  }).filter((entry): entry is RecoveredAssistantLine => entry !== null).slice(-20);
}

export function writeRecovery(storage: KeyValueStorage, userId: string, lines: readonly RecoveredAssistantLine[]): void {
  storage.setItem(recoveryKey(userId), JSON.stringify({ version: CACHE_VERSION, lines: lines.slice(-20) }));
}
