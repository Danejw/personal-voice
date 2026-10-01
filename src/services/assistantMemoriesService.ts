import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareMemoryKey, type AssistantMemory } from "@/assistant/memory";
import {
  assistantMemoryError,
  learningBatchFromPayload,
  memoriesFromPayload,
  prepareLearningCommit,
  prepareRemember,
  type ForgetMemoryInput,
  type LearningBatchMessage,
  type LearningCommitMessage,
  type RememberMemoryInput,
} from "@/services/assistantMemories";
import { assistantId } from "@/services/assistantConversations";
import { getSupabase } from "@/services/supabase";
import type { Database, Json } from "@/types/database";

export interface AssistantMemoriesApi {
  list(userId: string): Promise<AssistantMemory[]>;
  remember(userId: string, input: RememberMemoryInput): Promise<AssistantMemory[]>;
  forget(userId: string, input: ForgetMemoryInput): Promise<AssistantMemory[]>;
  /** Finalized user lines saved after learning was turned on, at most eight. */
  listLearningBatch(userId: string): Promise<LearningBatchMessage[]>;
  /** Writes memories the server recomputes from those stored lines. */
  commitLearning(userId: string, batch: readonly LearningCommitMessage[]): Promise<AssistantMemory[]>;
  /** Keeps a candidate as an explicit memory, or forgets it so it is not learned again. */
  settleCandidate(userId: string, id: string, keep: boolean): Promise<AssistantMemory[]>;
}

function requireClient(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) throw new Error("Memory storage is not configured for this build.");
  return client;
}

function unwrap(error: { code: string; message: string } | null, data: unknown): unknown {
  if (error) throw assistantMemoryError(error);
  if (data == null) throw assistantMemoryError({ code: "", message: "" });
  return data;
}

/**
 * Supabase access for explicit Assistant memories.
 * Ownership is enforced inside the RPCs. `userId` must be the signed-in account.
 */
export function createAssistantMemoriesApi(
  getClient: () => SupabaseClient<Database> = requireClient,
): AssistantMemoriesApi {
  return {
    async list(userId) {
      const client = getClient();
      const { data, error } = await client.rpc("list_assistant_memories", {
        p_user_id: assistantId(userId, "account"),
      });
      return memoriesFromPayload(unwrap(error, data));
    },

    async remember(userId, input) {
      const prepared = prepareRemember(input);
      const client = getClient();
      const { data, error } = await client.rpc("remember_assistant_memory", {
        p_user_id: assistantId(userId, "account"),
        p_id: prepared.id,
        p_kind: prepared.kind,
        p_key: prepared.key,
        p_value: prepared.value,
        p_source_conversation_id: prepared.sourceConversationId,
        p_source_message_id: prepared.sourceMessageId,
        p_replace: prepared.replace,
        p_expected_revision: prepared.expectedRevision,
      });
      return memoriesFromPayload(unwrap(error, data));
    },

    async forget(userId, input) {
      const parsed = prepareMemoryKey(input.key);
      if ("error" in parsed) throw assistantMemoryError({ code: "23514", message: "ASSISTANT_MEMORY_REJECTED" });
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
        throw assistantMemoryError({ code: "23514", message: "ASSISTANT_MEMORY_REJECTED" });
      }
      const key = parsed.key;
      const client = getClient();
      const { data, error } = await client.rpc("forget_assistant_memory", {
        p_user_id: assistantId(userId, "account"),
        p_key: key,
        p_expected_revision: input.expectedRevision,
      });
      return memoriesFromPayload(unwrap(error, data));
    },

    async listLearningBatch(userId) {
      const client = getClient();
      const { data, error } = await client.rpc("list_assistant_learning_batch", {
        p_user_id: assistantId(userId, "account"),
      });
      return learningBatchFromPayload(unwrap(error, data));
    },

    async commitLearning(userId, batch) {
      const prepared = prepareLearningCommit(batch);
      const client = getClient();
      const { data, error } = await client.rpc("commit_assistant_learning", {
        p_user_id: assistantId(userId, "account"),
        p_batch: prepared as unknown as Json,
      });
      return memoriesFromPayload(unwrap(error, data));
    },

    async settleCandidate(userId, id, keep) {
      const client = getClient();
      const { data, error } = await client.rpc("settle_assistant_memory_candidate", {
        p_user_id: assistantId(userId, "account"),
        p_id: assistantId(id, "memory"),
        p_keep: keep,
      });
      return memoriesFromPayload(unwrap(error, data));
    },
  };
}

export const assistantMemoriesApi = createAssistantMemoriesApi();
