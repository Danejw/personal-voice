import { describe, expect, it } from "vitest";
import { sourcesFromGrounding } from "@/assistant/grounding";

describe("grounding citations", () => {
  it("keeps http(s) pages, drops everything else, and uses the hostname when the title is missing", () => {
    expect(sourcesFromGrounding({
      groundingChunks: [
        { web: { uri: "https://example.com/a", title: " Example " } },
        { web: { uri: "http://example.com/b" } },
        { web: { uri: "ftp://example.com/c", title: "ftp" } },
        { web: { uri: "not a url", title: "nope" } },
        { retrievedContext: { uri: "https://example.com/private" } },
        { web: { title: "missing url" } },
      ],
    })).toEqual([
      { title: "Example", url: "https://example.com/a" },
      { title: "example.com", url: "http://example.com/b" },
    ]);
    expect(sourcesFromGrounding(null)).toEqual([]);
    expect(sourcesFromGrounding({ groundingChunks: "nope" })).toEqual([]);
    expect(sourcesFromGrounding({ searchEntryPoint: { renderedContent: "<b>widget</b>" } })).toEqual([]);
  });
});
