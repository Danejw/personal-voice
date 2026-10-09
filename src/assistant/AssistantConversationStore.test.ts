import { describe, expect, it, vi } from "vitest";
import { AssistantConversationStore, type AssistantTranscriptHost } from "@/assistant/AssistantConversationStore";
import { readAssistantCache, readPending, readRecovery, writeOpenConversation } from "@/assistant/conversationRecord";
import type { AssistantStatus, AssistantTurn } from "@/assistant/state";
import {
  AssistantStorageError,
  type AssistantConversation,
  type AssistantMessageInput,
  type AssistantStoredMessage,
} from "@/services/assistantConversations";
import type { AssistantConversationsApi } from "@/services/assistantConversationsService";
import type { KeyValueStorage } from "@/sync/personalCache";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";
const DEVICE_B = "55555555-5555-4555-8555-555555555555";

function memory(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

class FakeHost implements AssistantTranscriptHost {
  status: AssistantStatus = "IDLE";
  turns: AssistantTurn[] = [];
  onTurn: ((turn: AssistantTurn) => void) | null = null;
  onRevise: ((turn: AssistantTurn) => void) | null = null;
  starts = 0;
  private listeners = new Set<(snapshot: { status: AssistantStatus }) => void>();

  getSnapshot() {
    return {
      status: this.status,
      turns: this.turns,
      selection: null,
      notes: [],
      handoff: null,
      screen: null,
    };
  }

  start() {
    this.starts += 1;
    this.status = "READY";
    this.emitStatus();
  }

  end() {
    this.status = "IDLE";
    this.emitStatus();
  }

  showSaved(turns: AssistantTurn[]) {
    this.turns = turns;
  }

  subscribe(listener: (snapshot: { status: AssistantStatus }) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setCommittedTurnHandler(handler: ((turn: AssistantTurn) => void) | null) {
    this.onTurn = handler;
  }

  setTurnRevisionHandler(handler: ((turn: AssistantTurn) => void) | null) {
    this.onRevise = handler;
  }

  seeded: { role: "user" | "model"; text: string }[] = [];

  setSavedHistory(turns: readonly { role: "user" | "model"; text: string }[]) {
    this.seeded = turns.map((turn) => ({ role: turn.role, text: turn.text }));
  }

  setToolRecordHandler() {}

  emit(turn: AssistantTurn) {
    this.onTurn?.(turn);
  }

  private emitStatus() {
    for (const listener of this.listeners) listener({ status: this.status });
  }
}

class FakeApi implements AssistantConversationsApi {
  conversations = new Map<string, AssistantConversation & { userId: string; deleted: boolean }>();
  messages: AssistantStoredMessage[] = [];
  appends = 0;
  deletes: string[] = [];
  gets = 0;
  delayAppend: Promise<void> | null = null;
  delayGet: Promise<void> | null = null;
  delayList: Promise<void> | null = null;
  failNextAppend = false;
  failReads = false;

  async create(userId: string, input: { id: string; title: string }) {
    const existing = this.conversations.get(input.id);
    if (existing?.deleted) throw new AssistantStorageError("deleted", "That conversation was deleted.");
    if (existing) return { conversation: existing, created: false };
    const now = "2026-09-30T00:00:00.000Z";
    const conversation = {
      id: input.id,
      userId,
      title: input.title,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      leaseDeviceId: null,
      leaseExpiresAt: null,
      fence: 0,
      summary: null,
      contextItems: [],
      deleted: false,
    };
    this.conversations.set(input.id, conversation);
    return { conversation, created: true };
  }

  async rename(userId: string, id: string, title: string) {
    const conversation = this.own(userId, id);
    conversation.title = title;
    conversation.revision += 1;
    return conversation;
  }

  async delete(userId: string, id: string) {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.userId !== userId) throw new AssistantStorageError("not-found", "That conversation was not found.");
    this.deletes.push(id);
    if (!conversation.deleted) {
      conversation.deleted = true;
      conversation.title = "";
      conversation.fence += 1;
      this.messages = this.messages.filter((message) => message.conversationId !== id);
    }
  }

  async get(userId: string, id: string) {
    this.gets += 1;
    if (this.failReads) throw new AssistantStorageError("unavailable", "Couldn't reach conversation storage. Check your connection.");
    if (this.delayGet) await this.delayGet;
    return this.own(userId, id);
  }

  async list(userId: string) {
    if (this.delayList) await this.delayList;
    if (this.failReads) throw new AssistantStorageError("unavailable", "Couldn't reach conversation storage. Check your connection.");
    return [...this.conversations.values()].filter((conversation) => conversation.userId === userId && !conversation.deleted);
  }

  async claim(userId: string, id: string, deviceId: string, input: { ttlSeconds: number; takeover: boolean }) {
    const conversation = this.own(userId, id);
    const expiry = conversation.leaseExpiresAt ? Date.parse(conversation.leaseExpiresAt) : 0;
    const heldByOther = Boolean(conversation.leaseDeviceId && conversation.leaseDeviceId !== deviceId && expiry > Date.now());
    if (heldByOther && !input.takeover) return { conversation: { ...conversation }, acquired: false };
    if (conversation.leaseDeviceId !== deviceId) conversation.fence += 1;
    conversation.leaseDeviceId = deviceId;
    conversation.leaseExpiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    conversation.revision += 1;
    return { conversation: { ...conversation }, acquired: true };
  }

  async release(userId: string, id: string, deviceId: string, fence: number) {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.userId !== userId) return;
    if (conversation.leaseDeviceId === deviceId && conversation.fence === fence) {
      conversation.leaseDeviceId = null;
      conversation.leaseExpiresAt = null;
    }
  }

  async saveSummary(userId: string, id: string, summary: { body: string; throughSeq: number; fingerprint: string }) {
    const conversation = this.own(userId, id);
    if (conversation.summary && conversation.summary.fingerprint !== summary.fingerprint && conversation.summary.throughSeq >= summary.throughSeq) {
      throw new AssistantStorageError("conflict", "Another summary was saved.");
    }
    conversation.summary = summary;
    return { conversation: { ...conversation }, saved: true };
  }

  async saveContextItems(userId: string, id: string, items: AssistantConversation["contextItems"]) {
    this.own(userId, id).contextItems = [...items];
  }

  async append(userId: string, input: AssistantMessageInput) {
    this.appends += 1;
    if (this.delayAppend) await this.delayAppend;
    this.own(userId, input.conversationId);
    const existing = this.messages.find((message) => message.id === input.id);
    if (existing) {
      if (existing.body !== input.body || existing.status !== input.status) {
        throw new AssistantStorageError("conflict", "That message id was already used with different content.");
      }
      if (this.failNextAppend) {
        this.failNextAppend = false;
        throw new AssistantStorageError("unavailable", "Couldn't reach conversation storage. Check your connection.");
      }
      return { message: existing, appended: false, revision: 2 };
    }
    const conversation = this.own(userId, input.conversationId);
    if (input.role !== "user") {
      const expiry = conversation.leaseExpiresAt ? Date.parse(conversation.leaseExpiresAt) : 0;
      if (conversation.leaseDeviceId !== input.sourceDeviceId || input.fence !== conversation.fence || expiry <= Date.now()) {
        throw new AssistantStorageError("lost", "Another device is continuing this conversation.");
      }
    }
    const message: AssistantStoredMessage = {
      id: input.id,
      conversationId: input.conversationId,
      role: input.role,
      status: input.status,
      body: input.body,
      seq: this.messages.filter((row) => row.conversationId === input.conversationId).length + 1,
      sourceDeviceId: input.sourceDeviceId,
      createdAt: "2026-09-30T00:00:00.000Z",
      citations: [...(input.citations ?? [])],
      toolName: null,
      toolOutcome: null,
    };
    this.messages.push(message);
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new AssistantStorageError("unavailable", "Couldn't reach conversation storage. Check your connection.");
    }
    return { message, appended: true, revision: 2 };
  }

  async listMessages(userId: string, conversationId: string) {
    if (this.failReads) throw new AssistantStorageError("unavailable", "Couldn't reach conversation storage. Check your connection.");
    this.own(userId, conversationId);
    return this.messages.filter((message) => message.conversationId === conversationId);
  }

  private own(userId: string, id: string) {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.userId !== userId || conversation.deleted) {
      throw new AssistantStorageError("not-found", "That conversation was not found.");
    }
    return conversation;
  }
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function turn(id: string, text: string, status?: "interrupted"): AssistantTurn {
  return { id, role: "user", text, ...(status ? { status } : {}) };
}

function reply(id: string, text: string): AssistantTurn {
  return { id, role: "assistant", text };
}

describe("saved assistant conversations", () => {
  it("shows loading while retrieving saved conversations and supports explicit refreshing", async () => {
    const thread = "44444444-4444-4444-8444-000000000900";
    const api = new FakeApi();
    const gate = deferred();
    api.delayList = gate.promise;
    const store = new AssistantConversationStore(new FakeHost(), api, memory(), () => thread, () => DEVICE);
    const opening = store.setUser(USER_A);
    expect(store.getSnapshot().loadingThreads).toBe(true);
    expect(store.getSnapshot().conversations).toEqual([]);
    gate.resolve();
    await opening;
    expect(store.getSnapshot().loadingThreads).toBe(false);
    expect(store.getSnapshot().conversations).toEqual([]);
    await api.create(USER_A, { id: thread, title: "Recovered thread" });
    await store.catchUp();
    expect(store.getSnapshot().conversations).toMatchObject([{ id: thread, title: "Recovered thread" }]);
    expect(store.getSnapshot().loadingThreads).toBe(false);
  });

  it("saves a turn, survives a restart, and retries without a second row", async () => {
    const storage = memory();
    const api = new FakeApi();
    api.failNextAppend = true;
    const host = new FakeHost();
    let next = 0;
    const ids = () => `44444444-4444-4444-8444-${String(++next).padStart(12, "0")}`;
    const store = new AssistantConversationStore(host, api, storage, ids, () => DEVICE);
    await store.setUser(USER_A);
    const spoken = turn(ids(), "Remember this");
    host.emit(spoken);
    await vi.waitFor(() => expect(store.getSnapshot().save).toBe("retry"));
    expect(api.messages).toHaveLength(1);
    expect(readPending(storage, USER_A)).toHaveLength(1);

    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().save).toBe("saved"));
    expect(api.messages).toHaveLength(1);
    expect(api.messages[0]?.id).toBe(spoken.id);
    expect(readPending(storage, USER_A)).toEqual([]);

    const reopened = new FakeHost();
    const again = new AssistantConversationStore(reopened, api, storage, ids, () => DEVICE);
    await again.setUser(USER_A);
    await vi.waitFor(() => expect(reopened.turns).toEqual([spoken]));
  });

  it("does not show one account's text after a slow write switches accounts", async () => {
    const storage = memory();
    const api = new FakeApi();
    const gate = deferred();
    api.delayAppend = gate.promise;
    const host = new FakeHost();
    const store = new AssistantConversationStore(host, api, storage, () => "44444444-4444-4444-8444-000000000009", () => DEVICE);
    await store.setUser(USER_A);
    host.emit(turn("44444444-4444-4444-8444-000000000001", "Secret from A"));
    await vi.waitFor(() => expect(api.appends).toBe(1));
    const switching = store.setUser(USER_B);
    gate.resolve();
    await switching;
    expect(host.turns.some((item) => item.text.includes("Secret"))).toBe(false);
    expect(readPending(storage, USER_B)).toEqual([]);
    await vi.waitFor(() => expect(readPending(storage, USER_A)).toEqual([]));
    expect(api.messages.map((message) => message.body)).toEqual(["Secret from A"]);
  });

  it("does not let a slow append put a deleted thread back", async () => {
    const storage = memory();
    const api = new FakeApi();
    const gate = deferred();
    api.delayAppend = gate.promise;
    const host = new FakeHost();
    const store = new AssistantConversationStore(host, api, storage, () => "44444444-4444-4444-8444-000000000010", () => DEVICE);
    await store.setUser(USER_A);
    host.emit(turn("44444444-4444-4444-8444-000000000002", "Delete me"));
    await vi.waitFor(() => expect(api.appends).toBe(1));
    const id = store.getSnapshot().currentId;
    if (!id) throw new Error("expected a conversation");
    const deleting = store.delete(id);
    await vi.waitFor(() => expect(api.deletes.length).toBeGreaterThan(0));
    gate.resolve();
    await deleting;
    await vi.waitFor(() => expect(api.messages).toEqual([]));
    expect(readPending(storage, USER_A)).toEqual([]);
    expect(store.getSnapshot().currentId).toBeNull();
  });

  it("stores an interrupted reply and ignores a stale open from the previous account", async () => {
    const storage = memory();
    const api = new FakeApi();
    const host = new FakeHost();
    let next = 20;
    const ids = () => `44444444-4444-4444-8444-${String(++next).padStart(12, "0")}`;
    const store = new AssistantConversationStore(host, api, storage, ids, () => DEVICE);
    await store.setUser(USER_A);
    host.emit(turn(ids(), "Cut off", "interrupted"));
    await vi.waitFor(() => expect(store.getSnapshot().save).toBe("saved"));
    expect(api.messages[0]?.status).toBe("interrupted");

    const conversationId = store.getSnapshot().currentId;
    if (!conversationId) throw new Error("expected a conversation");
    writeOpenConversation(storage, USER_A, conversationId);
    const gate = deferred();
    api.delayGet = gate.promise;
    const other = new FakeHost();
    const second = new AssistantConversationStore(other, api, storage, ids, () => DEVICE);
    const loading = second.setUser(USER_A);
    await vi.waitFor(() => expect(api.gets).toBeGreaterThan(0));
    const switching = second.setUser(USER_B);
    gate.resolve();
    await loading;
    await switching;
    expect(other.turns).toEqual([]);
  });
});

describe("one producer across devices", () => {
  const thread = "44444444-4444-4444-8444-000000000100";
  const userLine = "44444444-4444-4444-8444-000000000101";
  const answer = "44444444-4444-4444-8444-000000000102";

  function pair(storageA: KeyValueStorage = memory(), storageB: KeyValueStorage = memory()) {
    const api = new FakeApi();
    const hostA = new FakeHost();
    const hostB = new FakeHost();
    const laptop = new AssistantConversationStore(hostA, api, storageA, () => thread, () => DEVICE);
    const phone = new AssistantConversationStore(hostB, api, storageB, () => thread, () => DEVICE_B);
    laptop.setDeviceLabel((id) => (id === DEVICE ? "Laptop" : id === DEVICE_B ? "Phone" : null));
    phone.setDeviceLabel((id) => (id === DEVICE ? "Laptop" : id === DEVICE_B ? "Phone" : null));
    return { api, hostA, hostB, laptop, phone, storageA, storageB };
  }

  it("ignores an out-of-order older lease snapshot after takeover", async () => {
    const { laptop, hostA, api } = pair();
    await laptop.setUser(USER_A);
    await laptop.produce();
    expect(laptop.getSnapshot().holding).toBe(true);
    const id = laptop.getSnapshot().currentId;
    if (!id) throw new Error("expected conversation");
    const current = await api.get(USER_A, id);
    const stale = {
      ...current,
      fence: Math.max(0, current.fence - 1),
      leaseDeviceId: DEVICE_B,
    };
    // Exercise the state transition directly to model an out-of-order response.
    (laptop as unknown as { observeLease: (value: typeof current) => void }).observeLease(stale);
    expect(laptop.getSnapshot().holding).toBe(true);
    expect(hostA.status).not.toBe("IDLE");
  });

  it("lets a second device read the thread without starting its microphone", async () => {
    const { api, hostA, hostB, laptop, phone } = pair();
    await laptop.setUser(USER_A);
    await phone.setUser(USER_A);
    await laptop.produce();
    expect(hostA.starts).toBe(1);
    hostA.emit(turn(userLine, "Hello from the laptop"));
    await vi.waitFor(() => expect(api.messages).toHaveLength(1));
    const id = laptop.getSnapshot().currentId;
    if (!id) throw new Error("expected a conversation");
    phone.open(id);
    await vi.waitFor(() => expect(hostB.turns.map((item) => item.text)).toEqual(["Hello from the laptop"]));
    expect(hostB.starts).toBe(0);
    expect(phone.getSnapshot().holding).toBe(false);
    expect(phone.getSnapshot().activeLabel).toBe("Laptop");
    expect(laptop.getSnapshot().holding).toBe(true);
  });

  it("parks a late assistant line after takeover and still saves the user's words", async () => {
    const storageA = memory();
    const { api, hostA, hostB, laptop, phone } = pair(storageA);
    const gate = deferred();
    api.delayAppend = gate.promise;
    await laptop.setUser(USER_A);
    await phone.setUser(USER_A);
    await laptop.produce();
    hostA.emit(reply(answer, "Stale answer"));
    hostA.emit(turn(userLine, "What I said"));
    await vi.waitFor(() => expect(api.appends).toBe(1));
    await phone.produce();
    await laptop.catchUp();
    expect(hostA.status).toBe("IDLE");
    gate.resolve();
    await vi.waitFor(() => expect(laptop.getSnapshot().recovery.map((line) => line.text)).toEqual(["Stale answer"]));
    await vi.waitFor(() => expect(api.messages.map((message) => message.body)).toEqual(["What I said"]));
    hostB.end();
    await phone.catchUp();
    expect(hostB.turns.map((item) => item.text)).toEqual(["What I said"]);
    expect(readRecovery(storageA, USER_A).map((line) => line.text)).toEqual(["Stale answer"]);
    await laptop.setUser(USER_B);
    expect(laptop.getSnapshot().recovery).toEqual([]);
    expect(readRecovery(storageA, USER_B)).toEqual([]);
    expect(readAssistantCache(storageA, USER_B)?.threads ?? []).toEqual([]);
    expect(readRecovery(storageA, USER_A).map((line) => line.text)).toEqual(["Stale answer"]);
  });

  it("drops a deleted thread on the other device and after an offline reconnect", async () => {
    const storage = memory();
    const { api, hostA, hostB, laptop, phone } = pair(storage, storage);
    await laptop.setUser(USER_A);
    await laptop.produce();
    hostA.emit(turn(userLine, "Shared line"));
    await vi.waitFor(() => expect(laptop.getSnapshot().save).toBe("saved"));
    const id = laptop.getSnapshot().currentId;
    if (!id) throw new Error("expected a conversation");
    await phone.setUser(USER_A);
    phone.open(id);
    await vi.waitFor(() => expect(hostB.turns).toHaveLength(1));

    api.failReads = true;
    const offline = new FakeHost();
    const cached = new AssistantConversationStore(offline, api, storage, () => thread, () => DEVICE);
    await cached.setUser(USER_A);
    expect(cached.getSnapshot().offlineCopy).toBe(true);
    expect(cached.getSnapshot().conversations.map((row) => row.id)).toContain(id);

    api.failReads = false;
    await laptop.delete(id);
    await phone.catchUp();
    expect(phone.getSnapshot().conversations.map((row) => row.id)).not.toContain(id);
    expect(hostB.turns).toEqual([]);

    api.failReads = true;
    const laterHost = new FakeHost();
    const later = new AssistantConversationStore(laterHost, api, storage, () => thread, () => DEVICE);
    await later.setUser(USER_A);
    expect(later.getSnapshot().conversations.map((row) => row.id)).not.toContain(id);
    expect(readAssistantCache(storage, USER_A)?.threads.map((row) => row.id) ?? []).not.toContain(id);
  });

  it("re-reads when the change feed fires after subscribe", async () => {
    const api = new FakeApi();
    const hostA = new FakeHost();
    const hostB = new FakeHost();
    const bell: { ring: (() => void) | null } = { ring: null };
    const feed = {
      subscribe(userId: string, onChange: () => void) {
        if (userId === USER_A) bell.ring = onChange;
        return () => { if (bell.ring === onChange) bell.ring = null; };
      },
    };
    const laptop = new AssistantConversationStore(hostA, api, memory(), () => thread, () => DEVICE, feed);
    const phone = new AssistantConversationStore(hostB, api, memory(), () => thread, () => DEVICE_B, feed);
    await laptop.setUser(USER_A);
    await phone.setUser(USER_A);
    await laptop.produce();
    const id = laptop.getSnapshot().currentId;
    if (!id) throw new Error("expected a conversation");
    phone.open(id);
    await vi.waitFor(() => expect(api.gets).toBeGreaterThan(0));
    hostA.emit(turn(userLine, "Caught up"));
    await vi.waitFor(() => expect(api.messages).toHaveLength(1));
    bell.ring?.();
    await vi.waitFor(() => expect(hostB.turns.map((item) => item.text)).toEqual(["Caught up"]));
  });

  it("auto-selects the latest saved account conversation on another device and restores its context", async () => {
    const api = new FakeApi();
    const threadId = "44444444-4444-4444-8444-000000000510";
    await api.create(USER_A, { id: threadId, title: "Cross device project" });
    await api.append(USER_A, {
      id: "44444444-4444-4444-8444-000000000511",
      conversationId: threadId, role: "user", status: "final",
      body: "Continue planning the voice workflow.", sourceDeviceId: DEVICE,
    });
    const host = new FakeHost();
    const phone = new AssistantConversationStore(host, api, memory(),
      () => "44444444-4444-4444-8444-000000000512", () => DEVICE_B);
    await phone.setUser(USER_A);
    expect(phone.getSnapshot().currentId).toBe(threadId);
    expect(host.turns.map((item) => item.text)).toContain("Continue planning the voice workflow.");
    await phone.produce();
    expect(host.seeded.map((item) => item.text).join(" ")).toContain("Continue planning the voice workflow.");
  });

  it("waits for initial transcript hydration and deduplicates simultaneous start requests", async () => {
    const api = new FakeApi();
    const threadId = "44444444-4444-4444-8444-000000000520";
    await api.create(USER_A, { id: threadId, title: "Recover me" });
    await api.append(USER_A, {
      id: "44444444-4444-4444-8444-000000000521",
      conversationId: threadId, role: "user", status: "final",
      body: "This conversation must resume.", sourceDeviceId: DEVICE,
    });
    const wait = deferred();
    api.delayGet = wait.promise;
    const host = new FakeHost();
    const store = new AssistantConversationStore(host, api, memory(),
      () => "44444444-4444-4444-8444-000000000522", () => DEVICE);
    const loading = store.setUser(USER_A);
    const first = store.produce();
    const second = store.produce();
    expect(first).toBe(second);
    expect(host.starts).toBe(0);
    wait.resolve();
    await Promise.all([loading, first, second]);
    expect(host.starts).toBe(1);
    expect(host.seeded.map((item) => item.text).join(" ")).toContain("This conversation must resume.");
  });

  it("continues an older saved thread and appends new turns there, not to the previous thread", async () => {
    const api = new FakeApi();
    const firstId = "44444444-4444-4444-8444-000000000610";
    const olderId = "44444444-4444-4444-8444-000000000611";
    await api.create(USER_A, { id: firstId, title: "Current chat" });
    await api.create(USER_A, { id: olderId, title: "Older chat" });
    await api.append(USER_A, { id: "44444444-4444-4444-8444-000000000612",
      conversationId: olderId, role: "user", status: "final",
      body: "Original project details", sourceDeviceId: DEVICE });
    const host = new FakeHost();
    const store = new AssistantConversationStore(host, api, memory(),
      () => "44444444-4444-4444-8444-000000000615", () => DEVICE);
    await store.setUser(USER_A);
    await store.produce();
    expect(store.getSnapshot().currentId).toBe(firstId);
    await store.continueThread(olderId);
    expect(store.getSnapshot().currentId).toBe(olderId);
    expect(host.starts).toBe(2);
    expect(host.seeded.map((item) => item.text).join(" ")).toContain("Original project details");
    host.emit(turn("44444444-4444-4444-8444-000000000616", "Add this to our older project."));
    await vi.waitFor(() => expect(api.messages.some((item) => item.body === "Add this to our older project.")).toBe(true));
    expect(api.messages.find((item) => item.body === "Add this to our older project.")?.conversationId).toBe(olderId);
    expect(api.messages.filter((item) => item.conversationId === firstId)).toHaveLength(0);
  });

  it("cannot switch to a different account's conversation or mutate the active thread", async () => {
    const api = new FakeApi();
    const own = "44444444-4444-4444-8444-000000000620";
    const foreign = "44444444-4444-4444-8444-000000000621";
    await api.create(USER_A, { id: own, title: "Own chat" });
    await api.create(USER_B, { id: foreign, title: "Private chat" });
    const host = new FakeHost();
    const store = new AssistantConversationStore(host, api, memory(),
      () => "44444444-4444-4444-8444-000000000622", () => DEVICE);
    await store.setUser(USER_A);
    await store.produce();
    const initialStarts = host.starts;
    await expect(store.continueThread(foreign)).rejects.toThrow();
    expect(store.getSnapshot().currentId).toBe(own);
    expect(host.starts).toBe(initialStarts);
    expect(host.status).toBe("READY");
  });

  it("seeds the next fresh session from the saved line", async () => {
    const { api, hostA, laptop } = pair();
    await laptop.setUser(USER_A);
    await laptop.produce();
    hostA.end();
    hostA.emit(turn(userLine, "Meet on Friday."));
    await vi.waitFor(() => expect(api.messages).toHaveLength(1));
    await laptop.produce();
    expect(hostA.seeded.map((item) => item.text).join("\n")).toContain("Meet on Friday.");
    expect(hostA.starts).toBe(2);
    laptop.startThread();
    expect(hostA.seeded).toEqual([]);
  });

  it("notifies learning only after a finalized user line is stored", async () => {
    const saved: string[] = [];
    const host = new FakeHost();
    const api = new FakeApi();
    const store = new AssistantConversationStore(host, api, memory(), () => "44444444-4444-4444-8444-000000000010", () => DEVICE);
    store.setOnUserSaved((item) => { saved.push(item.messageId); });
    await store.setUser(USER_A);
    const spoken = turn("44444444-4444-4444-8444-000000000011", "I prefer short answers.");
    host.emit(spoken);
    await vi.waitFor(() => expect(saved).toEqual([spoken.id]));
    host.emit(reply("44444444-4444-4444-8444-000000000012", "Okay."));
    const cut = turn("44444444-4444-4444-8444-000000000013", "I prefer short answers.", "interrupted");
    host.emit(cut);
    await vi.waitFor(() => expect(api.messages.some((item) => item.id === cut.id)).toBe(true));
    expect(saved).toEqual([spoken.id]);
  });
});
