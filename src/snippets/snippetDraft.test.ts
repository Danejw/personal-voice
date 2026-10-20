import { describe, expect, it } from "vitest";
import { resolveSnippet, slashToken, snippetFromStored, type Snippet } from "@/snippets/snippet";
import {
  applyInlineSnippetReferences,
  draftPlainText,
  editDraft,
  expandSnippetDraft,
  parseSnippetDraft,
  serializeSnippetDraft,
  spliceDraft,
} from "@/snippets/snippetDraft";

function snippet(fields: {
  id: string;
  trigger: string;
  triggers?: string[];
  content: string;
  enabled?: boolean;
}): Snippet {
  const stored = snippetFromStored({
    id: fields.id,
    trigger: fields.trigger,
    triggers: fields.triggers,
    content: fields.content,
    enabled: fields.enabled ?? true,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  });
  if (!stored) throw new Error("invalid test snippet");
  return stored;
}

const topload = snippet({
  id: "snippet-topload",
  trigger: "top load, top-load, topload",
  triggers: ["top load", "top-load", "topload"],
  content: "Use the top-load instructions.",
});

const readOnly = snippet({
  id: "snippet-read-only",
  trigger: "read only mode",
  content: "Investigate only. Do not make changes.",
});

describe("inline snippet references", () => {
  it("replaces a spoken trigger and keeps the surrounding sentence", () => {
    for (const heard of [
      "Investigate the vendor matching system, topload",
      "Investigate the vendor matching system, top load",
      "Investigate the vendor matching system, top-load",
    ]) {
      const parts = applyInlineSnippetReferences(heard, [topload, readOnly]);
      expect(draftPlainText(parts, [topload, readOnly])).toBe("Investigate the vendor matching system @topload");
      expect(parts.filter((part) => part.kind === "snippet").map((part) => part.kind === "snippet" ? part.id : "")).toEqual(["snippet-topload"]);
    }
  });

  it("keeps several references in order and does not match a longer word", () => {
    const parts = applyInlineSnippetReferences("Check topload then read only mode. Not toploading.", [topload, readOnly]);
    expect(draftPlainText(parts, [topload, readOnly])).toBe("Check @topload then @readonlymode. Not toploading.");
    const expanded = expandSnippetDraft(parts, [topload, readOnly]);
    expect(expanded).toEqual({
      ok: true,
      text: "Check Use the top-load instructions. then Investigate only. Do not make changes.. Not toploading.",
    });
  });

  it("leaves an ambiguous trigger as ordinary text", () => {
    const other = snippet({ id: "other", trigger: "topload", content: "Wrong." });
    const heard = "Investigate the vendor matching system, topload";
    expect(draftPlainText(applyInlineSnippetReferences(heard, [topload, other]), [topload, other])).toBe(heard);
  });

  it("inserts the slash-command choice as the same reference", () => {
    const typed = "Investigate the vendor matching system /topload";
    const parts = [{ kind: "text" as const, text: typed }];
    const caret = typed.length;
    const token = slashToken(draftPlainText(parts, [topload]), caret);
    expect(token?.query).toBe("topload");
    const next = spliceDraft(
      parts,
      token!.start,
      caret,
      [{ kind: "snippet", id: topload.id, label: topload.slug }],
      [topload],
    );
    expect(draftPlainText(next.parts, [topload])).toBe("Investigate the vendor matching system @topload");
  });

  it("removes a reference with Backspace or Delete and keeps the other text", () => {
    const parts = applyInlineSnippetReferences("Hello topload there", [topload]);
    const plain = draftPlainText(parts, [topload]);
    const chipAt = plain.indexOf("@");
    const removed = editDraft(parts, chipAt + "@topload".length, "backspace", [topload]);
    expect(removed && draftPlainText(removed.parts, [topload])).toBe("Hello  there");
    const deleted = editDraft(parts, chipAt, "delete", [topload]);
    expect(deleted && draftPlainText(deleted.parts, [topload])).toBe("Hello  there");
    expect(editDraft(parts, 1, "backspace", [topload])).toBeNull();
  });

  it("survives multiline editing and draft persistence", () => {
    const parts = spliceDraft(
      [{ kind: "text", text: "Line one\nLine two " }],
      "Line one\nLine two ".length,
      "Line one\nLine two ".length,
      applyInlineSnippetReferences("topload", [topload]),
      [topload],
    ).parts;
    expect(parseSnippetDraft(serializeSnippetDraft(parts))).toEqual(parts);
    expect(draftPlainText(parts, [topload])).toBe("Line one\nLine two @topload");
  });

  it("expands by snippet id after the trigger is renamed", () => {
    const parts = applyInlineSnippetReferences("Please topload", [topload]);
    const renamed = snippet({
      id: topload.id,
      trigger: "vendor load",
      content: "Updated top-load instructions.",
    });
    expect(draftPlainText(parts, [renamed])).toBe("Please @vendorload");
    expect(expandSnippetDraft(parts, [renamed])).toEqual({
      ok: true,
      text: "Please Updated top-load instructions.",
    });
  });

  it("does not send instructions for a deleted snippet", () => {
    const parts = applyInlineSnippetReferences("Please topload", [topload]);
    const expanded = expandSnippetDraft(parts, []);
    expect(expanded.ok).toBe(false);
    if (!expanded.ok) expect(expanded.message).toMatch(/@topload/);
  });

  it("still expands a whole utterance for another application and leaves a sentence alone", () => {
    expect(resolveSnippet("topload", [topload])).toEqual({
      matched: true,
      text: topload.content,
      snippetId: topload.id,
    });
    expect(resolveSnippet("Investigate the vendor matching system, topload", [topload]).matched).toBe(false);
  });
});
