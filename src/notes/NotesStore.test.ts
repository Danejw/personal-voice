import { describe, expect, it, vi } from "vitest";
import { NotesStore } from "@/notes/NotesStore";
import type { Note } from "@/notes/note";
import type { NoteAttachment } from "@/notes/noteAttachment";
import type { NotesApi } from "@/services/notesService";

interface StoredNote extends Note {
  userId: string;
}

/** Shared in-memory Supabase used by independent Windows and Android stores. */
function fakeServer() {
  let sequence = 0;
  let attachmentSequence = 0;
  let notes: StoredNote[] = [];
  const groups: { id: string; name: string; createdAt: string; updatedAt: string }[] = [];
  const control = { offline: false, failCreate: false };
  const guard = () => {
    if (control.offline) throw new Error("Couldn't reach the sync service. Check your connection.");
  };
  const api: NotesApi = {
    async list(userId) {
      guard();
      return structuredClone(notes.filter((note) => note.userId === userId));
    },
    async listGroups() { return structuredClone(groups); },
    async create(userId, text, sourceDeviceId, sourceType, details = {}) {
      guard();
      if (control.failCreate) throw new Error("Saving the note failed.");
      sequence += 1;
      const createdAt = new Date(Date.UTC(2026, 8, 28, 12, 0, sequence)).toISOString();
      const note: StoredNote = {
        id: `note-${sequence}`,
        userId,
        text,
        title: details.title ?? null,
        titleSource: details.title ? "manual" : null,
        groupId: details.groupId ?? null,
        groupSource: details.groupId ? "manual" : null,
        organizedAt: details.title && details.groupId ? createdAt : null,
        sourceDeviceId,
        sourceType,
        status: "inbox",
        createdAt,
        updatedAt: createdAt,
        attachments: [],
      };
      notes.push(note);
      return structuredClone(note);
    },
    async createGroup(_userId, name) {
      const group = { id: `group-${groups.length + 1}`, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      groups.push(group); return structuredClone(group);
    },
    async renameGroup(id, name) { const group = groups.find((g) => g.id === id); if (!group) throw new Error("Group not found."); group.name = name; return structuredClone(group); },
    async updateText(id, text) {
      guard();
      const note = notes.find((entry) => entry.id === id);
      if (!note) throw new Error("Note not found.");
      note.text = text;
      note.updatedAt = new Date(Date.UTC(2026, 8, 28, 13, 0, sequence)).toISOString();
      return structuredClone(note);
    },
    async updateDetails(id, text, title, groupId, groupEdited) { const note = notes.find((n) => n.id === id); if (!note) throw new Error("Note not found."); note.text = text; note.title = title; note.titleSource = "manual"; if (groupEdited) { note.groupId = groupId; note.groupSource = "manual"; note.organizedAt = new Date().toISOString(); } return structuredClone(note); },
    async updatePresentation(id, update) { const note = notes.find((n) => n.id === id); if (!note) throw new Error("Note not found."); if (update.title !== undefined) note.title = update.title; if (update.titleSource !== undefined) note.titleSource = update.titleSource; if (update.groupId !== undefined) note.groupId = update.groupId; if (update.groupSource !== undefined) note.groupSource = update.groupSource; if (update.organizedAt !== undefined) note.organizedAt = update.organizedAt; note.updatedAt = new Date().toISOString(); return structuredClone(note); },
    async addAttachment(_userId, noteId, file) {
      guard();
      const note = notes.find((entry) => entry.id === noteId);
      if (!note) throw new Error("Note not found.");
      attachmentSequence += 1;
      const attachment: NoteAttachment = {
        id: `attachment-${attachmentSequence}`,
        fileName: file.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
        storagePath: `user-1/${noteId}/attachment-${attachmentSequence}/${file.name}`,
        downloadUrl: `https://example.test/attachment-${attachmentSequence}`,
        createdAt: new Date(Date.UTC(2026, 8, 28, 14, 0, attachmentSequence)).toISOString(),
      };
      note.attachments.push(attachment);
      return structuredClone(attachment);
    },
    async removeAttachment(attachment) {
      guard();
      notes = notes.map((note) => ({
        ...note,
        attachments: note.attachments.filter((item) => item.id !== attachment.id),
      }));
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

  it("saves pasted manual notes with optional title and group across devices", async () => {
    const server = fakeServer();
    const windows = new NotesStore(server.api, () => "windows-device");
    const android = new NotesStore(server.api, () => "android-device");
    await Promise.all([windows.setUser("user-1"), android.setUser("user-1")]);
    const group = await server.api.createGroup("user-1", "Research");
    await windows.reload();

    await windows.create("  Copied paragraph.\n\nA second paragraph.  ", "manual", {
      title: "  Read later  ",
      groupId: group.id,
    });
    await android.reload();
    expect(android.getSnapshot().notes[0]).toMatchObject({
      text: "Copied paragraph.\n\nA second paragraph.",
      title: "Read later",
      titleSource: "manual",
      groupId: group.id,
      groupSource: "manual",
      sourceType: "manual",
      organizedAt: expect.any(String),
    });

    await windows.create("No custom title.", "manual");
    expect(windows.getSnapshot().notes[0]).toMatchObject({
      title: null,
      titleSource: null,
      groupId: null,
      groupSource: null,
    });
  });

  it("validates manual note title length and group before saving", async () => {
    const server = fakeServer();
    const store = new NotesStore(server.api, () => "windows-device");
    await store.setUser("user-1");
    await expect(store.create("Body", "manual", { title: "x".repeat(121) }))
      .rejects.toThrow("A note title cannot exceed 120 characters.");
    await expect(store.create("Body", "manual", { groupId: "missing-group" }))
      .rejects.toThrow("That note group no longer exists.");
    expect(store.getSnapshot().notes).toHaveLength(0);
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

  it("adds and removes arbitrary file attachments", async () => {
    const server = fakeServer();
    const store = new NotesStore(server.api, () => "device-1");
    await store.setUser("user-1");
    await store.create("Files live here.");
    const noteId = store.getSnapshot().notes[0]?.id ?? "";
    const file = new File(["# hello"], "notes.md", { type: "text/markdown" });

    await store.addAttachments(noteId, [file]);
    const attachment = store.getSnapshot().notes[0]?.attachments[0];
    expect(attachment).toMatchObject({
      fileName: "notes.md",
      mimeType: "text/markdown",
    });

    if (!attachment) throw new Error("Expected an attachment.");
    await store.removeAttachment(noteId, attachment);
    expect(store.getSnapshot().notes[0]?.attachments).toEqual([]);
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
