import { describe, expect, it } from "vitest";
import {
  MEMORY_INJECT_CHARS,
  MEMORY_INJECT_COUNT,
  memoryInjection,
  memorySuppressed,
  planMemoryForget,
  planMemoryWrite,
  prepareMemoryKey,
  prepareMemoryValue,
  type AssistantMemory,
} from "@/assistant/memory";

function row(patch: Partial<AssistantMemory> & Pick<AssistantMemory, "key" | "value" | "status">): AssistantMemory {
  return {
    id: patch.id ?? `00000000-0000-4000-8000-${patch.key.padEnd(12, "0").slice(0, 12)}`,
    kind: patch.kind ?? "preference",
    key: patch.key,
    value: patch.value,
    scope: "account",
    status: patch.status,
    origin: patch.origin ?? "explicit",
    sourceConversationId: patch.sourceConversationId ?? null,
    sourceMessageId: patch.sourceMessageId ?? null,
    supersedesId: patch.supersedesId ?? null,
    revision: patch.revision ?? 1,
    createdAt: patch.createdAt ?? "2026-09-30T12:00:00.000Z",
    updatedAt: patch.updatedAt ?? "2026-09-30T12:00:00.000Z",
    forgottenAt: patch.forgottenAt ?? null,
  };
}

describe("explicit memory", () => {
  it("normalizes a spoken key and refuses a blank or oversized value", () => {
    expect(prepareMemoryKey("Answer length")).toEqual({ key: "answer_length" });
    expect(prepareMemoryKey("answer_length")).toEqual({ key: "answer_length" });
    expect(prepareMemoryKey("9bad")).toEqual({ error: "Use a short key such as answer_length." });
    expect(prepareMemoryValue("  Prefer short answers.  ")).toEqual({ value: "Prefer short answers." });
    expect(prepareMemoryValue("   ")).toEqual({ error: "Say what to remember." });
    expect("error" in prepareMemoryValue("x".repeat(501))).toBe(true);
  });

  it("lets an explicit correction replace a guess and rejects a second remember", () => {
    const guess = row({ key: "answer_length", value: "Long answers.", status: "active", origin: "extracted", revision: 2 });
    expect(planMemoryWrite(null, "remember", null)).toEqual({ ok: true, supersede: false });
    expect(planMemoryWrite(guess, "remember", 2)).toEqual({ ok: true, supersede: true });
    expect(planMemoryWrite(guess, "remember", 1)).toEqual({ ok: false, reason: "conflict" });
    const taught = row({ key: "answer_length", value: "Prefer short answers.", status: "active", revision: 3 });
    expect(planMemoryWrite(taught, "remember", null)).toEqual({ ok: false, reason: "exists" });
    expect(planMemoryWrite(taught, "change", 3)).toEqual({ ok: true, supersede: true });
    expect(planMemoryWrite(taught, "change", 2)).toEqual({ ok: false, reason: "conflict" });
    expect(planMemoryWrite(null, "change", 1)).toEqual({ ok: false, reason: "missing" });
  });

  it("forgets only the revision that was read", () => {
    const taught = row({ key: "answer_length", value: "Prefer short answers.", status: "active", revision: 3 });
    expect(planMemoryForget(taught, 3)).toEqual({ ok: true });
    expect(planMemoryForget(taught, 4)).toEqual({ ok: false, reason: "conflict" });
    expect(planMemoryForget(null, 3)).toEqual({ ok: false, reason: "missing" });
  });

  it("keeps a forgotten source blocked after a later explicit remember", () => {
    const source = "11111111-1111-4111-8111-111111111111";
    const rows = [
      row({
        key: "answer_length",
        value: "Prefer short answers.",
        status: "forgotten",
        sourceConversationId: source,
        forgottenAt: "2026-09-30T12:00:00.000Z",
        revision: 2,
      }),
      row({
        key: "answer_length",
        value: "Prefer short answers again.",
        status: "active",
        sourceConversationId: "22222222-2222-4222-8222-222222222222",
        revision: 1,
      }),
    ];
    expect(memorySuppressed(rows, "answer_length", source)).toBe(true);
    expect(memorySuppressed(rows, "answer_length", "22222222-2222-4222-8222-222222222222")).toBe(false);
  });

  it("injects active explicit memories once, inside the budget, and drops forgotten text", () => {
    const rows = [
      row({ key: "answer_length", value: "Prefer short answers.", status: "active", revision: 4 }),
      row({ key: "answer_length", value: "Long answers.", status: "active", origin: "extracted", revision: 1 }),
      row({
        key: "city",
        value: "Lives in Hilo.",
        status: "forgotten",
        kind: "fact",
        forgottenAt: "2026-09-30T12:00:00.000Z",
      }),
      ...Array.from({ length: 10 }, (_, index) => row({
        key: `extra_${index}`,
        value: "y".repeat(400),
        status: "active",
      })),
    ];
    const injected = memoryInjection(rows);
    expect(injected.text).toContain("answer_length (preference, explicit): Prefer short answers.");
    expect(injected.text).not.toContain("Long answers.");
    expect(injected.text).not.toContain("Hilo");
    expect(injected.text).toContain("Some memories did not fit");
    expect(injected.included.length).toBeLessThanOrEqual(MEMORY_INJECT_COUNT);
    expect(injected.text?.length ?? 0).toBeLessThanOrEqual(MEMORY_INJECT_CHARS + 80);
    expect(injected.fingerprint).toContain("answer_length:4:Prefer short answers.");
    expect(memoryInjection(rows).fingerprint).toBe(injected.fingerprint);
    expect(memoryInjection([]).text).toBeNull();
    expect(memoryInjection([]).fingerprint).toBe("none");
  });
});
