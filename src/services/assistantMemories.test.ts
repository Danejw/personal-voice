import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ASSISTANT_MEMORY_TOKENS, memoriesFromPayload } from "@/services/assistantMemories";

describe("assistant memory service", () => {
  it("keeps the server failure tokens in the migration", async () => {
    const sql = await readFile(new URL("../../supabase/migrations/20260930230000_assistant_memories.sql", import.meta.url), "utf8");
    for (const token of ASSISTANT_MEMORY_TOKENS) {
      if (token === "ASSISTANT_NOT_SIGNED_IN" || token === "ASSISTANT_ACCOUNT_MISMATCH") continue;
      expect(sql).toContain(token);
    }
    expect(sql).toContain("assistant_memory_suppressed");
    expect(sql).toContain("'account', 'active', 'explicit'");
  });

  it("reads a memory row and rejects a foreign shape", () => {
    const rows = memoriesFromPayload([{
      id: "11111111-1111-4111-8111-111111111111",
      memory_key: "answer_length",
      kind: "preference",
      value: "Prefer short answers.",
      status: "active",
      origin: "explicit",
      source_conversation_id: null,
      source_message_id: null,
      supersedes_id: null,
      revision: 1,
      created_at: "2026-09-30T12:00:00.000Z",
      updated_at: "2026-09-30T12:00:00.000Z",
      forgotten_at: null,
    }]);
    expect(rows[0]?.key).toBe("answer_length");
    expect(() => memoriesFromPayload([{ id: "nope" }])).toThrow(/unreadable/);
  });
});
