import { describe, expect, it } from "vitest";
import {
  citationsFromSources,
  conversationTitleFrom,
  dropConversation,
  enqueuePending,
  readPending,
  turnsFromStored,
  writePending,
  type PendingAssistantWrite,
} from "@/assistant/conversationRecord";
import type { AssistantStoredMessage } from "@/services/assistantConversations";
import type { KeyValueStorage } from "@/sync/personalCache";

const USER = "11111111-1111-4111-8111-111111111111";

function memory(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

function write(id: string, body: string): PendingAssistantWrite {
  return {
    userId: USER,
    conversationId: "22222222-2222-4222-8222-222222222222",
    title: "New conversation",
    message: {
      id,
      role: "user",
      status: "final",
      body,
      sourceDeviceId: "33333333-3333-4333-8333-333333333333",
      citations: [],
      fence: null,
    },
  };
}

describe("conversation records", () => {
  it("clips a title and drops citations the server would reject", () => {
    expect(conversationTitleFrom("  hello   there  ")).toBe("hello there");
    expect(conversationTitleFrom("")).toBe("New conversation");
    expect(citationsFromSources([
      { url: "http://example.com", title: "No" },
      { url: "https://example.com/a", title: "Yes" },
      { url: "https://example.com/b", title: "" },
    ])).toEqual([{ url: "https://example.com/a", title: "Yes" }]);
  });

  it("queues one write per id and drops a deleted thread", () => {
    const first = write("44444444-4444-4444-8444-000000000001", "Hello");
    const again = write("44444444-4444-4444-8444-000000000001", "Hello again");
    const queued = enqueuePending(enqueuePending([], first), { ...again, title: "Hello" });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.title).toBe("Hello");
    expect(dropConversation(queued, first.conversationId)).toEqual([]);
  });

  it("ignores another account's queue and unreadable storage", () => {
    const storage = memory();
    writePending(storage, USER, [write("44444444-4444-4444-8444-000000000001", "Hello")]);
    storage.setItem("assistant.pending.v1.other", storage.getItem(`assistant.pending.v1.${USER}`) ?? "");
    expect(readPending(storage, "other")).toEqual([]);
    storage.setItem(`assistant.pending.v1.${USER}`, "{");
    expect(readPending(storage, USER)).toEqual([]);
  });

  it("shows server rows and a queued user line that is not on the server yet", () => {
    const stored: AssistantStoredMessage = {
      id: "44444444-4444-4444-8444-000000000001",
      conversationId: "22222222-2222-4222-8222-222222222222",
      role: "assistant",
      status: "interrupted",
      body: "Partial",
      seq: 1,
      sourceDeviceId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-09-30T00:00:00.000Z",
      citations: [],
      toolName: null,
      toolOutcome: null,
    };
    const pending = write("44444444-4444-4444-8444-000000000002", "Still here");
    const turns = turnsFromStored([stored], [pending, { ...pending, message: { ...pending.message, id: stored.id } }]);
    expect(turns).toEqual([
      { id: stored.id, role: "assistant", text: "Partial", status: "interrupted" },
      { id: pending.message.id, role: "user", text: "Still here" },
    ]);
  });
});
