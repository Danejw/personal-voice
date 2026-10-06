import { describe, expect, it, vi } from "vitest";
import { NotesStore } from "@/notes/NotesStore";
import type { Note } from "@/notes/note";
import type { NotesApi } from "@/services/notesService";

interface StoredNote extends Note {
  userId: string;
}

/** Shared in-memory Supabase used by independent Windows and Android stores. */
function fakeServer() {
  let sequence = 0;
  let notes: StoredNote[] = [];
  const control = { offline: false, failCreate: false };
  const guard = () => {
    if (control.offline) throw new Error("Couldn't reach the sync service. Check your connection.");
  };
  const api: NotesApi = {
    async list(userId) {
      guard();
      return structuredClone(notes.filter((note) => note.userId === userId));
    },
    async create(userId, text, sourceDeviceId, sourceType) {
      guard();
      if (control.failCreate) throw new Error("Saving the note failed.");
      sequence += 1;
      const createdAt = new Date(Date.UTC(2026, 8, 28, 12, 0, sequence)).toISOString();
      const note: StoredNote = {
        id: `note-${sequence}`,
        userId,
        text,
        sourceDeviceId,
        sourceType,
        status: "inbox",
        createdAt,
        updatedAt: createdAt,
      };
      notes.push(note);
      return structuredClone(note);
    },
    async updateText(id, text) {
      guard();
      const note = notes.find((entry) => entry.id === id);
      if (!note) throw new Error("Note not found.");
      note.text = text;
      note.updatedAt = new Date(Date.UTC(2026, 8, 28, 13, 0, sequence)).toISOString();
      return structuredClone(note);
    },
    async setStatus(id, status) {
      guard();
      const note = notes.find((entry) => entry.id === id);
      if (!note) throw new Error("Note not found.");
      note.status = status;
      note.updatedAt = new Date(Date.UTC(2026, 8, 28, 13, 0, sequence)).toISOString();
      return structuredClone(note);
    },
    async delete(id) {
      guard();
      notes = notes.filter((note) => note.id !== id);
    },
  };
  return { api, control };
}

describe("NotesStore", () => {
  it("creates voice, manual, and Assistant notes across devices", async () => {
    const server = fakeServer();
    const windows = new NotesStore(server.api, () => "windows-device");
    const android = new NotesStore(server.api, () => "android-device");
    await Promise.all([windows.setUser("user-1"), android.setUser("user-1")]);

    await windows.create("From dictation.", "voice");
    await windows.create("Typed note.", "manual");
    await android.create("Assistant note.", "assistant");
    await android.reload();

    expect(android.getSnapshot().notes.map((note) => [note.text, note.sourceType])).toEqual([
      ["Assistant note.", "assistant"],
      ["Typed note.", "manual"],
      ["From dictation.", "voice"],
    ]);
  });

  it("edits, archives, restores, and deletes a note", async () => {
    const server = fakeServer();
    const store = new NotesStore(server.api, () => "device-1");
    await store.setUser("user-1");
    await store.create("Original.");
    const id = store.getSnapshot().notes[0]?.id ?? "";

    await store.updateText(id, "Edited.");
    expect(store.getSnapshot().notes[0]?.text).toBe("Edited.");
    await store.setArchived(id, true);
    expect(store.getSnapshot().notes[0]?.status).toBe("archived");
    await store.setArchived(id, false);
    expect(store.getSnapshot().notes[0]?.status).toBe("inbox");
    await store.remove(id);
    expect(store.getSnapshot().notes).toEqual([]);
  });

  it("records the creation source without letting usage failure break saving", async () => {
    const server = fakeServer();
    const onCreated = vi.fn(() => { throw new Error("usage failed"); });
    const store = new NotesStore(server.api, () => "device-1", onCreated);
    await store.setUser("user-1");
    await store.create("Keep this.", "voice");
    expect(onCreated).toHaveBeenCalledWith("voice");
    expect(store.getSnapshot().notes).toHaveLength(1);
  });

  it("surfaces load and save failures without inventing a local note", async () => {
    const server = fakeServer();
    const store = new NotesStore(server.api, () => "device-1");
    server.control.offline = true;
    await store.setUser("user-1");
    expect(store.getSnapshot()).toMatchObject({ status: "offline", notes: [] });
    await expect(store.create("Offline.")).rejects.toThrow("Notes are unavailable");

    server.control.offline = false;
    await store.reload();
    server.control.failCreate = true;
    await expect(store.create("Do not lose this.")).rejects.toThrow("Saving the note failed.");
    expect(store.getSnapshot()).toMatchObject({
      status: "synced",
      notes: [],
      error: "Saving the note failed.",
    });
  });
});
