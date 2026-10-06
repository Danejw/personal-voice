import type { NotesApi } from "@/services/notesService";
import type { Note, NoteSourceType, NoteStatus } from "@/notes/note";

export type NotesStatus = "signed-out" | "loading" | "synced" | "offline";

export interface NotesSnapshot {
  status: NotesStatus;
  notes: Note[];
  error: string | null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function newestFirst(notes: Note[]): Note[] {
  return [...notes].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** Account-scoped notes with explicit refresh and simple online mutations. */
export class NotesStore {
  private snapshot: NotesSnapshot = { status: "signed-out", notes: [], error: null };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private generation = 0;

  constructor(
    private api: NotesApi,
    private sourceDeviceId: (userId: string) => string,
    private onCreated?: (sourceType: NoteSourceType) => void,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NotesSnapshot => this.snapshot;

  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    if (!userId) {
      this.publish({ status: "signed-out", notes: [], error: null });
      return;
    }
    this.publish({ status: "loading", notes: [], error: null });
    await this.load(userId, this.generation);
  }

  /** Reloads notes created or changed on another device. */
  async reload(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "loading", error: null });
    await this.load(userId, generation);
  }

  /** Saves one note and returns only after Supabase confirms it. */
  async create(text: string, sourceType: NoteSourceType = "manual"): Promise<void> {
    const userId = this.requireConnected();
    const body = text.trim();
    if (!body) throw new Error("An empty note cannot be saved.");
    const generation = this.generation;
    try {
      const note = await this.api.create(userId, body, this.sourceDeviceId(userId), sourceType);
      try { this.onCreated?.(sourceType); } catch { /* usage must not fail note save */ }
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          notes: newestFirst([note, ...this.snapshot.notes.filter((entry) => entry.id !== note.id)]),
          error: null,
        });
      }
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  async updateText(id: string, text: string): Promise<void> {
    this.requireConnected();
    const body = text.trim();
    if (!body) throw new Error("A note cannot be empty.");
    const generation = this.generation;
    try {
      const updated = await this.api.updateText(id, body);
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          notes: this.snapshot.notes.map((note) => note.id === id ? updated : note),
          error: null,
        });
      }
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    this.requireConnected();
    const generation = this.generation;
    const status: NoteStatus = archived ? "archived" : "inbox";
    try {
      const updated = await this.api.setStatus(id, status);
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          notes: this.snapshot.notes.map((note) => note.id === id ? updated : note),
          error: null,
        });
      }
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  async remove(id: string): Promise<void> {
    this.requireConnected();
    const generation = this.generation;
    try {
      await this.api.delete(id);
      if (generation === this.generation) {
        this.publish({
          status: "synced",
          notes: this.snapshot.notes.filter((note) => note.id !== id),
          error: null,
        });
      }
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  private requireConnected(): string {
    if (!this.userId) throw new Error("Sign in to save and sync notes.");
    if (this.snapshot.status !== "synced") {
      throw new Error("Notes are unavailable until sync reconnects.");
    }
    return this.userId;
  }

  private async load(userId: string, generation: number): Promise<void> {
    try {
      const notes = await this.api.list(userId);
      if (generation !== this.generation) return;
      this.publish({ status: "synced", notes: newestFirst(notes), error: null });
    } catch (reason) {
      if (generation !== this.generation) return;
      this.publish({ status: "offline", notes: this.snapshot.notes, error: messageOf(reason) });
    }
  }

  private reportMutationFailure(generation: number, reason: unknown): void {
    if (generation !== this.generation) return;
    this.publish({ ...this.snapshot, error: messageOf(reason) });
  }

  private publish(next: NotesSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
