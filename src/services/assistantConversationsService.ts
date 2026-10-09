import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AssistantStorageError,
  assistantId,
  assistantStorageError,
  citationsJson,
  conversationFromPayload,
  messageFromPayload,
  prepareAssistantMessage,
  prepareAssistantTitle,
  preparePageLimit,
  readAppendResult,
  readClaimResult,
  readCreateResult,
  readSummaryResult,
  sessionFromPayload,
  type AssistantSession,
  type AssistantConversation,
  type AssistantMessageInput,
  type AssistantStoredMessage,
} from "@/services/assistantConversations";
import type { ContextAttachment, StoredSummary } from "@/assistant/contextRestore";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/types/database";

export interface AssistantConversationPage {
  limit?: number;
  /** Pass the last row from the previous page. Omit for the first page. */
  before?: { updatedAt: string; id: string } | null;
}

export interface AssistantMessagePage {
  limit?: number;
  /** Return messages with a sequence greater than this. Omit to start at the first. */
  afterSeq?: number;
}

export interface AssistantConversationsApi {
  create(userId: string, input: { id: string; title: string }): Promise<{ conversation: AssistantConversation; created: boolean }>;
  rename(userId: string, id: string, title: string): Promise<AssistantConversation>;
  delete(userId: string, id: string): Promise<void>;
  get(userId: string, id: string): Promise<AssistantConversation>;
  list(userId: string, page?: AssistantConversationPage): Promise<AssistantConversation[]>;
  append(userId: string, input: AssistantMessageInput): Promise<{ message: AssistantStoredMessage; appended: boolean; revision: number }>;
  claim(userId: string, id: string, deviceId: string, input: { ttlSeconds: number; takeover: boolean }): Promise<{ conversation: AssistantConversation; acquired: boolean }>;
  release(userId: string, id: string, deviceId: string, fence: number): Promise<void>;
  saveSummary(userId: string, id: string, summary: StoredSummary, replaces: string | null): Promise<{ conversation: AssistantConversation; saved: boolean }>;
  saveContextItems(userId: string, id: string, items: readonly ContextAttachment[]): Promise<void>;
  listMessages(userId: string, conversationId: string, page?: AssistantMessagePage): Promise<AssistantStoredMessage[]>;
  /** Session APIs are additive so old in-memory test adapters remain compatible. */
  startSession?(userId: string, conversationId: string, deviceId: string, sessionId: string): Promise<AssistantSession>;
  finishSession?(userId: string, sessionId: string, reason: "ended" | "interrupted" | "lost"): Promise<void>;
  listSessions?(userId: string, conversationId: string, page?: { limit?: number; before?: { startedAt: string; id: string } | null }): Promise<AssistantSession[]>;
  listSessionMessages?(userId: string, conversationId: string, sessionId: string, page?: AssistantMessagePage): Promise<AssistantStoredMessage[]>;
  archive?(userId: string, conversationId: string, archived: boolean): Promise<AssistantConversation>;
  listArchived?(userId: string, page?: AssistantConversationPage): Promise<AssistantConversation[]>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Conversation storage is not configured for this build.");
  return client;
}

function unwrap<T>(error: { code: string; message: string } | null, data: T | null, label: string): T {
  if (error) throw assistantStorageError(error);
  if (data == null) {
    throw new AssistantStorageError("unavailable", `The conversation service did not return a ${label}.`);
  }
  return data;
}

/**
 * Supabase access for saved Assistant conversations.
 * Ownership is enforced inside the RPCs. `userId` must be the signed-in account.
 * The lease columns are readable and are not acquired here.
 */
export function createAssistantConversationsApi(
  getClient: () => SupabaseClient<Database>,
): AssistantConversationsApi {
  return {
    async create(userId, input) {
      const client = getClient();
      const { data, error } = await client.rpc("create_assistant_conversation", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(input.id, "conversation"),
        p_title: prepareAssistantTitle(input.title),
      });
      return readCreateResult(unwrap(error, data, "conversation"));
    },

    async rename(userId, id, title) {
      const client = getClient();
      const { data, error } = await client.rpc("rename_assistant_conversation", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(id, "conversation"),
        p_title: prepareAssistantTitle(title),
      });
      return conversationFromPayload(unwrap(error, data, "conversation"));
    },

    async delete(userId, id) {
      const client = getClient();
      const { error } = await client.rpc("delete_assistant_conversation", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(id, "conversation"),
      });
      if (error) throw assistantStorageError(error);
    },

    async get(userId, id) {
      const client = getClient();
      const { data, error } = await client.rpc("get_assistant_conversation", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(id, "conversation"),
      });
      return conversationFromPayload(unwrap(error, data, "conversation"));
    },

    async list(userId, page) {
      const client = getClient();
      const before = page?.before ?? null;
      if (before && (!before.updatedAt || !before.id)) {
        throw assistantStorageError({ code: "23514", message: "ASSISTANT_PAGE_REJECTED" });
      }
      const { data, error } = await client.rpc("list_assistant_conversations", {
        p_user_id: assistantId(userId, "account"),
        p_limit: preparePageLimit(page?.limit),
        p_before_updated_at: before?.updatedAt ?? null,
        p_before_id: before ? assistantId(before.id, "conversation") : null,
      });
      if (error) throw assistantStorageError(error);
      return (data ?? []).map(conversationFromPayload);
    },

    async listArchived(userId, page) {
      const client = getClient();
      const before = page?.before ?? null;
      const { data, error } = await client.rpc("list_archived_assistant_conversations", {
        p_user_id: assistantId(userId, "account"),
        p_limit: preparePageLimit(page?.limit),
        p_before_updated_at: before?.updatedAt ?? null,
        p_before_id: before ? assistantId(before.id, "conversation") : null,
      });
      if (error) throw assistantStorageError(error);
      return (data ?? []).map(conversationFromPayload);
    },

    async archive(userId, conversationId, archived) {
      const { data, error } = await getClient().rpc("set_assistant_conversation_archived", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(conversationId, "conversation"),
        p_archived: archived,
      });
      return conversationFromPayload(unwrap(error, data, "conversation"));
    },

    async startSession(userId, conversationId, deviceId, sessionId) {
      const { data, error } = await getClient().rpc("start_assistant_session", {
        p_user_id: assistantId(userId, "account"),
        p_conversation_id: assistantId(conversationId, "conversation"),
        p_device_id: assistantId(deviceId, "device"),
        p_session_id: assistantId(sessionId, "session"),
      });
      return sessionFromPayload(unwrap(error, data, "session"));
    },

    async finishSession(userId, sessionId, reason) {
      const { error } = await getClient().rpc("finish_assistant_session", {
        p_user_id: assistantId(userId, "account"), p_session_id: assistantId(sessionId, "session"),
        p_reason: reason,
      });
      if (error) throw assistantStorageError(error);
    },

    async listSessions(userId, conversationId, page) {
      const before = page?.before ?? null;
      const { data, error } = await getClient().rpc("list_assistant_sessions", {
        p_user_id: assistantId(userId, "account"),
        p_conversation_id: assistantId(conversationId, "conversation"),
        p_limit: preparePageLimit(page?.limit),
        p_before_started_at: before?.startedAt ?? null,
        p_before_id: before ? assistantId(before.id, "session") : null,
      });
      if (error) throw assistantStorageError(error);
      return (data ?? []).map(sessionFromPayload);
    },

    async listSessionMessages(userId, conversationId, sessionId, page) {
      const afterSeq = page?.afterSeq ?? 0;
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error("Invalid sequence cursor.");
      const { data, error } = await getClient().rpc("list_assistant_session_messages", {
        p_user_id: assistantId(userId, "account"),
        p_conversation_id: assistantId(conversationId, "conversation"),
        p_session_id: assistantId(sessionId, "session"),
        p_after_seq: afterSeq, p_limit: preparePageLimit(page?.limit),
      });
      if (error) throw assistantStorageError(error);
      return (data ?? []).map(messageFromPayload);
    },

    async append(userId, input) {
      const client = getClient();
      const prepared = prepareAssistantMessage(input);
      const { data, error } = await client.rpc("append_assistant_message", {
        p_user_id: assistantId(userId, "account"),
        ...prepared,
        p_citations: citationsJson(prepared.p_citations),
      });
      return readAppendResult(unwrap(error, data, "message"));
    },

    async claim(userId, id, deviceId, input) {
      const client = getClient();
      const { data, error } = await client.rpc("claim_assistant_conversation", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(id, "conversation"),
        p_device_id: assistantId(deviceId, "device"),
        p_ttl_seconds: input.ttlSeconds,
        p_takeover: input.takeover,
      });
      return readClaimResult(unwrap(error, data, "lease"));
    },

    async release(userId, id, deviceId, fence) {
      const client = getClient();
      const { error } = await client.rpc("release_assistant_conversation", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(id, "conversation"),
        p_device_id: assistantId(deviceId, "device"),
        p_fence: fence,
      });
      if (error) throw assistantStorageError(error);
    },

    async saveSummary(userId, id, summary, replaces) {
      const client = getClient();
      const { data, error } = await client.rpc("save_assistant_summary", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(id, "conversation"),
        p_body: summary.body,
        p_through_seq: summary.throughSeq,
        p_fingerprint: summary.fingerprint,
        p_replaces: replaces,
      });
      return readSummaryResult(unwrap(error, data, "summary"));
    },

    async saveContextItems(userId, id, items) {
      const client = getClient();
      const { error } = await client.rpc("save_assistant_context_items", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(id, "conversation"),
        p_items: items.map((item) => ({
          kind: item.kind,
          id: item.id,
          body: item.body,
          captured_at: item.capturedAt,
          source: item.source,
        })),
      });
      if (error) throw assistantStorageError(error);
    },

    async listMessages(userId, conversationId, page) {
      const afterSeq = page?.afterSeq ?? 0;
      if (!Number.isInteger(afterSeq) || afterSeq < 0) {
        throw assistantStorageError({ code: "23514", message: "ASSISTANT_PAGE_REJECTED" });
      }
      const client = getClient();
      const { data, error } = await client.rpc("list_assistant_messages", {
        p_user_id: assistantId(userId, "account"),
        p_conversation_id: assistantId(conversationId, "conversation"),
        p_after_seq: afterSeq,
        p_limit: preparePageLimit(page?.limit),
      });
      if (error) throw assistantStorageError(error);
      return (data ?? []).map(messageFromPayload);
    },
  };
}

export const assistantConversationsApi = createAssistantConversationsApi(requireClient);
