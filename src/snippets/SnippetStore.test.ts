import { describe, expect, it } from "vitest";
import type { SnippetsApi } from "@/services/snippetsService";
import { SnippetStore } from "@/snippets/SnippetStore";
import { writeSnippetCache } from "@/snippets/snippetCache";
import type { Snippet } from "@/snippets/snippet";
import type { KeyValueStorage } from "@/sync/personalCache";

function snippet(id: string, trigger: string, content = "Expanded text"): Snippet {
  return {
    id,
    trigger,
    normalizedTrigger: trigger.toLocaleLowerCase(),
    content,
    enabled: true,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

function storage(): KeyValueStorage {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => { rows.set(key, value); },
  };
}

function fakeApi(seed: Snippet[] = []): SnippetsApi {
  const rows = [...seed];
  return {
    async list() { return rows.map((row) => ({ ...row })); },
    async create(_userId, trigger, content) {
      const next = snippet(`snippet-${rows.length + 1}`, trigger, content);
      rows.push(next);
      return { ...next };
    },
    async update(id, trigger, content) {
      const found = rows.find((row) => row.id === id);
      if (!found) throw new Error("missing");
      Object.assign(found, {
        trigger,
        normalizedTrigger: trigger.toLocaleLowerCase(),
        content,
        updatedAt: "2026-10-06T01:00:00.000Z",
      });
      return { ...found };
    },
    async setEnabled(id, enabled) {
      const found = rows.find((row) => row.id === id);
      if (!found) throw new Error("missing");
      found.enabled = enabled;
      found.updatedAt = "2026-10-06T01:00:00.000Z";
      return { ...found };
    },
    async delete(id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}

describe("SnippetStore", () => {
  it("loads and mutates synced snippets", async () => {
    const store = new SnippetStore(fakeApi([snippet("one", "my LinkedIn")]), storage());
    await store.setUser("user-1");
    expect(store.getSnapshot().snippets.map((entry) => entry.trigger)).toEqual(["my LinkedIn"]);

    await store.create("read only mode", "Investigate only.");
    const created = store.getSnapshot().snippets.find((entry) => entry.trigger === "read only mode");
    expect(created?.content).toBe("Investigate only.");

    await store.setEnabled(created!.id, false);
    expect(store.getSnapshot().snippets.find((entry) => entry.id === created!.id)?.enabled).toBe(false);

    await store.update(created!.id, "read only", "Do not make changes.");
    expect(store.getSnapshot().snippets.find((entry) => entry.id === created!.id)?.content).toBe("Do not make changes.");

    await store.remove(created!.id);
    expect(store.getSnapshot().snippets.some((entry) => entry.id === created!.id)).toBe(false);
  });

  it("uses the last server-confirmed cache when sync is unavailable", async () => {
    const local = storage();
    writeSnippetCache(local, "user-1", [snippet("cached", "my LinkedIn", "https://example.com")]);
    const api: SnippetsApi = {
      async list() { throw new Error("offline"); },
      async create() { throw new Error("unused"); },
      async update() { throw new Error("unused"); },
      async setEnabled() { throw new Error("unused"); },
      async delete() { throw new Error("unused"); },
    };
    const store = new SnippetStore(api, local);
    await store.setUser("user-1");
    expect(store.getSnapshot().status).toBe("offline");
    expect(store.getSnapshot().snippets[0]?.content).toBe("https://example.com");
  });
});
