import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ACCOUNT_LIMIT,
  ASSISTANT_NOTE_LIMIT,
  acceptHandoff,
  acceptNote,
  accountContextText,
  copyHandoff,
  copyNote,
  noteDetachedText,
} from "@/assistant/accountContext";

const note = (id: string, text: string): { id: string; text: string; createdAt: string } => ({
  id,
  text,
  createdAt: "2026-09-28T00:00:00.000Z",
});

describe("account context", () => {
  it("accepts explicit notes and refuses duplicates, empties, and the caps", () => {
    const first = note("a", "The launch code is amber.");
    expect(acceptNote([], null, first)).toEqual({ ok: true });
    expect(acceptNote([first], null, first).ok).toBe(false);
    expect(acceptNote([], null, note("empty", "  ")).ok).toBe(false);
    const full = Array.from({ length: ASSISTANT_NOTE_LIMIT }, (_, index) => note(String(index), "x"));
    expect(acceptNote(full, null, note("extra", "y")).ok).toBe(false);
    expect(acceptNote([note("big", "x".repeat(ASSISTANT_ACCOUNT_LIMIT))], null, note("more", "y")).ok).toBe(false);
  });

  it("keeps one handoff inside the shared size budget and copies without changing the source", () => {
    const source = note("a", "Desk fact.");
    Object.freeze(source);
    const copied = copyNote(source);
    copied.text = "changed";
    expect(source.text).toBe("Desk fact.");

    const handoff = { id: "h", text: "Bring the charger.", createdAt: "2026-09-28T01:00:00.000Z", sourceLabel: "Phone" };
    Object.freeze(handoff);
    expect(copyHandoff(handoff).sourceLabel).toBe("Phone");
    expect(acceptHandoff([note("a", "x".repeat(ASSISTANT_ACCOUNT_LIMIT))], null, handoff).ok).toBe(false);
    expect(acceptHandoff([], { ...handoff }, handoff).ok).toBe(false);
    expect(acceptHandoff([note("a", "short")], null, handoff)).toEqual({ ok: true });
  });

  it("puts every attached item in the turn context and drops a detached note", () => {
    const amber = note("a", "The launch code is amber.");
    const blue = note("b", "The backup code is blue.");
    const handoff = { id: "h", text: "Meet at the dock.", createdAt: "2026-09-28T01:00:00.000Z", sourceLabel: "Phone" };
    const both = accountContextText([amber, blue], handoff);
    expect(both).toContain("amber");
    expect(both).toContain("blue");
    expect(both).toContain("dock");
    const remaining = accountContextText([blue], null);
    expect(remaining).toContain("blue");
    expect(remaining).not.toContain("amber");
    expect(noteDetachedText(amber)).toContain("not active context");
    expect(noteDetachedText(amber)).not.toContain("launch code is amber");
  });
});
