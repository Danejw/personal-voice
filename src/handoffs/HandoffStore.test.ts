import { describe, expect, it } from "vitest";
import { buildContinuation, classifyHandoffText } from "@/assistant/continuation";
import { HandoffStore } from "@/handoffs/HandoffStore";
import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import type { HandoffApi } from "@/services/handoffService";

interface StoredHandoff extends Handoff {
  userId: string;
}

/** Shared in-memory Supabase used by independent device stores. */
function fakeServer() {
  let sequence = 0;
  const devices: OwnedDevice[] = [
    { id: "windows", name: "Desk PC", platform: "windows", lastSeen: "2026-09-28T12:00:00.000Z" },
    { id: "android", name: "Phone", platform: "android", lastSeen: "2026-09-28T12:01:00.000Z" },
    { id: "tablet", name: "Tablet", platform: "android", lastSeen: "2026-09-28T12:02:00.000Z" },
  ];
  const handoffs: StoredHandoff[] = [];
  const control = { offline: false, failSend: false };
  const guard = () => {
    if (control.offline) throw new Error("Couldn't reach the sync service. Check your connection.");
  };
  const api: HandoffApi = {
    async listDevices() {
      guard();
      return structuredClone(devices);
    },
    async listReceived(userId, currentDeviceId) {
      guard();
      return structuredClone(handoffs.filter((handoff) =>
        handoff.userId === userId
        && handoff.consumedAt === null
        && handoff.sourceDeviceId !== currentDeviceId
        && (handoff.targetDeviceId === null || handoff.targetDeviceId === currentDeviceId)));
    },
    async send(userId, text, sourceDeviceId, targetDeviceId) {
      guard();
      if (control.failSend) throw new Error("Sending the handoff failed.");
      sequence += 1;
      handoffs.push({
        id: `handoff-${sequence}`,
        userId,
        text,
        sourceDeviceId,
        targetDeviceId,
        createdAt: new Date(Date.UTC(2026, 8, 28, 12, 0, sequence)).toISOString(),
        consumedAt: null,
      });
    },
    async consume(id) {
      guard();
      const handoff = handoffs.find((entry) => entry.id === id);
      if (!handoff) throw new Error("Handoff not found.");
      handoff.consumedAt = new Date(Date.UTC(2026, 8, 28, 13, 0, sequence)).toISOString();
    },
  };
  return { api, control };
}

describe("HandoffStore", () => {
  it("sends targeted handoffs in both Windows and Android directions", async () => {
    const server = fakeServer();
    const windows = new HandoffStore(server.api, () => "windows");
    const android = new HandoffStore(server.api, () => "android");
    await Promise.all([windows.setUser("user-1"), android.setUser("user-1")]);

    expect(windows.getSnapshot().devices.map((device) => device.id)).not.toContain("windows");
    windows.selectTarget("android");
    await windows.send("Continue on the phone.");
    await android.reload();
    expect(android.getSnapshot().received).toMatchObject([
      { text: "Continue on the phone.", sourceDeviceId: "windows", targetDeviceId: "android" },
    ]);

    android.selectTarget("windows");
    await android.send("Back to the PC.");
    await windows.reload();
    expect(windows.getSnapshot().received).toMatchObject([
      { text: "Back to the PC.", sourceDeviceId: "android", targetDeviceId: "windows" },
    ]);
  });

  it("delivers an all-device handoff to other devices but never its source", async () => {
    const server = fakeServer();
    const windows = new HandoffStore(server.api, () => "windows");
    const android = new HandoffStore(server.api, () => "android");
    const tablet = new HandoffStore(server.api, () => "tablet");
    await Promise.all([
      windows.setUser("user-1"),
      android.setUser("user-1"),
      tablet.setUser("user-1"),
    ]);

    await windows.send("Available everywhere else.");
    await Promise.all([windows.reload(), android.reload(), tablet.reload()]);

    expect(windows.getSnapshot().received).toEqual([]);
    expect(android.getSnapshot().received[0]?.text).toBe("Available everywhere else.");
    expect(tablet.getSnapshot().received[0]?.text).toBe("Available everywhere else.");
  });

  it("does not duplicate rows on refresh and preserves repeated intentional sends", async () => {
    const server = fakeServer();
    const windows = new HandoffStore(server.api, () => "windows");
    const android = new HandoffStore(server.api, () => "android");
    await Promise.all([windows.setUser("user-1"), android.setUser("user-1")]);

    windows.selectTarget("android");
    await windows.send("Same clipboard text.");
    await android.reload();
    await android.reload();
    expect(android.getSnapshot().received).toHaveLength(1);

    await windows.send("Same clipboard text.");
    await android.reload();
    expect(android.getSnapshot().received.map((handoff) => handoff.text)).toEqual([
      "Same clipboard text.",
      "Same clipboard text.",
    ]);
    expect(new Set(android.getSnapshot().received.map((handoff) => handoff.id)).size).toBe(2);
  });

  it("consumes a handoff permanently and surfaces send failures", async () => {
    const server = fakeServer();
    const windows = new HandoffStore(server.api, () => "windows");
    const android = new HandoffStore(server.api, () => "android");
    await Promise.all([windows.setUser("user-1"), android.setUser("user-1")]);
    await windows.send("Use once.");
    await android.reload();
    const id = android.getSnapshot().received[0]?.id ?? "";

    await android.consume(id);
    expect(android.getSnapshot().received).toEqual([]);
    await android.reload();
    expect(android.getSnapshot().received).toEqual([]);

    windows.selectTarget("tablet");
    expect(windows.resolveTarget("Phone")).toEqual({ id: "android", name: "Phone" });
    expect(windows.getSnapshot().targetDeviceId).toBe("tablet");
    await windows.send("To the phone.", "dictation", "android");
    expect(windows.getSnapshot().targetDeviceId).toBe("tablet");
    expect(() => windows.resolveTarget("Laptop")).toThrow("No other device is named Laptop.");
    await expect(windows.send("Missing.", "dictation", "not-a-device")).rejects.toThrow("That device is not on this account.");

    const built = buildContinuation({
      turns: [{ role: "user", text: "The cross-device code word is pineapple seven." }],
      selection: null,
      notes: [],
      handoff: null,
      screen: null,
      sourceDeviceId: "windows",
      sourceDeviceName: "Desk PC",
      createdAt: "2026-09-28T12:00:00.000Z",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    await windows.send(built.text, "dictation", "android");
    await windows.send("Plain words.", "dictation", "android");
    const tablet = new HandoffStore(server.api, () => "tablet");
    await tablet.setUser("user-1");
    await android.reload();
    const received = android.getSnapshot().received.map((handoff) => classifyHandoffText(handoff.text).kind);
    expect(received).toContain("continuation");
    expect(received).toContain("text");
    expect(tablet.getSnapshot().received.some((handoff) => classifyHandoffText(handoff.text).kind === "continuation")).toBe(false);
    const stranger = new HandoffStore(server.api, () => "android");
    await stranger.setUser("user-2");
    expect(stranger.getSnapshot().received).toEqual([]);

    server.control.failSend = true;
    await expect(windows.send("Do not lose this.")).rejects.toThrow("Sending the handoff failed.");
    expect(windows.getSnapshot().error).toBe("Sending the handoff failed.");
  });
});
