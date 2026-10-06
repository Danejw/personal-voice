import { describe, expect, it } from "vitest";
import { DeviceStore } from "@/devices/DeviceStore";
import { HandoffStore } from "@/handoffs/HandoffStore";
import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import { NotesStore } from "@/notes/NotesStore";
import type { Note } from "@/notes/note";
import type { DeviceApi } from "@/services/deviceService";
import type { HandoffApi } from "@/services/handoffService";
import type { NotesApi } from "@/services/notesService";

interface StoredHandoff extends Handoff {
  userId: string;
}

interface StoredNote extends Note {
  userId: string;
}

/** Shared in-memory devices, notes, and handoffs with no foreign keys. */
function fakeAccount() {
  const devices: OwnedDevice[] = [
    { id: "windows", name: "Windows", platform: "windows", lastSeen: "2026-09-28T12:00:00.000Z" },
    { id: "android", name: "Android", platform: "android", lastSeen: "2026-09-28T12:01:00.000Z" },
  ];
  const notes: StoredNote[] = [];
  const handoffs: StoredHandoff[] = [];
  let noteSequence = 0;
  let handoffSequence = 0;
  const deviceApi: DeviceApi = {
    async list() {
      return structuredClone(devices);
    },
    async rename(id, name) {
      const device = devices.find((entry) => entry.id === id);
      if (!device) throw new Error("Device not found.");
      device.name = name;
    },
    async remove(id) {
      const index = devices.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error("Device not found.");
      devices.splice(index, 1);
    },
  };
  const notesApi: NotesApi = {
    async list(userId) {
      return structuredClone(notes.filter((note) => note.userId === userId));
    },
    async create(userId, text, sourceDeviceId, sourceType) {
      noteSequence += 1;
      const createdAt = new Date(Date.UTC(2026, 8, 28, 12, 0, noteSequence)).toISOString();
      const note: StoredNote = {
        id: `note-${noteSequence}`,
        userId,
        text,
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
    async updateText(id, text) {
      const note = notes.find((entry) => entry.id === id);
      if (!note) throw new Error("Note not found.");
      note.text = text;
      return structuredClone(note);
    },
    async addAttachment() {
      throw new Error("Attachments are not used by this test.");
    },
    async removeAttachment() {
      throw new Error("Attachments are not used by this test.");
    },
    async setStatus(id, status) {
      const note = notes.find((entry) => entry.id === id);
      if (!note) throw new Error("Note not found.");
      note.status = status;
      return structuredClone(note);
    },
    async delete(id) {
      const index = notes.findIndex((entry) => entry.id === id);
      if (index >= 0) notes.splice(index, 1);
    },
  };
  const handoffApi: HandoffApi = {
    async listDevices() {
      return structuredClone(devices);
    },
    async listReceived(userId, currentDeviceId) {
      return structuredClone(handoffs.filter((handoff) =>
        handoff.userId === userId
        && handoff.consumedAt === null
        && handoff.sourceDeviceId !== currentDeviceId
        && (handoff.targetDeviceId === null || handoff.targetDeviceId === currentDeviceId)));
    },
    async send(userId, text, sourceDeviceId, targetDeviceId) {
      handoffSequence += 1;
      handoffs.push({
        id: `handoff-${handoffSequence}`,
        userId,
        text,
        sourceDeviceId,
        targetDeviceId,
        createdAt: new Date(Date.UTC(2026, 8, 28, 12, 0, handoffSequence)).toISOString(),
        consumedAt: null,
      });
    },
    async consume(id) {
      const handoff = handoffs.find((entry) => entry.id === id);
      if (!handoff) throw new Error("Handoff not found.");
      handoff.consumedAt = new Date().toISOString();
    },
  };
  return { deviceApi, notesApi, handoffApi };
}

describe("DeviceStore", () => {
  it("lists the current device and persists a rename across stores", async () => {
    const account = fakeAccount();
    const windows = new DeviceStore(account.deviceApi, () => "windows");
    await windows.setUser("user-1");

    expect(windows.getSnapshot().devices.map((device) => [device.id, device.name])).toEqual([
      ["windows", "Windows"],
      ["android", "Android"],
    ]);
    expect(windows.getSnapshot().currentDeviceId).toBe("windows");

    await windows.rename("windows", "  Desktop  ");
    expect(windows.getSnapshot().devices[0]?.name).toBe("Desktop");

    const restarted = new DeviceStore(account.deviceApi, () => "windows");
    await restarted.setUser("user-1");
    expect(restarted.getSnapshot().devices.find((device) => device.id === "windows")?.name).toBe("Desktop");
  });

  it("refuses to remove the current device", async () => {
    const account = fakeAccount();
    const store = new DeviceStore(account.deviceApi, () => "windows");
    await store.setUser("user-1");

    await expect(store.remove("windows")).rejects.toThrow("You can't remove the device you're using.");
    expect(store.getSnapshot().devices).toHaveLength(2);
  });

  it("removing another device leaves notes and handoffs that still name it", async () => {
    const account = fakeAccount();
    const devices = new DeviceStore(account.deviceApi, () => "windows");
    const notes = new NotesStore(account.notesApi, () => "android");
    const handoffs = new HandoffStore(account.handoffApi, () => "windows");
    await Promise.all([devices.setUser("user-1"), notes.setUser("user-1"), handoffs.setUser("user-1")]);

    await notes.create("From the phone.");
    const androidHandoffs = new HandoffStore(account.handoffApi, () => "android");
    await androidHandoffs.setUser("user-1");
    androidHandoffs.selectTarget("windows");
    await androidHandoffs.send("To the PC.");

    await devices.remove("android");
    await Promise.all([notes.reload(), handoffs.reload()]);

    expect(devices.getSnapshot().devices.map((device) => device.id)).toEqual(["windows"]);
    expect(notes.getSnapshot().notes).toMatchObject([{ text: "From the phone.", sourceDeviceId: "android" }]);
    expect(handoffs.getSnapshot().received).toMatchObject([
      { text: "To the PC.", sourceDeviceId: "android" },
    ]);
  });
});
