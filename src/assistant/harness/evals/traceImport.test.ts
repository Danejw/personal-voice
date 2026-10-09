import { describe, expect, it } from "vitest";
import { parseEvalTraces } from "@/assistant/harness/evals/traceImport";
import { evaluateBatch } from "@/assistant/harness/evals/evaluate";
import { SCRIPTED_REGRESSION_CORPUS } from "@/assistant/harness/evals/mockCorpus";

describe("privacy-safe trace JSON import", () => {
  it("accepts exported tool-only traces without changing what they measure", () => {
    const imported = parseEvalTraces(JSON.parse(JSON.stringify(SCRIPTED_REGRESSION_CORPUS)));
    expect(imported).toHaveLength(13);
    expect(evaluateBatch(imported).overall.passedPaths).toBe(9);
  });

  it("rejects personal content, malformed statuses, fabricated observations and unbounded data", () => {
    const original = SCRIPTED_REGRESSION_CORPUS[0]!;
    expect(() => parseEvalTraces([{ ...original, prompt: "secret private user message" }])).toThrow("Unexpected field");
    expect(() => parseEvalTraces([{ ...original, attempts: [{ ...original.attempts[0], args: { text: "secret" } }] }])).toThrow("Unexpected field");
    expect(() => parseEvalTraces([{ ...original, attempts: [{ ...original.attempts[0], status: "guess" }] }])).toThrow("Invalid tool attempt");
    expect(() => parseEvalTraces([{ ...original, goal: { source: "unverified", passed: true } }])).toThrow();
    expect(() => parseEvalTraces(Array.from({ length: 257 }, () => original))).toThrow("up to 256");
    expect(() => parseEvalTraces([{ ...original, attempts: Array.from({ length: 65 }, () => original.attempts[0]) }])).toThrow("Invalid tool attempt count");
  });
});
