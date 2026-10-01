import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECALL_NOTE_PAGE,
  classifyRecall,
  formatRecallHits,
  recallSourceEnabled,
  selectRecall,
  type RecallCandidate,
  type RecallPermissions,
} from "@/assistant/recall";

const ACCOUNT = "account-a";
const OTHER = "account-b";

const OPEN: RecallPermissions = { notes: true, dictations: true, cloudDictations: true };

function row(patch: Partial<RecallCandidate> & Pick<RecallCandidate, "source" | "id" | "text" | "at">): RecallCandidate {
  return {
    account: patch.account ?? ACCOUNT,
    source: patch.source,
    id: patch.id,
    text: patch.text,
    at: patch.at,
    conversationId: patch.conversationId ?? null,
    archived: patch.archived ?? false,
    deleted: patch.deleted ?? false,
    forgotten: patch.forgotten ?? false,
  };
}

/** Twelve newer notes, then one older note past that page. */
function notePage(): RecallCandidate[] {
  const recent = Array.from({ length: RECALL_NOTE_PAGE }, (_, index) => row({
    source: "note",
    id: `note-${index + 1}`,
    text: `Buy milk number ${index + 1}.`,
    at: `2026-09-${String(30 - index).padStart(2, "0")}T12:00:00.000Z`,
  }));
  return [
    ...recent,
    row({
      source: "note",
      id: "note-13",
      text: "The greenhouse glass order is for Friday.",
      at: "2026-01-02T12:00:00.000Z",
    }),
  ];
}

const corpus: RecallCandidate[] = [
  ...notePage(),
  row({
    source: "dictation",
    id: "dict-old",
    text: "Remind me the greenhouse needs water.",
    at: "2025-11-01T12:00:00.000Z",
  }),
  row({
    source: "conversation",
    id: "msg-south",
    conversationId: "conv-1",
    text: "We decided the greenhouse faces south.",
    at: "2026-06-01T12:00:00.000Z",
  }),
  row({
    source: "conversation",
    id: "msg-north",
    conversationId: "conv-1",
    text: "The greenhouse faces north.",
    at: "2026-03-01T12:00:00.000Z",
  }),
  row({
    source: "note",
    id: "note-archived",
    text: "Archived greenhouse sketch.",
    at: "2026-02-01T12:00:00.000Z",
    archived: true,
  }),
  row({
    source: "note",
    id: "note-deleted",
    text: "Deleted greenhouse plan.",
    at: "2026-02-02T12:00:00.000Z",
    deleted: true,
  }),
  row({
    source: "memory",
    id: "mem-active",
    text: "Prefer short answers.",
    at: "2026-08-01T12:00:00.000Z",
  }),
  row({
    source: "memory",
    id: "mem-forgotten",
    text: "Prefer short answers from an old guess.",
    at: "2026-07-01T12:00:00.000Z",
    forgotten: true,
  }),
  row({
    source: "note",
    id: "note-other",
    account: OTHER,
    text: "The other account greenhouse secret.",
    at: "2026-08-02T12:00:00.000Z",
  }),
  row({
    source: "conversation",
    id: "msg-project",
    conversationId: "conv-2",
    text: "The project greenhouse is still open.",
    at: "2026-05-01T12:00:00.000Z",
  }),
];

function found(query: string, permissions: RecallPermissions = OPEN, includeArchived = false) {
  return selectRecall(corpus, query, { account: ACCOUNT, includeArchived, permissions });
}

describe("saved material retrieval", () => {
  it("finds a note past the first page, an old dictation, and a prior conversation", () => {
    expect(found("greenhouse").hits.map((hit) => hit.id)).toContain("note-13");
    expect(found("greenhouse").hits.map((hit) => hit.id)).not.toContain("note-1");
    expect(found("greenhouse water").hits.map((hit) => hit.id)).toEqual(["dict-old"]);
    expect(found("greenhouse south").hits.map((hit) => hit.id)).toEqual(["msg-south"]);
    expect(found("projects").hits.map((hit) => hit.id)).toEqual(["msg-project"]);
  });

  it("asks which line when two mentions match equally, and invents nothing when none do", () => {
    const both = found("greenhouse faces");
    expect(both.kind).toBe("ambiguous");
    expect(both.hits.map((hit) => hit.id)).toEqual(["msg-south", "msg-north"]);
    expect(formatRecallHits("greenhouse faces", both)).toContain("Ask which one");
    expect(formatRecallHits("greenhouse faces", both)).toContain("conversation:conv-1/message:msg-south");
    const missing = found("submarine");
    expect(missing).toEqual({ kind: "none", hits: [] });
    expect(formatRecallHits("submarine", missing)).toContain("Do not invent a recollection");
    expect(formatRecallHits("what did I say", found("what did I say"))).toContain("Name a word");
  });

  it("drops the other account, disabled sources, archives, deletions, and forgotten memories", () => {
    expect(recallSourceEnabled("dictation", { notes: true, dictations: true, cloudDictations: false })).toBe(false);
    expect(recallSourceEnabled("note", { notes: false, dictations: true, cloudDictations: true })).toBe(false);
    expect(found("greenhouse", { notes: false, dictations: true, cloudDictations: true }).hits.some((hit) => hit.source === "note")).toBe(false);
    expect(found("greenhouse", { notes: true, dictations: false, cloudDictations: true }).hits.some((hit) => hit.id === "dict-old")).toBe(false);
    expect(found("greenhouse", { notes: true, dictations: true, cloudDictations: false }).hits.some((hit) => hit.id === "dict-old")).toBe(false);
    expect(found("greenhouse").hits.map((hit) => hit.id)).not.toContain("note-archived");
    expect(found("greenhouse", OPEN, true).hits.map((hit) => hit.id)).toContain("note-archived");
    expect(found("greenhouse").hits.map((hit) => hit.id)).not.toContain("note-deleted");
    expect(found("greenhouse").hits.map((hit) => hit.id)).not.toContain("note-other");
    const remembered = found("short answers");
    expect(remembered.hits.map((hit) => hit.id)).toEqual(["mem-active"]);
    expect(formatRecallHits("short answers", remembered)).toContain("does not remember it");
  });

  it("treats a deleted row as gone and does not treat glasshouse as greenhouse", () => {
    const kept = corpus.filter((item) => item.id !== "note-13" && item.id !== "dict-old" && item.id !== "msg-south" && item.id !== "msg-north" && item.id !== "note-archived" && item.id !== "msg-project");
    expect(selectRecall(kept, "greenhouse", { account: ACCOUNT, includeArchived: false, permissions: OPEN }).hits).toEqual([]);
    expect(found("glasshouse")).toEqual({ kind: "none", hits: [] });
    expect(classifyRecall([
      { rank: 30, snippet: "south" },
      { rank: 28, snippet: "north" },
    ])).toBe("ambiguous");
  });

  it("keeps the migration on full-text search of the owned rows", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20260930250000_assistant_recall.sql", import.meta.url), "utf8");
    expect(sql).toContain("to_tsvector('english'");
    expect(sql).toContain("plainto_tsquery");
    expect(sql).toContain("assistant_require_account");
    expect(sql).toContain("assistant_recall_notes");
    expect(sql).toContain("assistant_recall_dictations");
    expect(sql).toContain("cloud_dictation_history");
    expect(sql).toContain("deleted_at is null");
    expect(sql).toContain("status = 'inbox'");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("limit 5");
    expect(sql).not.toContain("limit 12");
    expect(sql).not.toContain("limit 75");
    expect(sql).not.toContain("assistant_recall_cache");
    expect(sql).not.toContain("insert into public.assistant_memories");
    expect(sql).not.toMatch(/update\s+public\.settings/i);
    expect(sql).not.toContain("cloud_dictation_history boolean not null default true");
  });
});
