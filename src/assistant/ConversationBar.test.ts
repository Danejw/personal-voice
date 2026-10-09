import { describe, expect, it } from "vitest";
import { filterConversations, threadTime } from "@/assistant/ConversationBar";

describe("assistant conversation navigation", () => {
  const threads = [
    { id: "first", title: "Construction planning", updatedAt: "2026-10-08T18:00:00Z" },
    { id: "second", title: "Voice assistant improvements", updatedAt: "2026-10-07T18:00:00Z" },
    { id: "third", title: "UFiQ marketing" },
  ];
  it("keeps server ordering for recent threads and filters by title", () => {
    expect(filterConversations(threads, "")).toEqual(threads);
    expect(filterConversations(threads, "  VOICE ")).toEqual([threads[1]]);
    expect(filterConversations(threads, "not found")).toEqual([]);
    expect(threads).toHaveLength(3);
  });
  it("formats saved activity when known without fabricating dates", () => {
    expect(threadTime(threads[0]?.updatedAt)).toMatch(/\d/);
    expect(threadTime(undefined)).toBeNull();
    expect(threadTime("garbage")).toBeNull();
  });
});
