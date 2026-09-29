import { describe, expect, it } from "vitest";
import { ACCOUNT_LIST_COUNT, formatHandoffList, formatVoiceNoteList } from "@/assistant/accountTools";

describe("account tool lists", () => {
  it("lists inbox notes and hides archived notes until asked", () => {
    const notes = [
      { id: "n1", text: "Buy milk", status: "inbox" as const, createdAt: "2026-09-28T12:00:00.000Z" },
      { id: "n2", text: "Old", status: "archived" as const, createdAt: "2026-09-01T12:00:00.000Z" },
    ];
    expect(formatVoiceNoteList(notes, false)).toContain("id: n1");
    expect(formatVoiceNoteList(notes, false)).not.toContain("id: n2");
    expect(formatVoiceNoteList(notes, true)).toContain("id: n2");
    expect(formatVoiceNoteList([], false)).toContain("No voice notes in the inbox");
  });

  it("names send targets and clips a long note", () => {
    const text = "a".repeat(600);
    const listed = formatVoiceNoteList(
      [{ id: "n1", text, status: "inbox", createdAt: "2026-09-28T12:00:00.000Z" }],
      false,
    );
    expect(listed).toContain("id: n1");
    expect(listed).toContain("…");
    expect(listed).not.toContain("a".repeat(600));
  });

  it("lists devices even when nothing has been received", () => {
    expect(formatHandoffList(["Phone"], [])).toBe("Devices you can send to: Phone.\nNo received handoffs.");
    expect(formatHandoffList([], [])).toContain("No other device");
  });

  it("stops after the list cap", () => {
    const notes = Array.from({ length: ACCOUNT_LIST_COUNT + 2 }, (_, index) => ({
      id: `n${index}`,
      text: "Note",
      status: "inbox" as const,
      createdAt: "2026-09-28T12:00:00.000Z",
    }));
    const listed = formatVoiceNoteList(notes, false);
    expect(listed).toContain("id: n0");
    expect(listed).not.toContain(`id: n${ACCOUNT_LIST_COUNT}`);
    expect(listed).toContain("2 more were not listed.");
  });
});
