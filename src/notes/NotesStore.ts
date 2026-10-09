import type { NotesApi, NotePresentationUpdate, NewNoteDetails } from "@/services/notesService";
import type { Note, NoteSourceType, NoteStatus } from "@/notes/note";
import type { NoteAttachment } from "@/notes/noteAttachment";
import type { NoteGroup } from "@/notes/noteGroup";
import type { NotesOrganizerApi } from "@/notes/noteOrganizer";

export type NotesStatus = "signed-out" | "loading" | "synced" | "offline";

export interface NotesSnapshot {
  status: NotesStatus;
  notes: Note[];
  groups: NoteGroup[];
  error: string | null;
  organizing: boolean;
  organizationError: string | null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function newestFirst(notes: Note[]): Note[] {
  return [...notes].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function groupNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

const EMPTY_SNAPSHOT: NotesSnapshot = {
  status: "signed-out",
  notes: [],
  groups: [],
  error: null,
  organizing: false,
  organizationError: null,
};

/** Account-scoped notes plus conservative, asynchronous AI organization. */
export class NotesStore {
  private snapshot: NotesSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private generation = 0;
  private organizerRunning = false;

  constructor(
    private api: NotesApi,
    private sourceDeviceId: (userId: string) => string,
    private onCreated?: (sourceType: NoteSourceType) => void,
    private organizer?: NotesOrganizerApi,
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
      this.publish(EMPTY_SNAPSHOT);
      return;
    }
    this.publish({ ...EMPTY_SNAPSHOT, status: "loading" });
    await this.load(userId, this.generation);
  }

  /** Reloads notes, groups, and attachment metadata changed on another device. */
  async reload(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "loading", error: null, organizationError: null });
    await this.load(userId, generation);
  }

  /** Saves immediately. Title/group enrichment is best-effort and never blocks the save. */
  async create(text: string, sourceType: NoteSourceType = "manual", details: NewNoteDetails = {}, files: readonly File[] = []): Promise<void> {
    const userId = this.requireConnected();
    const body = text.trim();
    if (!body) throw new Error("An empty note cannot be saved.");
    const title = details.title?.trim();
    if (title && title.length > 120) throw new Error("A note title cannot exceed 120 characters.");
    if (details.groupId && !this.snapshot.groups.some((group) => group.id === details.groupId)) {
      throw new Error("That note group no longer exists.");
    }
    const generation = this.generation;
    try {
      const note = await this.api.create(userId, body, this.sourceDeviceId(userId), sourceType, {
        ...(title ? { title } : {}),
        ...(details.groupId ? { groupId: details.groupId } : {}),
      });
      try { this.onCreated?.(sourceType); } catch { /* usage must not fail note save */ }
      if (generation === this.generation) {
        this.publish({
          ...this.snapshot,
          status: "synced",
          notes: newestFirst([note, ...this.snapshot.notes.filter((entry) => entry.id !== note.id)]),
          error: null,
          organizationError: null,
        });
        this.queueOrganization();
      }
      if (files.length) {
        try {
          await this.addAttachments(note.id, files);
        } catch (error) {
          throw new Error(`Note saved, but attaching its image failed. Find the note in Notes before retrying: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
      }
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  /** Text-only changes preserve a stable title and group. */
  async updateText(id: string, text: string): Promise<void> {
    this.requireConnected();
    const body = text.trim();
    if (!body) throw new Error("A note cannot be empty.");
    const generation = this.generation;
    try {
      const updated = await this.api.updateText(id, body);
      this.replaceNote(generation, id, updated);
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  /** Manual edit owns the title/group so later AI passes cannot fight the user's choice. */
  async updateDetails(id: string, text: string, title: string, groupId: string | null, groupEdited: boolean): Promise<void> {
    this.requireConnected();
    const body = text.trim();
    const cleanTitle = title.trim();
    if (!body) throw new Error("A note cannot be empty.");
    if (!cleanTitle) throw new Error("A note title cannot be empty.");
    if (groupId && !this.snapshot.groups.some((group) => group.id === groupId)) {
      throw new Error("That note group no longer exists.");
    }
    const generation = this.generation;
    try {
      const updated = await this.api.updateDetails(id, body, cleanTitle, groupId, groupEdited);
      this.replaceNote(generation, id, updated);
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  async renameGroup(id: string, name: string): Promise<void> {
    this.requireConnected();
    const clean = name.trim();
    if (!clean) throw new Error("A note group needs a name.");
    const duplicate = this.snapshot.groups.some(
      (group) => group.id !== id && groupNameKey(group.name) === groupNameKey(clean),
    );
    if (duplicate) throw new Error("A note group with that name already exists.");
    const generation = this.generation;
    try {
      const updated = await this.api.renameGroup(id, clean);
      if (generation === this.generation) {
        this.publish({
          ...this.snapshot,
          groups: this.snapshot.groups.map((group) => group.id === id ? updated : group),
          error: null,
        });
      }
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  async addAttachments(noteId: string, files: readonly File[]): Promise<void> {
    const userId = this.requireConnected();
    const generation = this.generation;
    for (const file of files) {
      try {
        const attachment = await this.api.addAttachment(userId, noteId, file);
        if (generation !== this.generation) return;
        this.publish({
          ...this.snapshot,
          status: "synced",
          notes: this.snapshot.notes.map((note) => note.id === noteId
            ? { ...note, attachments: [...note.attachments, attachment] }
            : note),
          error: null,
        });
      } catch (reason) {
        this.reportMutationFailure(generation, reason);
        throw reason;
      }
    }
  }

  async removeAttachment(noteId: string, attachment: NoteAttachment): Promise<void> {
    this.requireConnected();
    const generation = this.generation;
    try {
      await this.api.removeAttachment(attachment);
      if (generation === this.generation) {
        this.publish({
          ...this.snapshot,
          status: "synced",
          notes: this.snapshot.notes.map((note) => note.id === noteId
            ? { ...note, attachments: note.attachments.filter((item) => item.id !== attachment.id) }
            : note),
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
      this.replaceNote(generation, id, updated);
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  async remove(id: string): Promise<void> {
    this.requireConnected();
    const generation = this.generation;
    const note = this.snapshot.notes.find((entry) => entry.id === id);
    try {
      await this.api.delete(id, note?.attachments ?? []);
      if (generation === this.generation) {
        this.publish({
          ...this.snapshot,
          status: "synced",
          notes: this.snapshot.notes.filter((entry) => entry.id !== id),
          error: null,
        });
      }
    } catch (reason) {
      this.reportMutationFailure(generation, reason);
      throw reason;
    }
  }

  private replaceNote(generation: number, id: string, updated: Note): void {
    if (generation !== this.generation) return;
    const current = this.snapshot.notes.find((note) => note.id === id);
    this.publish({
      ...this.snapshot,
      status: "synced",
      notes: this.snapshot.notes.map((note) => note.id === id
        ? { ...updated, attachments: current?.attachments ?? [] }
        : note),
      error: null,
    });
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
      const [notes, groups] = await Promise.all([
        this.api.list(userId),
        this.api.listGroups(userId),
      ]);
      if (generation !== this.generation) return;
      this.publish({
        status: "synced",
        notes: newestFirst(notes),
        groups,
        error: null,
        organizing: this.organizerRunning,
        organizationError: null,
      });
      this.queueOrganization();
    } catch (reason) {
      if (generation !== this.generation) return;
      this.publish({ ...this.snapshot, status: "offline", error: messageOf(reason) });
    }
  }

  private queueOrganization(): void {
    if (!this.organizer) return;
    queueMicrotask(() => { void this.organizePending(); });
  }

  private async organizePending(): Promise<void> {
    const organizer = this.organizer;
    const userId = this.userId;
    if (!organizer || !userId || this.organizerRunning || this.snapshot.status !== "synced") return;

    const pending = this.snapshot.notes.filter((note) => note.title === null || note.organizedAt === null);
    if (!pending.length) return;

    const pendingIds = new Set(pending.map((note) => note.id));
    const context = this.snapshot.notes.filter(
      (note) => !pendingIds.has(note.id) && note.status === "inbox" && note.groupId === null && note.groupSource !== "manual",
    );
    const candidates = [...pending, ...context].slice(0, 40);
    if (!candidates.length) return;

    const generation = this.generation;
    const versions = new Map(candidates.map((note) => [note.id, note.updatedAt]));
    this.organizerRunning = true;
    this.publish({ ...this.snapshot, organizing: true, organizationError: null });

    let succeeded = false;
    try {
      const plan = await organizer.organize(candidates, this.snapshot.groups);
      if (generation !== this.generation || userId !== this.userId) return;

      const currentById = new Map(this.snapshot.notes.map((note) => [note.id, note]));
      const titleById = new Map(plan.titles.map((entry) => [entry.noteId, entry.title]));
      const groupByNote = new Map<string, string>();
      const groups = [...this.snapshot.groups];

      for (const assignment of plan.existingGroupAssignments) {
        const note = currentById.get(assignment.noteId);
        if (!note || note.groupId || note.updatedAt !== versions.get(note.id)) continue;
        if (!groups.some((group) => group.id === assignment.groupId)) continue;
        groupByNote.set(note.id, assignment.groupId);
      }

      for (const suggestion of plan.newGroups) {
        const eligible = [...new Set(suggestion.noteIds)].filter((id) => {
          const note = currentById.get(id);
          return Boolean(note && !note.groupId && note.updatedAt === versions.get(id) && !groupByNote.has(id));
        });
        if (eligible.length < 3) continue;

        let group = groups.find((entry) => groupNameKey(entry.name) === groupNameKey(suggestion.name));
        if (!group) {
          group = await this.api.createGroup(userId, suggestion.name);
          groups.push(group);
        }
        for (const id of eligible) groupByNote.set(id, group.id);
      }

      const organizedAt = new Date().toISOString();
      for (const original of candidates) {
        const current = currentById.get(original.id);
        if (!current || current.updatedAt !== versions.get(original.id)) continue;

        const update: NotePresentationUpdate = { organizedAt };
        const suggestedTitle = titleById.get(original.id)?.trim();
        if (current.title === null && suggestedTitle) {
          update.title = suggestedTitle;
          update.titleSource = "auto";
        }
        const groupId = current.groupId === null ? groupByNote.get(original.id) : undefined;
        if (groupId) {
          update.groupId = groupId;
          update.groupSource = "auto";
        }
        await this.api.updatePresentation(original.id, update);
      }

      succeeded = true;
      await this.load(userId, generation);
    } catch (reason) {
      if (generation === this.generation) {
        this.publish({ ...this.snapshot, organizationError: messageOf(reason) });
      }
    } finally {
      this.organizerRunning = false;
      if (generation === this.generation) {
        this.publish({ ...this.snapshot, organizing: false });
        if (succeeded) this.queueOrganization();
      }
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
