import { describe, expect, it } from "vitest";
import {
  acceptDictatedText,
  consumeSnippetReferenceAcceptance,
  registerSnippetInput,
} from "@/snippets/snippetInput";
import {
  compactSnippetTrigger,
  expandSnippetReferences,
  formatSnippetTriggers,
  matchSnippet,
  normalizeSnippetTrigger,
  parseSnippetTriggers,
  referenceForUtterance,
  resolveSnippet,
  slashToken,
  snippetFromStored,
  snippetProblem,
  snippetReference,
  snippetSuggestions,
  snippetTriggerConflict,
  type Snippet,
} from "@/snippets/snippet";

function snippet(fields: {
  id?: string;
  trigger: string;
  triggers?: string[];
  content?: string;
  enabled?: boolean;
}): Snippet {
  const stored = snippetFromStored({
    id: fields.id ?? "snippet",
    trigger: fields.trigger,
    triggers: fields.triggers,
    content: fields.content ?? "Expanded text",
    enabled: fields.enabled ?? true,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  });
  if (!stored) throw new Error("invalid test snippet");
  return stored;
}

const readOnly = snippet({
  id: "read-only",
  trigger: "read only mode",
  content: "Investigate only. Do not make changes.",
});

const topload = snippet({
  id: "topload",
  trigger: "top load, top-load, topload",
  triggers: ["top load", "top-load", "topload"],
  content: "Use the top-load instructions.",
});

describe("snippet trigger normalization", () => {
  it("ignores case, repeated whitespace, and trailing sentence punctuation", () => {
    expect(normalizeSnippetTrigger("  Read   Only Mode.  ")).toBe("read only mode");
    expect(normalizeSnippetTrigger("MY LINKEDIN!")).toBe("my linkedin");
  });

  it("treats hyphenated, spaced, and joined words as the same phrase", () => {
    expect(compactSnippetTrigger("Top Load.")).toBe("topload");
    expect(compactSnippetTrigger("top-load")).toBe("topload");
    expect(compactSnippetTrigger("top load")).toBe("topload");
    expect(compactSnippetTrigger("read only mode")).toBe("readonlymode");
    expect(compactSnippetTrigger("read only")).not.toBe("readonlymode");
    expect(compactSnippetTrigger("it's")).toBe("it's");
  });

  it("parses comma-separated triggers without dropping distinct phrases", () => {
    expect(parseSnippetTriggers(" top load, top-load, topload, , Top Load ")).toEqual([
      "top load",
      "top-load",
      "topload",
    ]);
    expect(formatSnippetTriggers(parseSnippetTriggers("top load, top-load, topload"))).toBe(
      "top load, top-load, topload",
    );
  });

  it("keeps a legacy single trigger intact, including a comma", () => {
    expect(snippet({ trigger: "hello, world" }).triggers).toEqual(["hello, world"]);
  });

  it("validates trigger and content", () => {
    expect(snippetProblem("", "text")).toBe("Give the snippet a voice trigger.");
    expect(snippetProblem("...", "text")).toBe("The trigger needs at least one word or character.");
    expect(snippetProblem("my LinkedIn", "")).toBe("Add the text this snippet should expand to.");
    expect(snippetProblem("top load, top-load, topload", "Use the top-load instructions.")).toBeNull();
  });
});

describe("resolveSnippet", () => {
  it("expands an exact whole-utterance match", () => {
    expect(resolveSnippet("Read only mode.", [readOnly])).toEqual({
      matched: true,
      text: "Investigate only. Do not make changes.",
      snippetId: "read-only",
    });
  });

  it("resolves every configured trigger to the same snippet and reference", () => {
    expect(topload.slug).toBe("topload");
    expect(snippetReference(topload)).toBe("@topload");
    for (const heard of ["top load", "Top-load.", "TOPLOAD", "top   load"]) {
      expect(referenceForUtterance(heard, [topload])).toBe("@topload");
      expect(resolveSnippet(heard, [topload])).toEqual({
        matched: true,
        text: "Use the top-load instructions.",
        snippetId: "topload",
      });
    }
  });

  it("does not expand a trigger embedded in a longer sentence", () => {
    expect(resolveSnippet("please use read only mode", [readOnly])).toEqual({
      matched: false,
      text: "please use read only mode",
    });
    expect(resolveSnippet("please topload now", [topload]).matched).toBe(false);
  });

  it("ignores disabled snippets", () => {
    expect(resolveSnippet("read only mode", [{ ...readOnly, enabled: false }]).matched).toBe(false);
    expect(referenceForUtterance("topload", [{ ...topload, enabled: false }])).toBeNull();
  });

  it("does not choose when two snippets share an equivalent trigger", () => {
    const other = snippet({ id: "other", trigger: "topload", content: "Wrong snippet." });
    expect(matchSnippet("top load", [topload, other])).toEqual({ kind: "ambiguous" });
    expect(resolveSnippet("top-load", [topload, other])).toEqual({
      matched: false,
      text: "top-load",
    });
  });
});

describe("snippet conflicts and references", () => {
  it("reports an equivalent trigger on another snippet", () => {
    expect(snippetTriggerConflict(["topload"], [topload])).toMatch(/already used/);
    expect(snippetTriggerConflict(["top-load"], [topload], "topload")).toBeNull();
    expect(snippetTriggerConflict(["email me", "my email"], [topload])).toBeNull();
  });

  it("expands a compact reference and leaves lookalikes alone", () => {
    const text = "Please follow @topload and not @toploading.";
    expect(expandSnippetReferences(text, [topload])).toBe(
      "Please follow Use the top-load instructions. and not @toploading.",
    );
    expect(expandSnippetReferences("@Topload", [topload])).toBe("Use the top-load instructions.");
    expect(expandSnippetReferences("@topload", [{ ...topload, enabled: false }])).toBe("@topload");
  });

  it("leaves a reference untouched when two snippets share its slug", () => {
    const other = snippet({ id: "other", trigger: "it's", content: "Other." });
    const collided = { ...other, slug: "topload" };
    expect(expandSnippetReferences("@topload", [topload, collided])).toBe("@topload");
  });

  it("suggests snippets from a slash command", () => {
    expect(slashToken("use /top", 8)).toEqual({ start: 4, query: "top" });
    expect(slashToken("hello", 5)).toBeNull();
    expect(snippetSuggestions("load", [topload, readOnly]).map((item) => item.id)).toEqual(["topload"]);
    expect(snippetSuggestions("", [topload, { ...readOnly, enabled: false }]).map((item) => item.id)).toEqual(["topload"]);
  });

  it("records a composer insertion only when the input accepts it", () => {
    expect(acceptDictatedText("topload")).toBe(false);
    const stop = registerSnippetInput(() => true);
    expect(acceptDictatedText("Investigate the vendor matching system, topload")).toBe(true);
    expect(consumeSnippetReferenceAcceptance()).toBe(true);
    expect(consumeSnippetReferenceAcceptance()).toBe(false);
    stop();
    expect(acceptDictatedText("topload")).toBe(false);
  });
});
