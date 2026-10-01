import { describe, expect, it, vi } from "vitest";
import { AssistantMemoryStore } from "@/assistant/AssistantMemoryStore";
import type { AssistantMemory } from "@/assistant/memory";
import { AssistantMemoryError } from "@/services/assistantMemories";
import type { AssistantMemoriesApi } from "@/services/assistantMemoriesService";

const USER = "22222222-2222-4222-8222-222222222222";
const SOURCE = "11111111-1111-4111-8111-111111111111";

function memory(patch: Partial<AssistantMemory> & Pick<AssistantMemory, "key" | "value" | "status" | "revision">): AssistantMemory {
  return {
    id: patch.id ?? "00000000-0000-4000-8000-000000000010",
    kind: patch.kind ?? "preference",
    key: patch.key,
    value: patch.value,
    scope: "account",
    status: patch.status,
    origin: patch.origin ?? "explicit",
    sourceConversationId: patch.sourceConversationId ?? SOURCE,
    sourceMessageId: null,
    supersedesId: null,
    revision: patch.revision,
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
    forgottenAt: patch.forgottenAt ?? null,
  };
}

function storage() {
  const saved = new Map<string, string>();
  return {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  };
}

describe("assistant memory store", () => {
  it("remembers, rejects a second remember, and forgets without injecting a stale cache", async () => {
    let rows: AssistantMemory[] = [];
    const injected: AssistantMemory[][] = [];
    const api: AssistantMemoriesApi = {
      list: vi.fn(async () => rows),
      remember: vi.fn(async (_user, input) => {
        if (rows.some((row) => row.status === "active" && row.key === input.key && row.origin === "explicit") && !input.replace) {
          throw new AssistantMemoryError("exists", "That preference is already remembered. Change it instead.");
        }
        rows = [memory({
          id: input.id,
          key: input.key,
          value: input.value,
          status: "active",
          revision: 1,
          sourceConversationId: input.sourceConversationId,
        })];
        return rows;
      }),
      forget: vi.fn(async (_user, input) => {
        const active = rows.find((row) => row.status === "active" && row.key === input.key);
        if (!active || active.revision !== input.expectedRevision) {
          throw new AssistantMemoryError("conflict", "Another device changed that preference.");
        }
        rows = [{ ...active, status: "forgotten", revision: active.revision + 1, forgottenAt: "2026-09-30T13:00:00.000Z" }];
        return rows;
      }),
      listLearningBatch: vi.fn(async () => []),
      commitLearning: vi.fn(async () => rows),
      settleCandidate: vi.fn(async () => rows),
    };
    const disk = storage();
    const store = new AssistantMemoryStore(api, disk, { subscribe: () => () => undefined }, (next) => {
      injected.push([...next]);
    }, () => SOURCE);
    await store.setUser(USER);
    expect(await store.remember("preference", "Answer length", "Prefer short answers.")).toMatch(/Remembered answer_length/);
    expect(injected.at(-1)?.map((row) => row.value)).toEqual(["Prefer short answers."]);
    await expect(store.remember("preference", "answer_length", "Prefer short answers.")).rejects.toThrow(/already remembered/);
    expect(await store.forget("answer_length")).toMatch(/Forgot answer_length/);
    expect(store.getSnapshot().memories[0]?.status).toBe("forgotten");
    expect(store.suppressed("answer_length", SOURCE)).toBe(true);
    expect(injected.at(-1)?.some((row) => row.status === "active")).toBe(false);
    api.list = vi.fn(async () => { throw new AssistantMemoryError("unavailable", "Couldn't reach memory storage. Check your connection."); });
    const later = new AssistantMemoryStore(api, disk, { subscribe: () => () => undefined }, (next) => {
      injected.push([...next]);
    }, () => null);
    await later.setUser(USER);
    expect(later.getSnapshot().offline).toBe(true);
    expect(later.getSnapshot().memories.some((row) => row.value === "Prefer short answers.")).toBe(true);
    expect(injected.at(-1)).toEqual([]);
  });

  it("keeps the other account's rows out of this list", async () => {
    const api: AssistantMemoriesApi = {
      list: vi.fn(async (userId) => (userId === USER ? [] : [memory({ key: "secret", value: "Other account.", status: "active", revision: 1 })])),
      remember: vi.fn(async () => []),
      forget: vi.fn(async () => []),
      listLearningBatch: vi.fn(async () => []),
      commitLearning: vi.fn(async () => []),
      settleCandidate: vi.fn(async () => []),
    };
    const store = new AssistantMemoryStore(api, storage(), { subscribe: () => () => undefined }, () => undefined, () => null);
    await store.setUser(USER);
    expect(store.getSnapshot().memories).toEqual([]);
    expect(await store.listText()).toBe("No memories are remembered.");
  });

  it("learns a clear preference once and does not replace an explicit value", async () => {
    const messageId = "44444444-4444-4444-8444-000000000001";
    let listed = 0;
    const commits: { id: string; evidences: string[] }[][] = [];
    const explicit = memory({ key: "answer_length", value: "Prefer detailed answers.", status: "active", origin: "explicit", revision: 2 });
    let rows: AssistantMemory[] = [];
    const api: AssistantMemoriesApi = {
      list: vi.fn(async () => rows),
      remember: vi.fn(async () => rows),
      forget: vi.fn(async () => rows),
      listLearningBatch: vi.fn(async () => {
        listed += 1;
        if (listed === 1) return [{ id: messageId, conversationId: SOURCE, body: "I prefer short answers." }];
        return [];
      }),
      commitLearning: vi.fn(async (_user, batch) => {
        commits.push(batch.map((item: { id: string; evidences: readonly string[] }) => ({ id: item.id, evidences: [...item.evidences] })));
        rows = [
          explicit,
          memory({
            id: "00000000-0000-4000-8000-000000000088",
            key: "answer_length",
            value: "Prefer short answers.",
            status: "candidate",
            origin: "extracted",
            revision: 3,
          }),
        ];
        return rows;
      }),
      settleCandidate: vi.fn(async () => rows),
    };
    const store = new AssistantMemoryStore(api, storage(), { subscribe: () => () => undefined }, () => undefined, () => SOURCE);
    await store.setUser(USER);
    await store.learn();
    expect(api.listLearningBatch).not.toHaveBeenCalled();
    store.setLearning(true);
    await store.learn();
    expect(commits).toEqual([[{ id: messageId, evidences: ["I prefer short answers."] }]]);
    expect(store.getSnapshot().memories.filter((row) => row.status === "active")).toEqual([explicit]);
    await store.learn();
    expect(commits).toHaveLength(1);
  });
});
