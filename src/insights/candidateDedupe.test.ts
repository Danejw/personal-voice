import { describe, expect, it } from "vitest";
import { uniqueNewCandidates, type ProposedCandidate } from "@/insights/candidateDedupe";
import { snippetFromStored } from "@/snippets/snippet";
import { BUILT_IN_TRANSFORMS } from "@/transforms/transformProfile";

const readOnly = snippetFromStored({
  id: "s1",
  trigger: "read only mode",
  content: "Investigate only. Do not make changes.",
  enabled: true,
  createdAt: "",
  updatedAt: "",
});
const topload = snippetFromStored({
  id: "s2",
  trigger: "top load, top-load, topload",
  triggers: ["top load", "top-load", "topload"],
  content: "Use the top-load instructions.",
  enabled: true,
  createdAt: "",
  updatedAt: "",
});
if (!readOnly || !topload) throw new Error("invalid test snippet");

const base = {
  dictionary: [{ id: "1", term: "Supabase", enabled: true }],
  snippets: [readOnly],
  transforms: BUILT_IN_TRANSFORMS,
  memories: [],
  seenFingerprints: new Set<string>(),
};

describe("candidate dedupe", () => {
  it("suppresses things the user already has", () => {
    const candidates: ProposedCandidate[] = [
      { kind: "dictionary", title: "Supabase", payload: { term: "supabase" }, evidenceCount: 8, confidence: "high", reason: "used often" },
      { kind: "snippet", title: "Read only", payload: { trigger: "Read Only Mode.", content: "Investigate only." }, evidenceCount: 7, confidence: "high", reason: "repeated" },
      { kind: "transform", title: "Prompt Engineer", payload: { name: "Prompt Engineer", instruction: "Turn text into prompts." }, evidenceCount: 9, confidence: "high", reason: "repeated intent" },
    ];
    expect(uniqueNewCandidates(candidates, base)).toEqual([]);
  });

  it("treats an equivalent voice trigger as a snippet the user already has", () => {
    const candidates: ProposedCandidate[] = [{
      kind: "snippet",
      title: "Topload",
      payload: { trigger: "topload", content: "A different wording." },
      evidenceCount: 6,
      confidence: "high",
      reason: "repeated",
    }];
    expect(uniqueNewCandidates(candidates, { ...base, snippets: [topload] })).toEqual([]);
  });

  it("keeps a genuinely new suggestion", () => {
    const candidates: ProposedCandidate[] = [{
      kind: "dictionary", title: "SeaDance", payload: { term: "SeaDance" },
      evidenceCount: 11, confidence: "high", reason: "appears in many dictations",
    }];
    expect(uniqueNewCandidates(candidates, base)).toHaveLength(1);
  });
});
