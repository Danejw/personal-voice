import { describe, expect, it } from "vitest";
import { VoiceNotesStore } from "@/notes/VoiceNotesStore";
import type { VoiceNote } from "@/notes/voiceNote";
import type { VoiceNotesApi } from "@/services/voiceNotesService";

interface StoredNote extends VoiceNote {
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
  const api: VoiceNotesApi = {
    async list(userId) {
      guard();
      return structuredClone(notes.filter((note) => note.userId === userId));
    },
    async create(userId, text, sourceDeviceId) {
      guard();
      if (control.failCreate) throw new Error("Saving the voice note failed.");
      sequence += 1;
      const createdAt = new Date(Date.UTC(2026, 8, 28, 12, 0, sequence)).toISOString();
      const note: StoredNote = {
        id: `note-${sequence}`,
        userId,
        text,
        sourceDeviceId,
        status: "inbox",
        createdAt,
        updatedAt: createdAt,
      };
      notes.push(note);
      return structuredClone(note);
    },
    async setStatus(id, status) {
      guard();
      const note = notes.find((entry) => entry.id === id);
      if (!note) throw new Error("Voice note not found.");
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

describe("VoiceNotesStore", () => {
  it("creates on Windows and Android and reloads both across devices", async () => {
    const server = fakeServer();
    const windows = new VoiceNotesStore(server.api, () => "windows-device");
    const android = new VoiceNotesStore(server.api, () => "android-device");
    await Promise.all([windows.setUser("user-1"), android.setUser("user-1")]);

    await windows.create("From Windows.");
    await android.reload();
    expect(android.getSnapshot().notes).toMatchObject([
      { text: "From Windows.", sourceDeviceId: "windows-device", status: "inbox" },
    ]);

    await android.create("From Android.");
    await windows.reload();
    expect(windows.getSnapshot().notes.map((note) => [note.text, note.sourceDeviceId])).toEqual([
      ["From Android.", "android-device"],
      ["From Windows.", "windows-device"],
    ]);
  });

  it("archives, restores, and deletes a note", async () => {
    const server = fakeServer();
    const store = new VoiceNotesStore(server.api, () => "device-1");
    await store.setUser("user-1");
    await store.create("Keep this.");
    const id = store.getSnapshot().notes[0]?.id ?? "";

    await store.setArchived(id, true);
    expect(store.getSnapshot().notes[0]?.status).toBe("archived");
    await store.setArchived(id, false);
    expect(store.getSnapshot().notes[0]?.status).toBe("inbox");
    await store.remove(id);
    expect(store.getSnapshot().notes).toEqual([]);
  });

  it("surfaces load and destination-save failures without inventing a local note", async () => {
    const server = fakeServer();
    const store = new VoiceNotesStore(server.api, () => "device-1");
    server.control.offline = true;
    await store.setUser("user-1");
    expect(store.getSnapshot()).toMatchObject({ status: "offline", notes: [] });
    await expect(store.create("Offline.")).rejects.toThrow("Voice notes are unavailable");

    server.control.offline = false;
    await store.reload();
    server.control.failCreate = true;
    await expect(store.create("Do not lose this.")).rejects.toThrow("Saving the voice note failed.");
    expect(store.getSnapshot()).toMatchObject({
      status: "synced",
      notes: [],
      error: "Saving the voice note failed.",
    });
  });
});
