import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { insightRequestBody, parseFinalInsight, parseGeminiJson } from "@/insights/insightsModel";

describe("Insights model boundary", () => {
  it("keeps the deployed parser identical to the tested copy", () => {
    const source = readFileSync(new URL("./insightsModel.ts", import.meta.url), "utf8");
    const deployed = readFileSync(new URL("../../supabase/functions/dictation-insights/model.ts", import.meta.url), "utf8");
    expect(deployed).toBe(source);
  });

  it("builds JSON-mode chunk and merge requests", () => {
    expect(insightRequestBody("chunk", "[1] hello").generationConfig).toMatchObject({ responseMimeType: "application/json" });
    expect(insightRequestBody("merge", "{}").generationConfig).toMatchObject({ responseMimeType: "application/json" });
  });

  it("parses fenced Gemini JSON and validates a profile", () => {
    const parsed = parseGeminiJson({
      candidates: [{ content: { parts: [{ text: "```json\n{\"voiceProfile\":\"Thinks aloud and refines constraints.\",\"catchphrases\":[],\"candidates\":[]}\n```" }] } }],
    });
    expect(parseFinalInsight(parsed).voiceProfile).toMatch(/refines constraints/);
  });
});
