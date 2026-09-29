import { describe, expect, it } from "vitest";
import { countOutputWords, countTermUses, wordTokens } from "@/usage/words";
import type { WordSegmenter } from "@/usage/words";

const cjk: WordSegmenter = {
  segment(text: string) {
    return [...text].map((segment) => ({ segment, isWordLike: true }));
  },
};

const underscore: WordSegmenter = {
  segment(text: string) {
    if (!text.includes("_")) return [{ segment: text, isWordLike: true }];
    return [
      { segment: "user", isWordLike: true },
      { segment: "_", isWordLike: false },
      { segment: "id", isWordLike: true },
    ];
  },
};

describe("word tokens", () => {
  it("counts a CJK string as several words when a segmenter is present", () => {
    const text = "こんにちは世界";
    expect(countOutputWords(text, "ja", null)).toBe(1);
    expect(countOutputWords(text, "ja", cjk)).toBe(text.length);
  });

  it("keeps underscores inside a token", () => {
    expect(wordTokens("user_id", "en", null)).toEqual(["user_id"]);
    expect(wordTokens("user_id", "en", underscore)).toEqual(["user_id"]);
  });
});

describe("dictionary uses", () => {
  it("counts each appearance, including phrases, case, and punctuation", () => {
    expect(countTermUses("I worked on Persyn and then deployed Persyn", ["Persyn"], "en", null)).toEqual({ persyn: 2 });
    expect(countTermUses("Persyn,", ["persyn"], "en", null)).toEqual({ persyn: 1 });
    expect(countTermUses("Please open Sea Dance.", ["Sea Dance"], "en", null)).toEqual({ "sea dance": 1 });
  });

  it("does not match a term inside another word or across an underscore", () => {
    expect(countTermUses("email the AI tool", ["AI"], "en", null)).toEqual({ ai: 1 });
    expect(countTermUses("email", ["AI"], "en", null)).toEqual({});
    expect(countTermUses("AItool", ["AI"], "en", null)).toEqual({});
    expect(countTermUses("user_id", ["user"], "en", underscore)).toEqual({});
    expect(countTermUses("user_id", ["id"], "en", null)).toEqual({});
  });
});
