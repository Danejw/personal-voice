import type { SnippetsApi } from "@/services/snippetsService";
import type { KeyValueStorage } from "@/sync/personalCache";
import { readSnippetCache, writeSnippetCache } from "@/snippets/snippetCache";
import { normalizeSnippetTrigger, snippetProblem, type Snippet } from "@/snippets/snippet";

export type SnippetStatus = "signed-out" | "loading" | "synced" | "offline";

export interface SnippetSnapshot {
  status: SnippetStatus;
  snippets: Snippet[];
  error: string | null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function newestFirst(snippets: Snippet[]): Snippet[] {
  return [...snippets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)
    || a.trigger.localeCompare(b.trigger, undefined, { sensitivity: "base" }));
}

export class SnippetStore {
  private snapshot: SnippetSnapshot = { status: "signed-out", snippets: [], error: null };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private generation = 0;

  constructor(private api: SnippetsApi, private storage: KeyValueStorage) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SnippetSnapshot => this.snapshot;

  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    if (!userId) {
      this.publish({ status: "signed-out", snippets: [], error: null });
      return;
    }
    const cached = newestFirst(readSnippetCache(this.storage, userId));
    this.publish({ status: "loading", snippets: cached, error: null });
    await this.load(userId, this.generation, cached);
  }

  async reload(): Promise<void> {
    if (!this.userId) return;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "loading", error: null });
    await this.load(this.userId, generation, this.snapshot.snippets);
  }

  async create(trigger: string, content: string): Promise<void> {
    const userId = this.requireConnected();
    const cleanTrigger = trigger.trim().replace(/\s+/g, " ");
    const cleanContent = content.trim();
    this.validate(cleanTrigger, cleanContent);
    const generation = this.generation;
    try {
      const snippet = await this.api.create(userId, cleanTrigger, cleanContent);
      if (generation !== this.generation) return;
      this.commit(userId, newestFirst([snippet, ...this.snapshot.snippets.filter((item) => item.id !== snippet.id)]));
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  async update(id: string, trigger: string, content: string): Promise<void> {
    const userId = this.requireConnected();
    const cleanTrigger = trigger.trim().replace(/\s+/g, " ");
    const cleanContent = content.trim();
    this.validate(cleanTrigger, cleanContent, id);
    const generation = this.generation;
    try {
      const snippet = await this.api.update(id, cleanTrigger, cleanContent);
      if (generation !== this.generation) return;
      this.commit(userId, newestFirst(this.snapshot.snippets.map((item) => item.id === id ? snippet : item)));
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const userId = this.requireConnected();
    const generation = this.generation;
    try {
      const snippet = await this.api.setEnabled(id, enabled);
      if (generation !== this.generation) return;
      this.commit(userId, newestFirst(this.snapshot.snippets.map((item) => item.id === id ? snippet : item)));
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  async remove(id: string): Promise<void> {
    const userId = this.requireConnected();
    const generation = this.generation;
    try {
      await this.api.delete(id);
      if (generation !== this.generation) return;
      this.commit(userId, this.snapshot.snippets.filter((item) => item.id !== id));
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  private validate(trigger: string, content: string, editingId?: string): void {
    const problem = snippetProblem(trigger, content);
    if (problem) throw new Error(problem);
    const normalized = normalizeSnippetTrigger(trigger);
    const duplicate = this.snapshot.snippets.some((snippet) =>
      snippet.id !== editingId && snippet.normalizedTrigger === normalized);
    if (duplicate) throw new Error("A snippet with that voice trigger already exists.");
  }

  private requireConnected(): string {
    if (!this.userId) throw new Error("Sign in to save and sync snippets.");
    if (this.snapshot.status !== "synced") throw new Error("Snippet editing is unavailable until sync reconnects.");
    return this.userId;
  }

  private async load(userId: string, generation: number, cached: Snippet[]) {
    try {
      const snippets = newestFirst(await this.api.list(userId));
      if (generation !== this.generation) return;
      this.commit(userId, snippets);
    } catch (reason) {
      if (generation !== this.generation) return;
      this.publish({ status: "offline", snippets: cached, error: messageOf(reason) });
    }
  }

  private commit(userId: string, snippets: Snippet[]) {
    writeSnippetCache(this.storage, userId, snippets);
    this.publish({ status: "synced", snippets, error: null });
  }

  private reportFailure(generation: number, reason: unknown) {
    if (generation !== this.generation) return;
    this.publish({ ...this.snapshot, error: messageOf(reason) });
  }

  private publish(next: SnippetSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
