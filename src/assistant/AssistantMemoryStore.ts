import { createId } from "@/sync/createId";
import {
  memorySuppressed,
  planMemoryForget,
  planMemoryWrite,
  prepareMemoryKey,
  prepareMemoryKind,
  prepareMemoryValue,
  type AssistantMemory,
  type MemoryKind,
} from "@/assistant/memory";
import { LEARN_BATCH, classifyTurn } from "@/assistant/memoryLearn";
import {
  AssistantMemoryError,
  type ForgetMemoryInput,
  type RememberMemoryInput,
} from "@/services/assistantMemories";
import type { AssistantMemoriesApi } from "@/services/assistantMemoriesService";
import type { AssistantChangeFeed } from "@/assistant/assistantFeed";

const CACHE_PREFIX = "assistant.memory.v1.";

export interface MemorySnapshot {
  userId: string | null;
  memories: AssistantMemory[];
  offline: boolean;
  error: string | null;
  saving: boolean;
}

const EMPTY: MemorySnapshot = {
  userId: null,
  memories: [],
  offline: false,
  error: null,
  saving: false,
};

/**
 * The signed-in account's explicit memories.
 * The model hears the last list that the server confirmed. A cached copy is
 * only for the screen when the network is down, and is not injected.
 */
export class AssistantMemoryStore {
  private userId: string | null = null;
  private generation = 0;
  private memories: AssistantMemory[] = [];
  private offline = false;
  private error: string | null = null;
  private saving = false;
  private learning = false;
  private remoteLearn: (() => Promise<boolean>) | null = null;
  private learningTask: Promise<void> = Promise.resolve();
  private snapshot: MemorySnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private api: AssistantMemoriesApi,
    private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    private feed: AssistantChangeFeed,
    private onInject: (rows: readonly AssistantMemory[]) => void,
    private conversationId: () => string | null,
    private newId: () => string = createId,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MemorySnapshot => this.snapshot;

  /** Loads one account and drops the previous account's rows from the session. */
  async setUser(userId: string | null): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.userId = userId;
    this.memories = [];
    this.offline = false;
    this.error = null;
    this.saving = false;
    this.publish();
    this.onInject([]);
    if (!userId) return;
    this.unsubscribe = this.feed.subscribe(userId, () => {
      void this.refresh();
    });
    await this.refresh(generation);
  }

  /** Re-reads the account. A failed read keeps the last confirmed list for the model. */
  async refresh(generation = this.generation): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    try {
      const rows = await this.api.list(userId);
      if (!this.same(userId, generation)) return;
      this.memories = rows;
      this.offline = false;
      this.error = null;
      this.writeCache(userId, rows);
      this.publish();
      this.onInject(rows);
    } catch (error) {
      if (!this.same(userId, generation)) return;
      this.offline = true;
      this.error = messageOf(error);
      if (!this.memories.length) this.memories = readCache(this.storage, userId);
      this.publish();
    }
  }

  /** Text for list_memories. Forgotten rows are named so the model does not teach them again. */
  async listText(): Promise<string> {
    await this.refresh();
    return formatMemoryList(this.memories);
  }

  /** Stores a new explicit memory, or replaces an extracted guess. */
  async remember(kind: MemoryKind, key: string, value: string): Promise<string> {
    return this.write("remember", kind, key, value);
  }

  /** Replaces the active value when the revision still matches. */
  async change(key: string, value: string): Promise<string> {
    return this.write("change", "preference", key, value);
  }

  /** Marks the active row forgotten. The source conversation stays. */
  async forget(key: string): Promise<string> {
    const userId = this.requireUser();
    const parsed = prepareMemoryKey(key);
    if ("error" in parsed) throw new Error(parsed.error);
    const active = this.active(parsed.key);
    const plan = planMemoryForget(active, active?.revision ?? null);
    if (!plan.ok) throw new Error(plan.reason === "conflict" ? "Another device changed that preference." : "That preference is not remembered.");
    if (!active) throw new Error("That preference is not remembered.");
    this.saving = true;
    this.publish();
    try {
      const rows = await this.api.forget(userId, { key: parsed.key, expectedRevision: active.revision });
      if (this.userId !== userId) return "Signed out.";
      this.accept(userId, rows);
      return `Forgot ${parsed.key}. It will not be used in a new session.`;
    } catch (error) {
      await this.refresh();
      throw new Error(messageOf(error), { cause: error });
    } finally {
      if (this.userId === userId) {
        this.saving = false;
        this.publish();
      }
    }
  }

  /** Account switch. Off, `learn` does not read messages. Explicit remember still works. */
  setLearning(enabled: boolean): void {
    this.learning = enabled;
  }

  /**
   * Optional edge function. A true result means the server already committed.
   * Any failure falls back to the local classifier and the same commit RPC.
   */
  setRemoteLearn(learn: (() => Promise<boolean>) | null): void {
    this.remoteLearn = learn;
  }

  /**
   * Reads one batch of finalized user lines saved after learning was turned on.
   * Does nothing while the switch is off. A second call for the same line is a no-op on the server.
   */
  async learn(): Promise<void> {
    if (!this.learning || !this.userId) return;
    const run = this.learningTask.then(() => this.runLearn());
    this.learningTask = run.then(() => undefined, () => undefined);
    await run;
  }

  /** Promotes a candidate. An explicit value at that key stays as it is. */
  async keepCandidate(id: string): Promise<string> {
    const userId = this.requireUser();
    const row = this.memories.find((item) => item.id === id && item.status === "candidate");
    if (!row) throw new Error("That suggestion is no longer available.");
    this.saving = true;
    this.publish();
    try {
      const rows = await this.api.settleCandidate(userId, id, true);
      if (this.userId !== userId) return "Signed out.";
      this.accept(userId, rows);
      const kept = rows.find((item) => item.id === id && item.status === "active");
      return kept ? `Kept ${row.key}.` : "The saved preference stayed.";
    } catch (error) {
      await this.refresh();
      throw new Error(messageOf(error), { cause: error });
    } finally {
      if (this.userId === userId) {
        this.saving = false;
        this.publish();
      }
    }
  }

  /** Forgets a candidate so that key is not learned again. */
  async dismissCandidate(id: string): Promise<string> {
    const userId = this.requireUser();
    const row = this.memories.find((item) => item.id === id && item.status === "candidate");
    if (!row) throw new Error("That suggestion is no longer available.");
    this.saving = true;
    this.publish();
    try {
      const rows = await this.api.settleCandidate(userId, id, false);
      if (this.userId !== userId) return "Signed out.";
      this.accept(userId, rows);
      return `Removed ${row.key}. It will not be learned again.`;
    } catch (error) {
      await this.refresh();
      throw new Error(messageOf(error), { cause: error });
    } finally {
      if (this.userId === userId) {
        this.saving = false;
        this.publish();
      }
    }
  }

  /** Whether passive learning from that conversation is still blocked. */
  suppressed(key: string, sourceConversationId: string | null): boolean {
    const parsed = prepareMemoryKey(key);
    if ("error" in parsed) return false;
    return memorySuppressed(this.memories, parsed.key, sourceConversationId);
  }

  private async write(mode: "remember" | "change", kind: MemoryKind, key: string, value: string): Promise<string> {
    const userId = this.requireUser();
    const parsedKey = prepareMemoryKey(key);
    if ("error" in parsedKey) throw new Error(parsedKey.error);
    const parsedValue = prepareMemoryValue(value);
    if ("error" in parsedValue) throw new Error(parsedValue.error);
    const parsedKind = prepareMemoryKind(kind);
    if ("error" in parsedKind) throw new Error(parsedKind.error);
    const active = this.active(parsedKey.key);
    const keptKind = mode === "change" && active ? active.kind : parsedKind.kind;
    const plan = planMemoryWrite(active, mode, active?.revision ?? null);
    if (!plan.ok) {
      throw new Error(plan.reason === "exists"
        ? "That preference is already remembered. Change it instead."
        : plan.reason === "conflict"
          ? "Another device changed that preference."
          : "That preference is not remembered.");
    }
    const input: RememberMemoryInput = {
      id: this.newId(),
      kind: keptKind,
      key: parsedKey.key,
      value: parsedValue.value,
      sourceConversationId: this.conversationId(),
      sourceMessageId: null,
      replace: plan.supersede,
      expectedRevision: active?.revision ?? null,
    };
    this.saving = true;
    this.publish();
    try {
      const rows = await this.api.remember(userId, input);
      if (this.userId !== userId) return "Signed out.";
      this.accept(userId, rows);
      return mode === "change"
        ? `Changed ${parsedKey.key} to ${parsedValue.value}`
        : `Remembered ${parsedKey.key}: ${parsedValue.value}`;
    } catch (error) {
      await this.refresh();
      throw new Error(messageOf(error), { cause: error });
    } finally {
      if (this.userId === userId) {
        this.saving = false;
        this.publish();
      }
    }
  }

  private async runLearn(): Promise<void> {
    if (!this.learning) return;
    const userId = this.userId;
    if (!userId) return;
    const remote = this.remoteLearn;
    if (remote) {
      try {
        const done = await remote();
        if (this.userId !== userId) return;
        if (done) {
          await this.refresh();
          return;
        }
      } catch {
        // The function is not deployed, or it failed before commit. The local path still writes the job.
      }
    }
    if (this.userId !== userId || !this.learning) return;
    try {
      const batch = await this.api.listLearningBatch(userId);
      if (this.userId !== userId || !this.learning) return;
      if (!batch.length) return;
      const rows = await this.api.commitLearning(userId, batch.slice(0, LEARN_BATCH).map((item) => ({
        id: item.id,
        evidences: classifyTurn(item.body).map((proposal) => proposal.evidence),
      })));
      if (this.userId !== userId) return;
      this.accept(userId, rows);
    } catch (error) {
      if (this.userId !== userId) return;
      this.error = messageOf(error);
      this.publish();
    }
  }

  private accept(userId: string, rows: AssistantMemory[]): void {
    this.memories = rows;
    this.offline = false;
    this.error = null;
    this.writeCache(userId, rows);
    this.publish();
    this.onInject(rows);
  }

  private active(key: string): AssistantMemory | null {
    return this.memories.find((row) => row.status === "active" && row.key === key) ?? null;
  }

  private requireUser(): string {
    if (!this.userId) throw new Error("Sign in to use memories.");
    return this.userId;
  }

  private same(userId: string, generation: number): boolean {
    return this.userId === userId && this.generation === generation;
  }

  private writeCache(userId: string, rows: readonly AssistantMemory[]): void {
    this.storage.setItem(`${CACHE_PREFIX}${userId}`, JSON.stringify(rows));
  }

  private publish(): void {
    this.snapshot = {
      userId: this.userId,
      memories: this.memories,
      offline: this.offline,
      error: this.error,
      saving: this.saving,
    };
    for (const listener of this.listeners) listener();
  }
}

/** Active rows, then forgotten keys, so a list does not teach a forgotten preference. */
export function formatMemoryList(rows: readonly AssistantMemory[]): string {
  const active = rows.filter((row) => row.status === "active").sort((left, right) => left.key.localeCompare(right.key));
  const forgotten = rows.filter((row) => row.status === "forgotten");
  const forgottenKeys = [...new Set(forgotten.map((row) => row.key))].sort();
  if (!active.length && !forgottenKeys.length) return "No memories are remembered.";
  const lines = active.map((row) => `${row.key} (${row.kind}, ${row.origin}, revision ${row.revision}): ${row.value}`);
  const head = lines.length ? `Remembered (${lines.length}):\n${lines.join("\n")}` : "No active memories.";
  if (!forgottenKeys.length) return head;
  return `${head}\nForgotten and not in use: ${forgottenKeys.join(", ")}. Do not learn these again from the same conversation.`;
}

function readCache(storage: Pick<Storage, "getItem">, userId: string): AssistantMemory[] {
  const raw = storage.getItem(`${CACHE_PREFIX}${userId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as AssistantMemory[];
  } catch {
    return [];
  }
}

function messageOf(error: unknown): string {
  if (error instanceof AssistantMemoryError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Couldn't save that memory.";
}

export type { ForgetMemoryInput };
