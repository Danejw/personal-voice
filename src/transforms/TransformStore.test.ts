import { describe, expect, it } from "vitest";
import type { TransformProfilesApi } from "@/services/transformProfilesService";
import { TransformStore } from "@/transforms/TransformStore";
import type { TransformProfile } from "@/transforms/transformProfile";

function profile(id: string, name: string): TransformProfile {
  return {
    id,
    name,
    instruction: `Rewrite as ${name}`,
    builtIn: false,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

function fakeApi(seed: TransformProfile[] = []): TransformProfilesApi {
  const rows = [...seed];
  return {
    async list() { return rows.map((row) => ({ ...row })); },
    async create(_userId, name, instruction) {
      const next = { ...profile(`custom-${rows.length + 1}`, name), instruction };
      rows.push(next);
      return { ...next };
    },
    async update(id, name, instruction) {
      const found = rows.find((row) => row.id === id);
      if (!found) throw new Error("missing");
      Object.assign(found, { name, instruction, updatedAt: "2026-10-06T01:00:00.000Z" });
      return { ...found };
    },
    async delete(id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}

describe("TransformStore", () => {
  it("loads and mutates account custom profiles", async () => {
    const store = new TransformStore(fakeApi([profile("one", "Legal")]));
    await store.setUser("user-1");
    expect(store.getSnapshot().profiles.map((entry) => entry.name)).toEqual(["Legal"]);

    await store.create("Coding Agent", "Turn this into a coding task.");
    expect(store.getSnapshot().profiles.some((entry) => entry.name === "Coding Agent")).toBe(true);

    const coding = store.getSnapshot().profiles.find((entry) => entry.name === "Coding Agent");
    await store.update(coding!.id, "Cursor Prompt", "Turn this into a Cursor task.");
    expect(store.getSnapshot().profiles.some((entry) => entry.name === "Cursor Prompt")).toBe(true);

    await store.remove(coding!.id);
    expect(store.getSnapshot().profiles.some((entry) => entry.name === "Cursor Prompt")).toBe(false);
  });

  it("does not allow custom profiles to shadow built-ins", async () => {
    const store = new TransformStore(fakeApi());
    await store.setUser("user-1");
    await expect(store.create("Prompt Engineer", "Different prompt.")).rejects.toThrow(
      "A transform with that name already exists.",
    );
  });
});
