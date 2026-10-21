import { describe, expect, it } from "vitest";
import { ClipboardStore, type ClipboardPreferenceAccess } from "@/clipboard/ClipboardStore";
import {
  DEFAULT_CLIPBOARD_PREFERENCES,
  encodeBase64,
  type ClipboardEntry,
  type ClipboardPreferences,
} from "@/clipboard/clipboardEntry";
import { memoryClipboardImages } from "@/clipboard/clipboardImages";
import { ClipboardHashConflict, type ClipboardApi } from "@/services/clipboardService";
import type { KeyValueStorage } from "@/sync/personalCache";

function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
  };
}

function preferenceAccess(initial: Partial<ClipboardPreferences> = {}): ClipboardPreferenceAccess {
  let current: ClipboardPreferences = { ...DEFAULT_CLIPBOARD_PREFERENCES, ...initial };
  return {
    load: () => current,
    save: (patch) => {
      current = { ...current, ...patch };
      return current;
    },
  };
}

function fakeApi(seed: ClipboardEntry[] = []) {
  const rows = seed.map((entry) => ({ ...entry }));
  let clearedAt: string | null = null;
  const calls = { upsert: 0, clear: 0, remove: 0, upload: 0 };
  let failList = false;
  const api: ClipboardApi = {
    async list() {
      if (failList) throw new Error("Couldn't reach clipboard sync.");
      return {
        entries: rows.map((entry) => ({ ...entry, visibility: "account" as const, pending: "none" as const })),
        clearedAt,
      };
    },
    async upsert(_userId, entry) {
      calls.upsert += 1;
      const clash = rows.some((row) => row.id !== entry.id && row.deletedAt === null && row.contentHash === entry.contentHash);
      if (clash) throw new ClipboardHashConflict();
      const index = rows.findIndex((row) => row.id === entry.id);
      const saved = { ...entry, visibility: "account" as const, pending: "none" as const };
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
    },
    async remove(_userId, entry) {
      calls.remove += 1;
      const index = rows.findIndex((row) => row.id === entry.id);
      const current = rows[index];
      if (current) rows[index] = { ...current, text: null, deletedAt: entry.deletedAt, updatedAt: entry.updatedAt };
    },
    async clear(_userId, at) {
      calls.clear += 1;
      clearedAt = at;
      rows.length = 0;
    },
    async uploadImage(userId, entryId) {
      calls.upload += 1;
      return `${userId}/${entryId}.bmp`;
    },
    async downloadImage() {
      return new Uint8Array([1, 2, 3]);
    },
    async deleteImage() {},
  };
  return {
    api,
    rows,
    calls,
    failNextList() { failList = true; },
    restoreList() { failList = false; },
  };
}

function change(text: string, patch: { sourceApp?: string; sourceProcess?: string; excluded?: boolean } = {}) {
  return {
    text,
    sourceApp: patch.sourceApp ?? "Notepad",
    sourceProcess: patch.sourceProcess ?? "notepad.exe",
    excluded: patch.excluded ?? false,
    imageBase64: null,
    imageFormat: null,
  };
}

describe("ClipboardStore", () => {
  it("saves and syncs by default, without storing an unchanged copy twice", async () => {
    const remote = fakeApi();
    let clock = "2026-10-20T12:00:00.000Z";
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const store = new ClipboardStore(
      remote.api,
      memoryStorage(),
      memoryClipboardImages(),
      preferenceAccess(),
      () => ids.shift() ?? "33333333-3333-4333-8333-333333333333",
      () => clock,
    );
    store.setDevice("device-a");
    await store.setUser("user-1");
    expect(await store.ingest(change("Hello"))).toBe("saved");
    expect(await store.ingest(change("Hello"))).toBe("skipped");
    expect(remote.calls.upsert).toBeGreaterThan(0);
    expect(store.getSnapshot().entries).toHaveLength(1);

    clock = "2026-10-20T12:05:00.000Z";
    expect(await store.ingest(change("https://example.com"))).toBe("saved");
    clock = "2026-10-20T12:06:00.000Z";
    expect(await store.ingest(change("Hello"))).toBe("saved");
    const hello = store.getSnapshot().entries.find((entry) => entry.text === "Hello");
    expect(hello?.copyCount).toBe(2);
    expect(store.getSnapshot().entries.filter((entry) => entry.text === "Hello")).toHaveLength(1);
    expect(store.getSnapshot().entries.find((entry) => entry.kind === "url")?.text).toBe("https://example.com");
    expect(store.getSnapshot().status).toBe("synced");
  });

  it("saves copies from any app and only skips copies Windows excluded", async () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
    const store = new ClipboardStore(
      fakeApi().api,
      memoryStorage(),
      memoryClipboardImages(),
      preferenceAccess(),
      () => ids.shift() ?? "44444444-4444-4444-8444-444444444444",
      () => "2026-10-20T12:00:00.000Z",
    );
    await store.setUser("user-1");
    expect(await store.ingest(change("deploy check", { sourceApp: "Persyn.ai \u2014 One AI Creator - Cursor" }))).toBe("saved");
    expect(store.getSnapshot().entries.find((entry) => entry.text === "deploy check")?.sourceApp).toBe("Persyn.ai - One AI Creator - Cursor");
    expect(await store.ingest(change("balance", { sourceApp: "My Bank" }))).toBe("saved");
    expect(await store.ingest(change("hunter2", { sourceApp: "Vault", sourceProcess: "1password.exe" }))).toBe("saved");
    expect(await store.recordCapturedSelection("Hello", "Notes")).toBe("saved");
    expect(await store.ingest({ ...change("private"), excluded: true })).toBe("ignored");
    expect(store.getSnapshot().entries.map((entry) => entry.text)).toEqual(["deploy check", "balance", "hunter2", "Hello"]);
  });

  it("saves a PNG image copy, like a Snipping Tool snip", async () => {
    const remote = fakeApi();
    const images = memoryClipboardImages();
    const store = new ClipboardStore(
      remote.api,
      memoryStorage(),
      images,
      preferenceAccess(),
      () => "11111111-1111-4111-8111-111111111111",
      () => "2026-10-20T12:00:00.000Z",
    );
    await store.setUser("user-1");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(await store.ingest({
      text: null,
      sourceApp: "Snipping Tool",
      sourceProcess: "SnippingTool.exe",
      excluded: false,
      imageBase64: encodeBase64(png),
      imageFormat: "png",
    })).toBe("saved");
    const entry = store.getSnapshot().entries[0];
    expect(entry).toMatchObject({ kind: "image", text: null, sourceApp: "Snipping Tool" });
    expect(await images.get(entry?.id ?? "")).toEqual(png);
    expect(remote.calls.upload).toBe(1);
    expect(await store.ingest({
      text: null,
      sourceApp: "Snipping Tool",
      sourceProcess: "SnippingTool.exe",
      excluded: false,
      imageBase64: encodeBase64(new Uint8Array([1, 2, 3])),
      imageFormat: "png",
    })).toBe("ignored");
    expect(store.getSnapshot().entries).toHaveLength(1);
  });

  it("keeps only the last 20 copies", async () => {
    const remote = fakeApi();
    let clock = "2026-10-20T12:00:00.000Z";
    let nextId = 0;
    const store = new ClipboardStore(
      remote.api,
      memoryStorage(),
      memoryClipboardImages(),
      preferenceAccess(),
      () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
      () => clock,
    );
    await store.setUser("user-1");
    for (let index = 0; index < 21; index += 1) {
      clock = new Date(Date.UTC(2026, 9, 20, 12, index)).toISOString();
      expect(await store.ingest(change(`Copy ${index}`))).toBe("saved");
    }
    const texts = store.getSnapshot().entries.map((entry) => entry.text);
    expect(texts).toHaveLength(20);
    expect(texts).not.toContain("Copy 0");
    expect(texts).toContain("Copy 20");
    expect(remote.rows.filter((row) => row.deletedAt === null)).toHaveLength(20);
  });

  it("syncs a deletion and a remote entry without writing the local clipboard", async () => {
    const remote = fakeApi();
    const storage = memoryStorage();
    const images = memoryClipboardImages();
    let clock = "2026-10-20T12:00:00.000Z";
    const make = (id: string) => new ClipboardStore(
      remote.api,
      storage,
      images,
      preferenceAccess({ captureEnabled: true, syncEnabled: true }),
      () => id,
      () => clock,
    );
    const computerA = make("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    computerA.setDevice("device-a");
    await computerA.setUser("user-1");
    await computerA.ingest(change("From A"));
    expect(remote.rows.some((row) => row.text === "From A")).toBe(true);

    clock = "2026-10-20T12:10:00.000Z";
    const computerB = new ClipboardStore(
      remote.api,
      memoryStorage(),
      memoryClipboardImages(),
      preferenceAccess({ captureEnabled: true, syncEnabled: true }),
      () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      () => clock,
    );
    computerB.setDevice("device-b");
    await computerB.setUser("user-1");
    expect(computerB.getSnapshot().entries.map((entry) => entry.text)).toContain("From A");
    const copied = await computerB.markCopied(computerB.getSnapshot().entries[0]?.id ?? "");
    expect(copied?.text).toBe("From A");
    expect(copied?.copyCount).toBe(2);

    clock = "2026-10-20T12:20:00.000Z";
    await computerA.remove(computerA.getSnapshot().entries[0]?.id ?? "");
    await computerB.reload();
    expect(computerB.getSnapshot().entries).toHaveLength(0);
  });

  it("keeps a captured item while offline and uploads it after reconnecting", async () => {
    const remote = fakeApi();
    const store = new ClipboardStore(
      remote.api,
      memoryStorage(),
      memoryClipboardImages(),
      preferenceAccess({ captureEnabled: true, syncEnabled: true }),
      () => "11111111-1111-4111-8111-111111111111",
      () => "2026-10-20T12:00:00.000Z",
    );
    await store.setUser("user-1");
    remote.failNextList();
    await store.ingest(change("Offline note"));
    expect(store.getSnapshot().status).toBe("offline");
    expect(store.getSnapshot().entries.map((entry) => entry.text)).toEqual(["Offline note"]);
    remote.restoreList();
    await store.reload();
    expect(store.getSnapshot().status).toBe("synced");
    expect(remote.rows.map((row) => row.text)).toContain("Offline note");
  });

  it("permanently clears the account history", async () => {
    const remote = fakeApi();
    const store = new ClipboardStore(
      remote.api,
      memoryStorage(),
      memoryClipboardImages(),
      preferenceAccess({ captureEnabled: true, syncEnabled: true }),
      () => "11111111-1111-4111-8111-111111111111",
      () => "2026-10-20T12:00:00.000Z",
    );
    await store.setUser("user-1");
    await store.ingest(change("Gone"));
    await store.clear();
    expect(remote.calls.clear).toBe(1);
    expect(remote.rows).toHaveLength(0);
    expect(store.getSnapshot().entries).toHaveLength(0);
  });
});
