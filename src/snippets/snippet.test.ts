import { describe, expect, it } from "vitest";
import { normalizeSnippetTrigger, resolveSnippet, snippetProblem, type Snippet } from "@/snippets/snippet";

const snippets: Snippet[] = [{
  id: "read-only",
  trigger: "read only mode",
  normalizedTrigger: "read only mode",
  content: "Investigate only. Do not make changes.",
  enabled: true,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
}];

describe("snippet trigger normalization", () => {
  it("ignores case, repeated whitespace, and trailing sentence punctuation", () => {
    expect(normalizeSnippetTrigger("  Read   Only Mode.  ")).toBe("read only mode");
    expect(normalizeSnippetTrigger("MY LINKEDIN!")).toBe("my linkedin");
  });

  it("validates trigger and content", () => {
    expect(snippetProblem("", "text")).toBe("Give the snippet a voice trigger.");
    expect(snippetProblem("...", "text")).toBe("The trigger needs at least one word or character.");
    expect(snippetProblem("my LinkedIn", "")).toBe("Add the text this snippet should expand to.");
    expect(snippetProblem("my LinkedIn", "https://example.com")).toBeNull();
  });
});

describe("resolveSnippet", () => {
  it("expands an exact whole-utterance match", () => {
    expect(resolveSnippet("Read only mode.", snippets)).toEqual({
      matched: true,
      text: "Investigate only. Do not make changes.",
      snippetId: "read-only",
    });
  });

  it("does not expand a trigger embedded in a longer sentence", () => {
    expect(resolveSnippet("please use read only mode", snippets)).toEqual({
      matched: false,
      text: "please use read only mode",
    });
  });

  it("ignores disabled snippets", () => {
    expect(resolveSnippet("read only mode", [{ ...snippets[0]!, enabled: false }]).matched).toBe(false);
  });
});
