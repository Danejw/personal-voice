import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_STORAGE_TOKENS,
  AssistantStorageError,
  assistantStorageError,
  conversationFromPayload,
  messageFromPayload,
  prepareAssistantMessage,
  prepareAssistantTitle,
  readAppendResult,
  readCreateResult,
} from "@/services/assistantConversations";
import { createAssistantConversationsApi } from "@/services/assistantConversationsService";
import type { Database } from "@/types/database";

const USER = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const DEVICE = "44444444-4444-4444-8444-444444444444";

const conversationRow = {
  id: CONVERSATION,
  user_id: USER,
  title: "Hello",
  revision: 0,
  created_at: "2026-09-30T12:00:00.000Z",
  updated_at: "2026-09-30T12:00:00.000Z",
  deleted_at: null,
  lease_device_id: null,
  lease_expires_at: null,
  fence: 0,
};

function client(
  impl: (name: string, args: Record<string, unknown>) => { data: unknown; error: { code: string; message: string } | null },
): SupabaseClient<Database> {
  return {
    rpc: (name: string, args: Record<string, unknown>) => Promise.resolve(impl(name, args)),
  } as unknown as SupabaseClient<Database>;
}

describe("assistant conversation storage", () => {
  it("keeps the server failure tokens in the migration", async () => {
    const sql = [
      await readFile(new URL("../../supabase/migrations/20260930200000_assistant_conversations.sql", import.meta.url), "utf8"),
      await readFile(new URL("../../supabase/migrations/20260930210000_assistant_lease.sql", import.meta.url), "utf8"),
      await readFile(new URL("../../supabase/migrations/20260930220000_assistant_context.sql", import.meta.url), "utf8"),
    ].join("\n");
    for (const token of ASSISTANT_STORAGE_TOKENS) expect(sql).toContain(`'${token}'`);
    expect(sql).toContain("grant select on public.assistant_conversations, public.assistant_messages to authenticated");
    expect(sql).not.toMatch(/grant insert, update, delete on public\.assistant_/);
  });

  it("maps server tokens to typed errors and hides the raw message", () => {
    const error = assistantStorageError({ code: "P0001", message: "ASSISTANT_MESSAGE_CONFLICT" });
    expect(error).toBeInstanceOf(AssistantStorageError);
    expect(error.code).toBe("conflict");
    expect(error.message).not.toContain("ASSISTANT_MESSAGE_CONFLICT");
    expect(assistantStorageError({ code: "42501", message: "ASSISTANT_ACCOUNT_MISMATCH" }).code).toBe("forbidden");
    expect(assistantStorageError({ code: "P0001", message: "ASSISTANT_CONVERSATION_DELETED" }).code).toBe("deleted");
    expect(assistantStorageError({ code: "42501", message: "permission denied" }).code).toBe("not-signed-in");
    expect(assistantStorageError({ code: "", message: "fetch failed" }).code).toBe("unavailable");
  });

  it("trims titles and drops citation fields other than url and title", () => {
    expect(prepareAssistantTitle("  Hello  ")).toBe("Hello");
    expect(() => prepareAssistantTitle("   ")).toThrow(AssistantStorageError);
    const prepared = prepareAssistantMessage({
      id: MESSAGE,
      conversationId: CONVERSATION,
      role: "assistant",
      status: "final",
      body: "  Answer  ",
      sourceDeviceId: DEVICE,
      citations: [{ url: " https://example.com/a ", title: " Example ", args: "do-not-store" } as { url: string; title: string }],
    });
    expect(prepared.p_body).toBe("Answer");
    expect(prepared.p_citations).toEqual([{ url: "https://example.com/a", title: "Example" }]);
    expect(prepared.p_tool_name).toBeNull();
    expect(prepared).not.toHaveProperty("args");
  });

  it("rejects tool arguments on an ordinary turn and empty tool results", () => {
    expect(() => prepareAssistantMessage({
      id: MESSAGE,
      conversationId: CONVERSATION,
      role: "user",
      status: "final",
      body: "Hi",
      sourceDeviceId: DEVICE,
      toolName: "insert_text",
      toolOutcome: "done",
    })).toThrow(AssistantStorageError);
    expect(() => prepareAssistantMessage({
      id: MESSAGE,
      conversationId: CONVERSATION,
      role: "tool",
      status: "interrupted",
      body: "Ran it",
      sourceDeviceId: DEVICE,
      toolName: "insert_text",
      toolOutcome: "done",
    })).toThrow(AssistantStorageError);
  });

  it("reads a tombstone as deleted and a bigint sequence as a number", () => {
    expect(() => conversationFromPayload({ ...conversationRow, deleted_at: "2026-09-30T12:00:00.000Z", title: "" })).toThrow(AssistantStorageError);
    const message = messageFromPayload({
      id: MESSAGE,
      conversation_id: CONVERSATION,
      user_id: USER,
      role: "assistant",
      status: "interrupted",
      body: "Partial",
      seq: "2",
      source_device_id: DEVICE,
      created_at: new Date("2026-09-30T12:00:00.000Z"),
      citations: [],
      tool_name: null,
      tool_outcome: null,
    });
    expect(message.seq).toBe(2);
    expect(message.status).toBe("interrupted");
    expect(message.createdAt).toBe("2026-09-30T12:00:00.000Z");
  });

  it("sends the signed-in account and treats a repeated create as not new", async () => {
    const seen: { name: string; args: Record<string, unknown> }[] = [];
    const api = createAssistantConversationsApi(() => client((name, args) => {
      seen.push({ name, args });
      return { data: { ...conversationRow, created: false, revision: "3" }, error: null };
    }));
    const result = await api.create(USER, { id: CONVERSATION, title: "  Hello  " });
    expect(result.created).toBe(false);
    expect(result.conversation.revision).toBe(3);
    expect(seen[0]).toEqual({
      name: "create_assistant_conversation",
      args: { p_user_id: USER, p_id: CONVERSATION, p_title: "Hello" },
    });
  });

  it("returns the conversation revision from an idempotent append", () => {
    const result = readAppendResult({
      id: MESSAGE,
      conversation_id: CONVERSATION,
      user_id: USER,
      role: "tool",
      status: "final",
      body: "Saved the note",
      seq: 1,
      source_device_id: DEVICE,
      created_at: "2026-09-30T12:00:00.000Z",
      citations: [],
      tool_name: "create_note",
      tool_outcome: "Saved the note",
      appended: false,
      revision: 4,
    });
    expect(result.appended).toBe(false);
    expect(result.revision).toBe(4);
    expect(result.message.toolName).toBe("create_note");
    expect(readCreateResult({ ...conversationRow, created: true }).created).toBe(true);
  });

  it("turns a deleted-conversation RPC failure into a deleted error", async () => {
    const api = createAssistantConversationsApi(() => client(() => ({
      data: null,
      error: { code: "P0001", message: "ASSISTANT_CONVERSATION_DELETED" },
    })));
    await expect(api.append(USER, {
      id: MESSAGE,
      conversationId: CONVERSATION,
      role: "user",
      status: "final",
      body: "Again",
      sourceDeviceId: DEVICE,
    })).rejects.toMatchObject({ code: "deleted" });
  });
});
