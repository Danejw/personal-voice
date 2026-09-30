import { describe, expect, it } from "vitest";
import type { DeviceInfo, PersonalSyncApi } from "@/services/personalSyncService";
import { PersonalSyncStore } from "@/sync/PersonalSyncStore";
import { readPersonalCache, writePersonalCache } from "@/sync/personalCache";
import type { KeyValueStorage } from "@/sync/personalCache";
import { DEFAULT_SETTINGS, MAX_ENABLED_TERMS, transcriptionPreferences } from "@/sync/personalData";
import type { DictionaryTerm, PersonalData } from "@/sync/personalData";

function memoryStorage(): KeyValueStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

/** In-memory Supabase: one account's rows, plus switches to simulate outages and slow responses. */
function fakeServer(initial: PersonalData = { settings: DEFAULT_SETTINGS, terms: [] }) {
  const state = structuredClone(initial);
  const devices: DeviceInfo[] = [];
  const control = { offline: false, failWrites: 0, gate: null as Promise<void> | null };
  const guard = async () => {
    if (control.gate) await control.gate;
    if (control.offline) throw new Error("Couldn't reach the sync service. Check your connection.");
  };
  const writeGuard = async () => {
    await guard();
    if (control.failWrites > 0) {
      control.failWrites -= 1;
      throw new Error("Sync failed (500).");
    }
  };
  const api: PersonalSyncApi = {
    async load() { await guard(); return structuredClone(state); },
    async saveSettings(_userId, settings) { await writeGuard(); state.settings = { ...settings }; },
    async insertTerm(_userId, term) { await writeGuard(); state.terms.push({ ...term }); },
    async setTermEnabled(id, enabled) {
      await writeGuard();
      state.terms = state.terms.map((entry) => entry.id === id ? { ...entry, enabled } : entry);
    },
    async deleteTerm(id) { await writeGuard(); state.terms = state.terms.filter((entry) => entry.id !== id); },
    async touchDevice(_userId, device) { await guard(); devices.push(device); },
  };
  return { api, state, devices, control };
}

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

function terms(...names: string[]): DictionaryTerm[] {
  return names.map((term, index) => ({ id: `t${index}`, term, enabled: true }));
}

describe("PersonalSyncStore", () => {
  it("loads settings and dictionary from Supabase on sign-in and caches them", async () => {
    const server = fakeServer({ settings: { ...DEFAULT_SETTINGS, smartTranscription: false, language: "en-GB" }, terms: terms("Supabase", "Persyn") });
    const storage = memoryStorage();
    const store = new PersonalSyncStore(server.api, storage, "windows", ids());

    await store.setUser("u1");

    const { status, data } = store.getSnapshot();
    expect(status).toBe("synced");
    expect(data.settings).toEqual({ ...DEFAULT_SETTINGS, smartTranscription: false, language: "en-GB" });
    expect(data.terms.map((entry) => entry.term)).toEqual(["Persyn", "Supabase"]);
    expect(readPersonalCache(storage, "u1")).toEqual(data);
  });

  it("shows the cached copy while loading and keeps it read-only when offline", async () => {
    const storage = memoryStorage();
    writePersonalCache(storage, "u1", { settings: { ...DEFAULT_SETTINGS, smartTranscription: false, language: null }, terms: terms("UFIQ") });
    const server = fakeServer();
    server.control.offline = true;
    const store = new PersonalSyncStore(server.api, storage, "windows", ids());

    await store.setUser("u1");

    const snapshot = store.getSnapshot();
    expect(snapshot.status).toBe("offline");
    expect(snapshot.data.terms.map((entry) => entry.term)).toEqual(["UFIQ"]);
    expect(snapshot.error).toContain("Using the last saved copy.");
    expect(store.addTerm("Runware")).toBe("Changes can be saved once sync is connected.");

    server.control.offline = false;
    await store.reload();
    expect(store.getSnapshot().status).toBe("synced");
    expect(store.getSnapshot().data.terms).toEqual([]);
  });

  it("persists edits so a fresh start (new store) reloads them", async () => {
    const server = fakeServer();
    const store = new PersonalSyncStore(server.api, memoryStorage(), "windows", ids());
    await store.setUser("u1");

    expect(store.addTerm("  Seed   Dance ")).toBeNull();
    expect(store.addTerm("model_pricing_skus")).toBeNull();
    expect(store.updateSettings({ smartTranscription: false })).toBeNull();
    expect(store.updateSettings({ language: "fr-FR" })).toBeNull();
    expect(store.updateSettings({ usageIntelligence: false })).toBeNull();
    expect(store.updateSettings({ cloudDictationHistory: true })).toBeNull();
    const added = store.getSnapshot().data.terms.find((entry) => entry.term === "Seed Dance");
    expect(added).toBeDefined();
    expect(store.setTermEnabled(added?.id ?? "", false)).toBeNull();
    await store.settled();

    const restarted = new PersonalSyncStore(server.api, memoryStorage(), "windows", ids());
    await restarted.setUser("u1");
    expect(restarted.getSnapshot().data).toEqual({
      settings: { ...DEFAULT_SETTINGS, smartTranscription: false, language: "fr-FR", usageIntelligence: false, cloudDictationHistory: true },
      terms: [
        { id: "id-3", term: "model_pricing_skus", enabled: true },
        { id: "id-2", term: "Seed Dance", enabled: false },
      ],
    });
  });

  it("shows edits immediately, before Supabase answers", async () => {
    const server = fakeServer();
    const store = new PersonalSyncStore(server.api, memoryStorage(), "windows", ids());
    await store.setUser("u1");
    let open = () => {};
    server.control.gate = new Promise((resolve) => { open = resolve; });

    store.addTerm("Lovable");
    expect(store.getSnapshot().data.terms.map((entry) => entry.term)).toEqual(["Lovable"]);
    expect(server.state.terms).toEqual([]);

    open();
    await store.settled();
    expect(server.state.terms.map((entry) => entry.term)).toEqual(["Lovable"]);
  });

  it("rolls a failed write back but keeps later edits that succeed", async () => {
    const server = fakeServer({ settings: DEFAULT_SETTINGS, terms: terms("Persyn") });
    const storage = memoryStorage();
    const store = new PersonalSyncStore(server.api, storage, "windows", ids());
    await store.setUser("u1");
    server.control.failWrites = 1;

    store.removeTerm("t0");
    store.addTerm("Runware");
    await store.settled();

    const snapshot = store.getSnapshot();
    expect(snapshot.error).toBe("Sync failed (500).");
    expect(snapshot.data.terms.map((entry) => entry.term)).toEqual(["Persyn", "Runware"]);
    expect(server.state.terms.map((entry) => entry.term)).toEqual(["Persyn", "Runware"]);
    expect(readPersonalCache(storage, "u1")?.terms.map((entry) => entry.term)).toEqual(["Persyn", "Runware"]);
  });

  it("refuses duplicates (any case), blanks, and more than the curated number of active terms", async () => {
    const many = Array.from({ length: MAX_ENABLED_TERMS - 1 }, (_, index) => `term${index}`);
    const server = fakeServer({ settings: DEFAULT_SETTINGS, terms: terms("Persyn", ...many) });
    const store = new PersonalSyncStore(server.api, memoryStorage(), "windows", ids());
    await store.setUser("u1");

    expect(store.addTerm("persyn")).toBe("That term is already in your dictionary.");
    expect(store.addTerm("   ")).toBe("Type a word or phrase first.");
    expect(store.addTerm("x".repeat(101))).toBe("Terms can be at most 100 characters.");
    expect(store.addTerm("Brand new")).toBe(`${MAX_ENABLED_TERMS} terms are already active. Turn one off first.`);

    expect(store.setTermEnabled("t0", false)).toBeNull();
    expect(store.setTermEnabled("t1", false)).toBeNull();
    expect(store.setTermEnabled("t0", true)).toBeNull();
    expect(store.addTerm("Brand new")).toBeNull();
    expect(store.setTermEnabled("t1", true)).toBe(`${MAX_ENABLED_TERMS} terms are already active. Turn one off first.`);
    await store.settled();
  });

  it("feeds only enabled terms and the synced settings into the next session", async () => {
    const server = fakeServer({
      settings: { ...DEFAULT_SETTINGS, smartTranscription: false, language: "de-DE" },
      terms: [{ id: "a", term: "Supabase", enabled: true }, { id: "b", term: "Retired", enabled: false }],
    });
    const store = new PersonalSyncStore(server.api, memoryStorage(), "windows", ids());
    await store.setUser("u1");

    expect(transcriptionPreferences(store.getSnapshot().data)).toEqual({
      smart: false, language: "de-DE", vocabulary: ["Supabase"],
    });
  });

  it("records this device once per account with a stable id", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const store = new PersonalSyncStore(server.api, storage, "windows", ids());
    await store.setUser("u1");
    await store.setUser(null);
    await store.setUser("u1");

    expect(server.devices).toHaveLength(2);
    expect(server.devices[0]).toEqual({ id: "id-1", name: "Windows", platform: "windows" });
    expect(server.devices[1]?.id).toBe("id-1");
  });

  it("clears on sign-out and ignores a slow load that finishes after an account switch", async () => {
    const slow = fakeServer({ settings: { ...DEFAULT_SETTINGS, smartTranscription: false, language: null }, terms: terms("Old account") });
    const store = new PersonalSyncStore(slow.api, memoryStorage(), "windows", ids());
    let open = () => {};
    slow.control.gate = new Promise((resolve) => { open = resolve; });

    const first = store.setUser("u1");
    await store.setUser(null);
    open();
    await first;

    expect(store.getSnapshot()).toEqual({
      status: "signed-out",
      data: { settings: DEFAULT_SETTINGS, terms: [] },
      error: null,
    });
  });
});
