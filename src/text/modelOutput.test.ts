import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseModelOutput, textActionInputProblem, textActionRequestBody, MAX_TEXT_ACTION_CHARS } from "@/text/modelOutput";

describe("textActionInputProblem", () => {
  it("rejects an empty selection or instruction and oversized text", () => {
    expect(textActionInputProblem("  ", "shorter")).toBe("Capture a selection first.");
    expect(textActionInputProblem("hello", "  ")).toBe("Say what to do with the selection.");
    expect(textActionInputProblem("x".repeat(MAX_TEXT_ACTION_CHARS + 1), "shorter")).toMatch(/selection is too long/);
    expect(textActionInputProblem("hello", "x".repeat(MAX_TEXT_ACTION_CHARS + 1))).toMatch(/instruction is too long/);
    expect(textActionInputProblem("hello", "make this shorter")).toBeNull();
  });
});

describe("textActionRequestBody", () => {
  it("sends the instruction and selection as user text and does not name a model", () => {
    const body = textActionRequestBody("  Hello world  ", "  make this shorter  ");
    expect(body.contents[0]?.parts[0]?.text).toBe("Instruction:\nmake this shorter\n\nSelected text:\n  Hello world  ");
    expect(JSON.stringify(body)).not.toContain("gemini");
  });
});

describe("edge function copy", () => {
  it("matches the tested parser", () => {
    const source = readFileSync(new URL("./modelOutput.ts", import.meta.url), "utf8");
    const deployed = readFileSync(new URL("../../supabase/functions/text-action/modelOutput.ts", import.meta.url), "utf8");
    expect(deployed).toBe(source);
  });
});

describe("parseModelOutput", () => {
  it("returns the model's text and skips thought parts", () => {
    expect(parseModelOutput({
      candidates: [{ content: { parts: [{ thought: true, text: "planning" }, { text: "Shorter." }] } }],
    })).toBe("Shorter.");
  });

  it("treats a missing candidate or blank text as an empty rewrite", () => {
    expect(() => parseModelOutput(null)).toThrow("The rewrite was empty.");
    expect(() => parseModelOutput({})).toThrow("The rewrite was empty.");
    expect(() => parseModelOutput({ candidates: [] })).toThrow("The rewrite was empty.");
    expect(() => parseModelOutput({ candidates: [{ content: { parts: [{ text: "  " }] } }] })).toThrow("The rewrite was empty.");
  });
});
