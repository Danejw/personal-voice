import type { AssistantStatus, AssistantTurn } from "@/assistant/state";
import type { AssistantChangeFeed } from "@/assistant/assistantFeed";
import {
  restoreAssistantContext,
  type ContextAttachment,
  type ContextMessage,
} from "@/assistant/contextRestore";
import {
  ASSISTANT_DEFAULT_TITLE,
  conversationTitleFrom,
  citationsFromSources,
  dropConversation,
  enqueuePending,
  pendingWriteFromTurn,
  readAssistantCache,
  readOpenConversation,
  readPending,
  readRecovery,
  turnsFromStored,
  writeAssistantCache,
  writeOpenConversation,
  writePending,
  writeRecovery,
  type PendingAssistantWrite,
  type RecoveredAssistantLine,
} from "@/assistant/conversationRecord";
import { ASSISTANT_LEASE_RENEW_MS, ASSISTANT_LEASE_TTL_SECONDS, leaseIsCurrent } from "@/assistant/lease";
import {
  ASSISTANT_PAGE_LIMIT,
  ASSISTANT_PAGE_SIZE,
  AssistantStorageError,
  prepareAssistantTitle,
  type AssistantMessageInput,
  type AssistantStoredMessage,
  type AssistantConversation,
} from "@/services/assistantConversations";
import type { AssistantConversationsApi } from "@/services/assistantConversationsService";
import type { KeyValueStorage } from "@/sync/personalCache";

export type AssistantSaveState = "idle" | "saving" | "saved" | "retry";

export interface AssistantLibraryConversation {
  id: string;
  title: string;
}

export interface AssistantLibrarySnapshot {
  conversations: AssistantLibraryConversation[];
  currentId: string | null;
  save: AssistantSaveState;
  error: string | null;
  holding: boolean;
  activeLabel: string | null;
  offlineCopy: boolean;
  recovery: RecoveredAssistantLine[];
  summaryNote: string | null;
  unavailableScreenshots: { source: string; capturedAt: string }[];
}

/** The Assistant screen methods this store is allowed to drive. */
export interface AssistantTranscriptHost {
  getSnapshot(): {
    status: AssistantStatus;
    turns: readonly AssistantTurn[];
    selection: { text: string; sourceApp?: string; capturedAt: string } | null;
    notes: readonly { id: string; text: string; createdAt: string }[];
    handoff: { id: string; text: string; createdAt: string; sourceLabel: string } | null;
    screen: { source: "window" | "screen"; sourceApp?: string; capturedAt: string } | null;
  };
  start(): void;
  end(): void;
  showSaved(turns: AssistantTurn[]): void;
  subscribe(listener: (snapshot: { status: AssistantStatus }) => void): () => void;
  setCommittedTurnHandler(handler: ((turn: AssistantTurn) => void) | null): void;
  setTurnRevisionHandler(handler: ((turn: AssistantTurn) => void) | null): void;
  setSavedHistory(turns: readonly { role: "user" | "model"; text: string }[]): void;
  setToolRecordHandler(handler: ((record: { name: string; outcome: string }) => void) | null): void;
}

const EMPTY: AssistantLibrarySnapshot = {
  conversations: [],
  currentId: null,
  save: "idle",
  error: null,
  holding: false,
  activeLabel: null,
  offlineCopy: false,
  recovery: [],
  summaryNote: null,
  unavailableScreenshots: [],
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Couldn't save that conversation.";
}

function sameCitations(left: readonly { url: string; title: string }[], right: readonly { url: string; title: string }[]): boolean {
  return left.length === right.length && left.every((citation, index) => citation.url === right[index]?.url && citation.title === right[index]?.title);
}

/**
 * Saves finalized Assistant turns for one account and reopens the last thread.
 * A Gemini session is not the database. A new session is seeded from the saved rows once.
 */
export class AssistantConversationStore {
  private snapshot: AssistantLibrarySnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private initializing: Promise<void> = Promise.resolve();
  private producing: Promise<void> | null = null;
  private generation = 0;
  private currentId: string | null = null;
  private conversations: AssistantLibraryConversation[] = [];
  private titles = new Map<string, string>();
  private pending: PendingAssistantWrite[] = [];
  private deleted = new Set<string>();
  private ensured = new Set<string>();
  private save: AssistantSaveState = "idle";
  private error: string | null = null;
  private flushing = false;
  private flushAgain = false;
  private holding = false;
  private fence: number | null = null;
  private expiresAt: string | null = null;
  private activeDeviceId: string | null = null;
  private recovery: RecoveredAssistantLine[] = [];
  private offlineCopy = false;
  private wasLive = false;
  private feedStop: (() => void) | null = null;
  private catchTimer: ReturnType<typeof setTimeout> | undefined;
  private renewTimer: ReturnType<typeof setTimeout> | undefined;
  private deviceLabel: (deviceId: string) => string | null = () => null;
  private summaryNote: string | null = null;
  private unavailableScreenshots: { source: string; capturedAt: string }[] = [];
  private contextKey = "";
  private onUserSaved: ((saved: { conversationId: string; messageId: string }) => void) | null = null;

  constructor(
    private host: AssistantTranscriptHost,
    private api: AssistantConversationsApi,
    private storage: KeyValueStorage,
    private createId: () => string,
    private deviceId: (userId: string) => string,
    private feed: AssistantChangeFeed = { subscribe: () => () => undefined },
    private now: () => number = () => Date.now(),
  ) {
    this.host.setCommittedTurnHandler((turn) => this.accept(turn));
    this.host.setTurnRevisionHandler((turn) => this.revise(turn));
    this.host.setToolRecordHandler((record) => { void this.rememberTool(record); });
    this.host.subscribe((snapshot) => this.onStatus(snapshot.status));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AssistantLibrarySnapshot => this.snapshot;

  /** True while this device's lease is still inside the server expiry. */
  holdingLease(): boolean {
    return this.holdsNow();
  }

  /**
   * Called after a finalized user line is stored. Interrupted, assistant, and tool lines are not passed.
   * A conversation deleted before the write finishes does not call this.
   */
  setOnUserSaved(handler: ((saved: { conversationId: string; messageId: string }) => void) | null): void {
    this.onUserSaved = handler;
  }

  /** Names for the active-device line. Unknown ids stay "another device". */
  setDeviceLabel(label: (deviceId: string) => string | null): void {
    this.deviceLabel = label;
    this.publish();
  }

  /** Drops a reply that was not merged into the shared thread. */
  dismissRecovery(id: string): void {
    const userId = this.userId;
    if (!userId) return;
    this.recovery = this.recovery.filter((line) => line.id !== id);
    try {
      writeRecovery(this.storage, userId, this.recovery);
    } catch {
      this.error = "Couldn't keep that message on this device.";
    }
    this.publish();
  }

  /**
   * Follows the signed-in account. Call this after the live session has already ended,
   * so the last unfinished line is saved on the account that spoke it.
   */
  setUser(userId: string | null): Promise<void> {
    const task = this.hydrateUser(userId);
    this.initializing = task;
    return task;
  }

  private async hydrateUser(userId: string | null): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.userId = userId;
    this.deleted.clear();
    this.ensured.clear();
    this.titles.clear();
    this.error = null;
    this.stopFeed();
    this.clearRenew();
    this.holding = false;
    this.fence = null;
    this.expiresAt = null;
    this.activeDeviceId = null;
    this.recovery = [];
    this.offlineCopy = false;
    this.wasLive = false;
    this.summaryNote = null;
    this.unavailableScreenshots = [];
    this.contextKey = "";
    if (!userId) {
      this.currentId = null;
      this.pending = [];
      this.conversations = [];
      this.save = "idle";
      this.host.showSaved([]);
      this.host.setSavedHistory([]);
      this.publish();
      return;
    }
    this.pending = readPending(this.storage, userId);
    this.currentId = readOpenConversation(this.storage, userId);
    for (const item of this.pending) this.titles.set(item.conversationId, item.title);
    this.conversations = [];
    this.save = this.pending.length ? "saving" : "idle";
    this.recovery = readRecovery(this.storage, userId);
    this.host.showSaved([]);
    this.host.setSavedHistory([]);
    this.publish();
    this.feedStop = this.feed.subscribe(userId, () => this.scheduleCatchUp());
    await this.reloadList(userId, generation);
    if (!this.sameAccount(userId, generation)) return;
    // A different device may have the most recent thread. Prefer it only when this
    // device has not already saved an explicit selection or new-thread intent.
    if (!this.currentId && this.conversations.length) {
      this.currentId = this.conversations[0]!.id;
      writeOpenConversation(this.storage, userId, this.currentId);
    }
    if (this.currentId) await this.load(this.currentId, generation);
    if (this.sameAccount(userId, generation)) void this.flush();
  }

  /** Starts an empty thread. An open live session is ended first so its last line stays on the previous thread. */
  startThread(): void {
    const userId = this.userId;
    if (!userId) return;
    if (this.host.getSnapshot().status !== "IDLE") this.host.end();
    this.generation += 1;
    const id = this.createId();
    this.currentId = id;
    this.titles.set(id, ASSISTANT_DEFAULT_TITLE);
    writeOpenConversation(this.storage, userId, id);
    this.host.showSaved([]);
    this.host.setSavedHistory([]);
    this.error = null;
    this.publish();
  }

  /**
   * Claims the conversation and then starts the microphone.
   * Opening a thread does not call this. Continue here is the explicit takeover.
   */
  produce(): Promise<void> {
    if (this.producing) return this.producing;
    const task = this.produceLoaded(this.userId, this.initializing);
    this.producing = task;
    void task.finally(() => { if (this.producing === task) this.producing = null; }).catch(() => undefined);
    return task;
  }

  private async produceLoaded(expectedUser: string | null, loading: Promise<void>): Promise<void> {
    await loading;
    // Ignore a delayed Start from an account that signed out while history loaded.
    if (!expectedUser || this.userId !== expectedUser) return;
    const userId = expectedUser;
    if (!this.currentId) this.startThread();
    const id = this.currentId;
    if (!id || this.userId !== userId) return;
    const generation = this.generation;
    const deviceId = this.deviceId(userId);
    try {
      await this.api.create(userId, { id, title: this.titles.get(id) ?? ASSISTANT_DEFAULT_TITLE });
      if (!this.sameView(userId, id, generation)) return;
      const claimed = await this.api.claim(userId, id, deviceId, {
        ttlSeconds: ASSISTANT_LEASE_TTL_SECONDS,
        takeover: true,
      });
      if (!this.sameView(userId, id, generation)) {
        if (claimed.acquired) {
          await this.api.release(userId, id, deviceId, claimed.conversation.fence).catch(() => undefined);
        }
        return;
      }
      this.observeLease(claimed.conversation);
      if (!claimed.acquired || !this.holdsNow()) {
        this.error = "Another device is still continuing this conversation.";
        this.publish();
        return;
      }
      this.ensured.add(id);
      this.error = null;
      this.armRenew();
      if (!this.sessionLive()) {
        await this.prepareContext(userId, id, claimed.conversation.summary, claimed.conversation.contextItems);
        if (!this.sameView(userId, id, generation)) return;
        this.host.start();
      }
      this.publish();
    } catch (error) {
      if (!this.sameAccount(userId, generation)) return;
      this.error = messageOf(error);
      this.publish();
    }
  }

  /** Re-reads the saved rows. A realtime event, resume, or reconnect only schedules this. */
  async catchUp(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    const generation = this.generation;
    await this.reloadList(userId, generation);
    if (!this.sameAccount(userId, generation)) return;
    if (!this.currentId) return;
    if (this.sessionLive() && this.holdsNow()) {
      await this.renew();
      return;
    }
    await this.load(this.currentId, generation);
  }

  /** Opens a saved thread. Stale loads cannot replace a newer thread or another account. */
  open(id: string): void {
    const userId = this.userId;
    if (!userId || id === this.currentId) return;
    if (this.host.getSnapshot().status !== "IDLE") this.host.end();
    this.generation += 1;
    const generation = this.generation;
    this.currentId = id;
    writeOpenConversation(this.storage, userId, id);
    this.host.showSaved([]);
    this.host.setSavedHistory([]);
    this.publish();
    void this.load(id, generation);
  }

  /** Renames a thread. A thread that is not on the server yet keeps the title for its first create. */
  async rename(id: string, title: string): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    let next: string;
    try {
      next = prepareAssistantTitle(title);
    } catch (error) {
      this.error = messageOf(error);
      this.publish();
      return;
    }
    const generation = this.generation;
    this.titles.set(id, next);
    this.pending = this.pending.map((entry) => entry.conversationId === id ? { ...entry, title: next } : entry);
    this.persistPending(userId);
    this.publish();
    const onServer = this.ensured.has(id) || this.conversations.some((row) => row.id === id);
    if (!onServer) return;
    try {
      const conversation = await this.api.rename(userId, id, next);
      if (!this.sameAccount(userId, generation)) return;
      this.titles.set(id, conversation.title);
      this.ensured.add(id);
      this.error = null;
      await this.reloadList(userId, generation);
    } catch (error) {
      if (!this.sameAccount(userId, generation)) return;
      this.error = messageOf(error);
      this.publish();
    }
  }

  /**
   * Deletes a thread. Queued writes for that id are not sent, and an append already in flight
   * deletes the thread again so it cannot put the text back.
   */
  async delete(id: string): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    const current = this.currentId === id;
    if (current && this.host.getSnapshot().status !== "IDLE") this.host.end();
    this.deleted.add(id);
    if (current) {
      this.generation += 1;
      this.currentId = null;
      writeOpenConversation(this.storage, userId, null);
      this.host.showSaved([]);
    }
    this.dropCached(userId, id);
    this.conversations = this.conversations.filter((row) => row.id !== id);
    this.publish();
    const generation = this.generation;
    try {
      await this.api.delete(userId, id);
      if (this.userId !== userId) return;
      this.forgetConversation(userId, id);
    } catch (error) {
      if (this.userId !== userId) return;
      if (error instanceof AssistantStorageError && (error.code === "not-found" || error.code === "deleted")) {
        this.forgetConversation(userId, id);
        return;
      }
      this.deleted.delete(id);
      this.error = messageOf(error);
      this.publish();
      await this.reloadList(userId, generation);
      void this.flush();
    }
  }

  /** Sends the account queue again after a failure. A retry uses the same message ids. */
  retry(): void {
    if (!this.userId || !this.pending.length) return;
    this.save = "saving";
    this.error = null;
    this.publish();
    void this.flush();
  }

  /** Stores one committed turn on the thread that was current when it finished. */
  private accept(turn: AssistantTurn): void {
    const userId = this.userId;
    if (!userId) return;
    if (!this.currentId) {
      this.currentId = this.createId();
      this.titles.set(this.currentId, ASSISTANT_DEFAULT_TITLE);
      writeOpenConversation(this.storage, userId, this.currentId);
    }
    const conversationId = this.currentId;
    if (this.deleted.has(conversationId)) return;
    if (turn.role === "assistant" && !this.holdsNow()) {
      if (this.holding) this.loseLease();
      this.parkLine(turn.id, "assistant", turn.text);
      return;
    }
    const title = this.titleForTurn(conversationId, turn);
    const item = pendingWriteFromTurn({
      userId,
      conversationId,
      title,
      sourceDeviceId: this.deviceId(userId),
      turn,
      fence: turn.role === "assistant" ? this.fence : null,
    });
    if (!item) return;
    this.pending = enqueuePending(this.pending, item);
    this.persistPending(userId);
    this.save = "saving";
    this.error = null;
    this.publish();
    void this.flush();
    if (turn.role === "user") void this.persistContext();
  }
  private revise(turn: AssistantTurn): void {
    const userId = this.userId;
    if (!userId) return;
    const index = this.pending.findIndex((entry) => entry.message.id === turn.id);
    const current = index >= 0 ? this.pending[index] : undefined;
    if (!current) return;
    const citations = citationsFromSources(turn.sources ?? []);
    if (sameCitations(current.message.citations, citations)) return;
    const next: PendingAssistantWrite = { ...current, message: { ...current.message, citations } };
    this.pending = this.pending.map((entry, position) => position === index ? next : entry);
    this.persistPending(userId);
  }

  private titleForTurn(conversationId: string, turn: AssistantTurn): string {
    const current = this.titles.get(conversationId) ?? ASSISTANT_DEFAULT_TITLE;
    const next = turn.role === "user" && current === ASSISTANT_DEFAULT_TITLE ? conversationTitleFrom(turn.text) : current;
    this.titles.set(conversationId, next);
    return next;
  }

  private async load(id: string, generation: number): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    const seenTitle = this.titles.get(id) ?? null;
    try {
      const conversation = await this.api.get(userId, id);
      if (!this.sameView(userId, id, generation)) return;
      const messages = await this.readMessages(userId, id);
      if (!this.sameView(userId, id, generation)) return;
      if ((this.titles.get(id) ?? null) === seenTitle) this.titles.set(id, conversation.title);
      this.ensured.add(id);
      this.offlineCopy = false;
      // A delayed GET may carry an older fence than our successful takeover.
      // Never let stale reads revoke an actively held producer lease.
      if (!(this.holding && this.fence !== null && conversation.fence < this.fence)) {
        this.observeLease(conversation);
      }
      const pending = this.pending.filter((entry) => {
        if (entry.userId !== userId || entry.conversationId !== id) return false;
        if (entry.message.role === "user") return true;
        return this.holdsNow() && entry.message.fence === this.fence;
      });
      if (!(this.sessionLive() && this.holdsNow())) {
        this.host.showSaved(turnsFromStored(messages, pending));
      }
      this.rememberCache(userId);
      this.error = null;
      this.publish();
    } catch (error) {
      if (!this.sameView(userId, id, generation)) return;
      if (error instanceof AssistantStorageError && (error.code === "not-found" || error.code === "deleted")) {
        this.currentId = null;
        writeOpenConversation(this.storage, userId, null);
        this.host.showSaved([]);
        this.dropCached(userId, id);
      } else {
        this.restoreCachedThread(userId, id);
      }
      this.error = messageOf(error);
      this.publish();
    }
  }

  private async readMessages(userId: string, conversationId: string): Promise<AssistantStoredMessage[]> {
    const all: AssistantStoredMessage[] = [];
    let afterSeq = 0;
    for (let page = 0; page < 50; page += 1) {
      const batch = await this.api.listMessages(userId, conversationId, { limit: ASSISTANT_PAGE_LIMIT, afterSeq });
      all.push(...batch);
      const last = batch.at(-1);
      if (batch.length < ASSISTANT_PAGE_LIMIT || !last) break;
      afterSeq = last.seq;
    }
    return all.sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id));
  }

  private async reloadList(userId: string, generation: number): Promise<void> {
    try {
      const rows = await this.api.list(userId, { limit: ASSISTANT_PAGE_SIZE });
      if (!this.sameAccount(userId, generation)) return;
      this.conversations = rows.map((row) => {
        this.ensured.add(row.id);
        if (!this.titles.has(row.id)) this.titles.set(row.id, row.title);
        return { id: row.id, title: this.titles.get(row.id) ?? row.title };
      });
      this.offlineCopy = false;
      this.rememberCache(userId);
      this.publish();
    } catch (error) {
      if (!this.sameAccount(userId, generation)) return;
      if (!this.conversations.length) {
        const cached = readAssistantCache(this.storage, userId);
        if (cached?.threads.length) {
          this.conversations = cached.threads.map((thread) => {
            this.titles.set(thread.id, thread.title);
            return { id: thread.id, title: thread.title };
          });
          this.offlineCopy = true;
          if (this.currentId) this.restoreCachedThread(userId, this.currentId);
        }
        this.error = this.offlineCopy ? null : messageOf(error);
        this.publish();
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    let failed = false;
    try {
      while (this.userId) {
        const index = this.pending.findIndex((entry) => entry.userId === this.userId && !this.deleted.has(entry.conversationId));
        const item = index >= 0 ? this.pending[index] : undefined;
        if (!item || item.userId !== this.userId) break;
        try {
          await this.writeItem(item);
        } catch (error) {
          if (this.userId !== item.userId) break;
          if (error instanceof AssistantStorageError && (error.code === "deleted" || error.code === "not-found")) {
            this.deleted.add(item.conversationId);
            this.ack(item.userId, item.message.id);
            continue;
          }
          if (error instanceof AssistantStorageError && error.code === "lost") {
            this.parkWrite(item);
            this.ack(item.userId, item.message.id);
            if (this.userId === item.userId && this.holding) this.loseLease();
            continue;
          }
          failed = true;
          this.save = "retry";
          this.error = messageOf(error);
          this.publish();
          return;
        }
      }
      if (this.userId && !this.pending.length && this.save === "saving") {
        this.save = "saved";
        this.error = null;
        this.publish();
        void this.reloadList(this.userId, this.generation);
      }
    } finally {
      this.flushing = false;
      if (!failed && this.flushAgain) {
        this.flushAgain = false;
        void this.flush();
      } else {
        this.flushAgain = false;
      }
    }
  }

  /** Create is idempotent, then append is idempotent, so a crash after the server commit can be retried. */
  private async writeItem(item: PendingAssistantWrite): Promise<void> {
    const userId = item.userId;
    if (this.deleted.has(item.conversationId)) return;
    const title = this.titleFor(item);
    const created = await this.api.create(userId, { id: item.conversationId, title });
    if (this.deleted.has(item.conversationId)) {
      await this.api.delete(userId, item.conversationId);
      return;
    }
    const desired = this.titleFor(item);
    if (!created.created && created.conversation.title !== desired) {
      await this.api.rename(userId, item.conversationId, desired);
    }
    if (this.deleted.has(item.conversationId)) {
      await this.api.delete(userId, item.conversationId);
      return;
    }
    const latest = this.latest(item);
    if (latest.message.role !== "user" && latest.message.fence === null) {
      this.parkWrite(latest);
      this.ack(userId, latest.message.id);
      return;
    }
    await this.api.append(userId, messageInput(latest));
    if (this.deleted.has(item.conversationId)) {
      await this.api.delete(userId, item.conversationId);
      this.ack(userId, item.message.id);
      return;
    }
    this.ack(userId, item.message.id);
    if (this.userId === userId) this.ensured.add(item.conversationId);
    if (this.userId === userId && latest.message.role === "user" && latest.message.status !== "interrupted") {
      this.onUserSaved?.({ conversationId: item.conversationId, messageId: latest.message.id });
    }
  }

  private titleFor(item: PendingAssistantWrite): string {
    if (this.userId === item.userId) return this.titles.get(item.conversationId) ?? item.title;
    const stored = readPending(this.storage, item.userId).find((entry) => entry.conversationId === item.conversationId);
    return stored?.title ?? item.title;
  }

  private latest(item: PendingAssistantWrite): PendingAssistantWrite {
    if (this.userId === item.userId) {
      return this.pending.find((entry) => entry.message.id === item.message.id) ?? item;
    }
    return readPending(this.storage, item.userId).find((entry) => entry.message.id === item.message.id) ?? item;
  }

  private ack(userId: string, messageId: string): void {
    if (this.userId === userId) {
      const next = this.pending.filter((entry) => entry.message.id !== messageId);
      try {
        writePending(this.storage, userId, next);
      } catch {
        this.error = "Couldn't keep that message on this device.";
        this.save = "retry";
        this.publish();
        return;
      }
      this.pending = next;
      return;
    }
    const stored = readPending(this.storage, userId).filter((entry) => entry.message.id !== messageId);
    try {
      writePending(this.storage, userId, stored);
    } catch {
      // The other account still has the write. Signing back in retries the same id.
    }
  }

  private persistPending(userId: string): void {
    try {
      writePending(this.storage, userId, this.pending);
    } catch {
      this.error = "Couldn't keep that message on this device.";
      this.save = "retry";
    }
  }

  /** Removes a deleted thread's queue only after that removal is stored. */
  private forgetConversation(userId: string, id: string): void {
    const next = dropConversation(this.pending, id);
    try {
      writePending(this.storage, userId, next);
    } catch {
      this.error = "Couldn't keep that message on this device.";
      this.save = "retry";
      this.publish();
      return;
    }
    this.pending = next;
    this.titles.delete(id);
    if (!this.pending.length && this.save === "saving") this.save = "idle";
    this.publish();
  }

  /**
   * Builds the seed for a fresh session from the saved rows.
   * A later resume of that same session does not call this again.
   */
  private async prepareContext(
    userId: string,
    id: string,
    summary: AssistantConversation["summary"],
    items: readonly ContextAttachment[],
  ): Promise<void> {
    const stored = await this.readMessages(userId, id);
    const seen = new Set(stored.map((message) => message.id));
    let seq = stored.at(-1)?.seq ?? 0;
    const pending = this.pending.filter((entry) => entry.userId === userId && entry.conversationId === id && !seen.has(entry.message.id));
    const messages: ContextMessage[] = [
      ...stored.map((message) => ({
        id: message.id,
        seq: message.seq,
        role: message.role,
        status: message.status,
        body: message.body,
        toolName: message.toolName,
        toolOutcome: message.toolOutcome,
      })),
      ...pending.map((entry) => {
        seq += 1;
        return {
          id: entry.message.id,
          seq,
          role: entry.message.role,
          status: entry.message.status,
          body: entry.message.body,
        };
      }),
    ];
    const snap = this.host.getSnapshot();
    const live = {
      noteIds: snap.notes.map((note) => note.id),
      hasSelection: Boolean(snap.selection),
      handoffId: snap.handoff?.id ?? null,
      hasScreen: Boolean(snap.screen),
    };
    let restored = restoreAssistantContext({ messages, summary, attachments: items, live });
    let note = restored.recovery;
    if (restored.summary) {
      try {
        const saved = await this.api.saveSummary(userId, id, restored.summary, summary?.fingerprint ?? null);
        const winner = saved.conversation.summary;
        if (!saved.saved && winner && winner.fingerprint !== restored.summary.fingerprint) {
          restored = restoreAssistantContext({ messages, summary: winner, attachments: items, live });
          note = restored.recovery;
        }
      } catch (error) {
        if (error instanceof AssistantStorageError && error.code === "conflict") {
          const again = await this.api.get(userId, id);
          const second = restoreAssistantContext({
            messages,
            summary: again.summary,
            attachments: again.contextItems,
            live,
          });
          if (second.summaryState === "used") {
            restored = second;
            note = second.recovery;
          } else {
            note = "Another summary was saved. Recent messages are still included.";
          }
        } else {
          note = "Couldn't save the conversation summary. Recent messages are still used.";
        }
      }
    }
    this.summaryNote = note;
    this.unavailableScreenshots = restored.unavailableScreenshots;
    this.host.setSavedHistory(restored.turns);
    void this.persistContext();
  }

  /** Saves the attachments on screen so another device can describe them. Screenshots keep no pixels. */
  private async persistContext(): Promise<void> {
    const userId = this.userId;
    const id = this.currentId;
    if (!userId || !id) return;
    const items = contextItemsFrom(this.host.getSnapshot());
    const key = JSON.stringify(items);
    if (key === this.contextKey) return;
    try {
      await this.api.saveContextItems(userId, id, items);
      if (this.userId === userId && this.currentId === id) this.contextKey = key;
    } catch (error) {
      if (this.userId !== userId) return;
      if (error instanceof AssistantStorageError && error.code === "rejected") {
        this.summaryNote = "One attachment could not be saved for the next device.";
      } else {
        this.summaryNote = "Couldn't save attached notes for the next device.";
      }
      this.publish();
    }
  }

  /** Writes a finished tool result. It explains the past and is not a request to do it again. */
  private async rememberTool(record: { name: string; outcome: string }): Promise<void> {
    const userId = this.userId;
    const id = this.currentId;
    const outcome = record.outcome.trim();
    if (!userId || !id || !outcome || !/^[a-z][a-z0-9_]{0,63}$/.test(record.name)) return;
    if (!this.holdsNow() || this.fence === null) {
      this.parkLine(this.createId(), "assistant", `Already finished: ${record.name}. ${outcome}`);
      return;
    }
    try {
      await this.api.append(userId, {
        id: this.createId(),
        conversationId: id,
        role: "tool",
        status: "final",
        body: outcome,
        sourceDeviceId: this.deviceId(userId),
        toolName: record.name,
        toolOutcome: outcome,
        fence: this.fence,
      });
    } catch (error) {
      if (this.userId !== userId) return;
      if (error instanceof AssistantStorageError && error.code === "lost") this.loseLease();
      this.parkLine(this.createId(), "assistant", `Already finished: ${record.name}. ${outcome}`);
    }
  }

  private sameAccount(userId: string, generation: number): boolean {
    return this.userId === userId && this.generation === generation;
  }

  private sessionLive(): boolean {
    const status = this.host.getSnapshot().status;
    return status === "CONNECTING" || status === "READY" || status === "RESPONDING";
  }

  private holdsNow(): boolean {
    return this.holding && leaseIsCurrent({
      leaseDeviceId: this.deviceId(this.userId ?? ""),
      leaseExpiresAt: this.expiresAt,
      deviceId: this.userId ? this.deviceId(this.userId) : "",
      now: this.now(),
    });
  }

  private labelFor(deviceId: string | null): string | null {
    if (!deviceId || !this.userId) return null;
    if (deviceId === this.deviceId(this.userId)) return "this device";
    return this.deviceLabel(deviceId) ?? "another device";
  }

  private observeLease(conversation: AssistantConversation): void {
    const ours = this.userId ? this.deviceId(this.userId) : "";
    const expiry = conversation.leaseExpiresAt ? Date.parse(conversation.leaseExpiresAt) : Number.NaN;
    const fresh = Number.isFinite(expiry) && expiry > this.now();
    this.activeDeviceId = fresh ? conversation.leaseDeviceId : null;
    const current = leaseIsCurrent({
      leaseDeviceId: conversation.leaseDeviceId,
      leaseExpiresAt: conversation.leaseExpiresAt,
      deviceId: ours,
      now: this.now(),
    });
    if (current) {
      this.holding = true;
      this.fence = conversation.fence;
      this.expiresAt = conversation.leaseExpiresAt;
      return;
    }
    if (this.holding && this.fence !== null && conversation.fence < this.fence) {
      // Out-of-order feed / refresh result after this device took ownership.
      return;
    }
    if (this.holding) this.loseLease();
  }

  /** Stops this device's live session. A late reply is kept locally and is not written as the shared answer. */
  private loseLease(): void {
    this.holding = false;
    this.fence = null;
    this.expiresAt = null;
    this.clearRenew();
    if (this.sessionLive()) this.host.end();
    this.publish();
  }

  private async renew(): Promise<void> {
    const userId = this.userId;
    const id = this.currentId;
    const fence = this.fence;
    if (!userId || !id || fence === null || !this.holding) return;
    const generation = this.generation;
    try {
      const claimed = await this.api.claim(userId, id, this.deviceId(userId), {
        ttlSeconds: ASSISTANT_LEASE_TTL_SECONDS,
        takeover: false,
      });
      if (!this.sameView(userId, id, generation) || !this.holding) return;
      if (!claimed.acquired || claimed.conversation.fence !== fence) {
        this.observeLease(claimed.conversation);
        return;
      }
      this.expiresAt = claimed.conversation.leaseExpiresAt;
      this.armRenew();
      this.publish();
    } catch {
      if (this.expiresAt && Date.parse(this.expiresAt) <= this.now()) this.loseLease();
    }
  }

  private async releaseHeld(): Promise<void> {
    const userId = this.userId;
    const id = this.currentId;
    const fence = this.fence;
    const deviceId = userId ? this.deviceId(userId) : "";
    this.holding = false;
    this.fence = null;
    this.expiresAt = null;
    this.clearRenew();
    this.publish();
    if (!userId || !id || fence === null) return;
    await this.api.release(userId, id, deviceId, fence).catch(() => undefined);
  }

  private onStatus(status: AssistantStatus): void {
    const live = status === "CONNECTING" || status === "READY" || status === "RESPONDING";
    if (this.wasLive && !live && this.holding) void this.releaseHeld();
    this.wasLive = live;
  }

  private armRenew(): void {
    this.clearRenew();
    this.renewTimer = setTimeout(() => {
      void this.renew();
    }, ASSISTANT_LEASE_RENEW_MS);
    unrefTimer(this.renewTimer);
  }

  private clearRenew(): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = undefined;
  }

  private stopFeed(): void {
    this.feedStop?.();
    this.feedStop = null;
    if (this.catchTimer) clearTimeout(this.catchTimer);
    this.catchTimer = undefined;
  }

  private scheduleCatchUp(): void {
    if (this.catchTimer) clearTimeout(this.catchTimer);
    this.catchTimer = setTimeout(() => {
      this.catchTimer = undefined;
      void this.catchUp();
    }, 200);
    unrefTimer(this.catchTimer);
  }

  private parkLine(id: string, role: "user" | "assistant", text: string): void {
    const userId = this.userId;
    const body = text.trim();
    if (!userId || !body || this.recovery.some((line) => line.id === id)) return;
    this.recovery = [...this.recovery, { id, role, text: body }].slice(-20);
    try {
      writeRecovery(this.storage, userId, this.recovery);
    } catch {
      this.error = "Couldn't keep that message on this device.";
    }
    this.publish();
  }

  private parkWrite(item: PendingAssistantWrite): void {
    if (item.message.role === "user") return;
    if (this.userId !== item.userId) {
      const stored = readRecovery(this.storage, item.userId);
      if (stored.some((line) => line.id === item.message.id)) return;
      try {
        writeRecovery(this.storage, item.userId, [...stored, {
          id: item.message.id,
          role: "assistant" as const,
          text: item.message.body,
        }].slice(-20));
      } catch {
        // Signing back into that account still has the pending line until it is parked.
      }
      return;
    }
    const role = item.message.role;
    this.parkLine(item.message.id, role, item.message.body);
  }

  private rememberCache(userId: string): void {
    const existing = readAssistantCache(this.storage, userId);
    const threads = this.conversations
      .filter((row) => !this.deleted.has(row.id))
      .map((row) => ({ id: row.id, title: this.titles.get(row.id) ?? row.title }));
    let transcripts = existing?.transcripts.filter((thread) => !this.deleted.has(thread.id)) ?? [];
    if (this.currentId && !this.deleted.has(this.currentId)) {
      const turns = this.host.getSnapshot().turns
        .filter((turn) => turn.role === "user" || turn.role === "assistant")
        .map((turn) => ({
          id: turn.id,
          role: turn.role,
          text: turn.text,
          ...(turn.status === "interrupted" ? { status: "interrupted" as const } : {}),
        }));
      transcripts = [...transcripts.filter((thread) => thread.id !== this.currentId), { id: this.currentId, turns }];
    }
    try {
      writeAssistantCache(this.storage, userId, { threads, transcripts });
    } catch {
      // The cache is a convenience. The server copy remains the history.
    }
  }

  private restoreCachedThread(userId: string, id: string): void {
    if (this.sessionLive()) return;
    const cached = readAssistantCache(this.storage, userId);
    const transcript = cached?.transcripts.find((thread) => thread.id === id);
    if (!transcript) return;
    this.offlineCopy = true;
    this.host.showSaved(transcript.turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      text: turn.text,
      ...(turn.status === "interrupted" ? { status: "interrupted" as const } : {}),
    })));
  }

  private dropCached(userId: string, id: string): void {
    const cached = readAssistantCache(this.storage, userId);
    if (!cached) return;
    try {
      writeAssistantCache(this.storage, userId, {
        threads: cached.threads.filter((thread) => thread.id !== id),
        transcripts: cached.transcripts.filter((thread) => thread.id !== id),
      });
    } catch {
      // A later successful list rewrites the cache without this thread.
    }
  }

  private sameView(userId: string, id: string, generation: number): boolean {
    return this.sameAccount(userId, generation) && this.currentId === id;
  }

  private publish(): void {
    const rows = this.conversations.map((row) => ({ id: row.id, title: this.titles.get(row.id) ?? row.title }));
    if (this.currentId && !rows.some((row) => row.id === this.currentId)) {
      rows.unshift({ id: this.currentId, title: this.titles.get(this.currentId) ?? ASSISTANT_DEFAULT_TITLE });
    }
    this.snapshot = {
      conversations: rows,
      currentId: this.currentId,
      save: this.save,
      error: this.error,
      holding: this.holdsNow(),
      activeLabel: this.labelFor(this.activeDeviceId),
      offlineCopy: this.offlineCopy,
      recovery: this.recovery,
      summaryNote: this.summaryNote,
      unavailableScreenshots: this.unavailableScreenshots,
    };
    for (const listener of this.listeners) listener();
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}

function messageInput(item: PendingAssistantWrite): AssistantMessageInput {
  return {
    id: item.message.id,
    conversationId: item.conversationId,
    role: item.message.role,
    status: item.message.status,
    body: item.message.body,
    sourceDeviceId: item.message.sourceDeviceId,
    citations: item.message.citations,
    fence: item.message.fence,
  };
}

const CONTEXT_ID = /^[A-Za-z0-9-]{1,80}$/;

function contextItemsFrom(snapshot: {
  selection: { text: string; sourceApp?: string; capturedAt: string } | null;
  notes: readonly { id: string; text: string; createdAt: string }[];
  handoff: { id: string; text: string; createdAt: string; sourceLabel: string } | null;
  screen: { source: "window" | "screen"; capturedAt: string } | null;
}): ContextAttachment[] {
  const items: ContextAttachment[] = [];
  const selection = snapshot.selection?.text.trim();
  if (selection) {
    items.push({
      kind: "selection",
      id: "selection",
      body: selection.slice(0, 8000),
      capturedAt: snapshot.selection?.capturedAt ?? "",
      source: (snapshot.selection?.sourceApp ?? "").slice(0, 120),
    });
  }
  for (const note of snapshot.notes) {
    const body = note.text.trim();
    if (!CONTEXT_ID.test(note.id) || !body) continue;
    items.push({
      kind: "note",
      id: note.id,
      body: body.slice(0, 8000),
      capturedAt: note.createdAt,
      source: "",
    });
  }
  const handoff = snapshot.handoff?.text.trim();
  if (snapshot.handoff && handoff && CONTEXT_ID.test(snapshot.handoff.id)) {
    items.push({
      kind: "handoff",
      id: snapshot.handoff.id,
      body: handoff.slice(0, 8000),
      capturedAt: snapshot.handoff.createdAt,
      source: snapshot.handoff.sourceLabel.slice(0, 120),
    });
  }
  if (snapshot.screen) {
    items.push({
      kind: "screenshot",
      id: "screenshot",
      body: "",
      capturedAt: snapshot.screen.capturedAt,
      source: snapshot.screen.source,
    });
  }
  return items;
}
