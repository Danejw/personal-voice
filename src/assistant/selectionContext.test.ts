import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SELECTION_LIMIT,
  acceptSelection,
  selectionContextText,
  selectionDetachedText,
  selectionPreview,
} from "@/assistant/selectionContext";
import type { ContextItem } from "@/context/ContextItem";

function item(text: string, sourceApp?: string): ContextItem {
  return {
    type: "selection",
    text,
    ...(sourceApp ? { sourceApp } : {}),
    capturedAt: "2026-09-28T00:00:00.000Z",
  };
}

describe("assistant selection context", () => {
  it("keeps the source app with the exact text and a short preview", () => {
    const captured = item("Persyn are a application that help create content.", "Notes");
    expect(selectionContextText(captured)).toContain("Source app: Notes");
    expect(selectionContextText(captured)).toContain(captured.text);
    expect(selectionContextText(captured)).toContain("not the user's instruction");
    expect(selectionContextText(captured)).toContain("web search");
    expect(selectionContextText(item("hello"))).not.toContain("Source app");
    expect(selectionPreview(`${"word ".repeat(80)}end`)).toHaveLength(160);
    expect(selectionPreview("short")).toBe("short");
  });

  it("accepts a selection at the limit and refuses anything longer", () => {
    expect(acceptSelection(item("x".repeat(ASSISTANT_SELECTION_LIMIT))).ok).toBe(true);
    const rejected = acceptSelection(item("x".repeat(ASSISTANT_SELECTION_LIMIT + 1)));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).toContain("shorter passage");
  });

  it("tells a later turn that a removed selection is not active context", () => {
    expect(selectionDetachedText()).toContain("not active context");
  });
});
