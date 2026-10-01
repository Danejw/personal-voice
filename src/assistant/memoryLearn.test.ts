import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { memoryInjection, type AssistantMemory } from "@/assistant/memory";
import { TEXT_ACTION_MODEL } from "@/text/modelOutput";
import {
  EXTRACTOR_VERSION,
  LEARN_REJECT_MARKERS,
  classifyTurn,
  filterModelSpan,
  planLearningCommit,
  type LearningProposal,
} from "@/assistant/memoryLearn";

const short = classifyTurn("I prefer short answers.")[0];

function commit(patch: Partial<Parameters<typeof planLearningCommit>[0]> = {}) {
  return planLearningCommit({
    learning: true,
    conversationDeleted: false,
    alreadyJobbed: false,
    forgottenKey: false,
    active: null,
    proposal: short ?? null,
    ...patch,
  });
}

describe("memory learning fixtures", () => {
  it("learns a clear preference once and leaves quotes, drafts, and other people out", () => {
    expect(short).toMatchObject({ key: "answer_length", value: "Prefer short answers.", disposition: "active", confidence: "high" });
    expect(classifyTurn("Thanks. I prefer short answers.")).toEqual([short]);
    expect(classifyTurn("She said I prefer short answers.")).toEqual([]);
    expect(classifyTurn("Draft: I prefer short answers.")).toEqual([]);
    expect(classifyTurn("If I preferred short answers, the post would be tighter.")).toEqual([]);
    expect(classifyTurn("Please email Sam that I prefer short answers.")).toEqual([]);
    expect(classifyTurn("Bob prefers short answers.")).toEqual([]);
    expect(classifyTurn('He said "I prefer short answers."')).toEqual([]);
    expect(classifyTurn("I think I might prefer short answers.")[0]).toMatchObject({ disposition: "candidate", confidence: "low" });
    expect(classifyTurn("I prefer tea.")[0]).toMatchObject({ disposition: "candidate", key: "prefer_tea" });
    expect(classifyTurn("My name is Ada.")[0]).toMatchObject({ key: "name", value: "Ada", category: "fact", disposition: "active" });
    expect(classifyTurn("I'm working on the greenhouse.")[0]).toMatchObject({ key: "project_greenhouse", category: "project", disposition: "active" });
  });

  it("drops a model span the turn does not support, and keeps one the rules already allow", () => {
    expect(filterModelSpan("She said I prefer short answers.", "I prefer short answers.")).toBeNull();
    expect(filterModelSpan("Thanks. I prefer short answers.", "I prefer pineapple on everything.")).toBeNull();
    expect(filterModelSpan("Thanks. I prefer short answers.", "I prefer short answers.")).toMatchObject({ disposition: "active", key: "answer_length" });
  });

  it("does not duplicate, resurrect, or overwrite an explicit edit", () => {
    expect(commit()).toEqual({ action: "activate", reason: "clear" });
    expect(commit({ learning: false })).toEqual({ action: "skip", reason: "off" });
    expect(commit({ conversationDeleted: true })).toEqual({ action: "skip", reason: "deleted" });
    expect(commit({ alreadyJobbed: true })).toEqual({ action: "skip", reason: "jobbed" });
    expect(commit({ forgottenKey: true })).toEqual({ action: "skip", reason: "forgotten" });
    expect(commit({ active: { origin: "extracted", value: "Prefer short answers." } })).toEqual({ action: "skip", reason: "same" });
    expect(commit({ active: { origin: "explicit", value: "Prefer detailed answers." } })).toEqual({ action: "candidate", reason: "explicit-wins" });
    expect(commit({
      active: { origin: "extracted", value: "Prefer short answers." },
      proposal: { ...(short as LearningProposal), value: "Prefer detailed answers.", evidence: "I prefer detailed answers." },
    })).toEqual({ action: "replace-extracted", reason: "clear" });
    expect(commit({ proposal: null })).toEqual({ action: "skip", reason: "empty" });
  });

  it("does not inject a candidate or a forgotten preference", () => {
    const row = (status: AssistantMemory["status"], value: string): AssistantMemory => ({
      id: "00000000-0000-4000-8000-000000000010",
      kind: "preference",
      key: "answer_length",
      value,
      scope: "account",
      status,
      origin: "extracted",
      sourceConversationId: null,
      sourceMessageId: null,
      supersedesId: null,
      revision: 1,
      createdAt: "2026-09-30T12:00:00.000Z",
      updatedAt: "2026-09-30T12:00:00.000Z",
      forgottenAt: status === "forgotten" ? "2026-09-30T12:00:00.000Z" : null,
    });
    expect(memoryInjection([row("candidate", "Prefer short answers.")]).text).toBeNull();
    expect(memoryInjection([row("forgotten", "Prefer short answers.")]).text).toBeNull();
    expect(memoryInjection([row("active", "Prefer short answers.")]).text).toContain("Prefer short answers.");
  });

  it("keeps the migration copy of the reject markers and the extractor version", async () => {
    const sql = await readFileSync(new URL("../../supabase/migrations/20260930240000_assistant_memory_learning.sql", import.meta.url), "utf8");
    for (const marker of LEARN_REJECT_MARKERS) expect(sql).toContain(marker);
    expect(sql).toContain(EXTRACTOR_VERSION);
    expect(sql).toContain("i prefer short answers");
    expect(sql).not.toContain("voice_notes");
    expect(sql).not.toContain("dictations");
  });

  it("keeps the edge function copy of the extractor and the text model", () => {
    const source = readFileSync(new URL("./memoryLearn.ts", import.meta.url), "utf8");
    const deployed = readFileSync(new URL("../../supabase/functions/memory-learn/memoryLearn.ts", import.meta.url), "utf8");
    const functionSource = readFileSync(new URL("../../supabase/functions/memory-learn/index.ts", import.meta.url), "utf8");
    expect(deployed).toBe(source);
    expect(functionSource).toContain(TEXT_ACTION_MODEL);
    expect(functionSource).toContain('from "./memoryLearn.ts"');
    expect(deployed).toContain(EXTRACTOR_VERSION);
  });
});
