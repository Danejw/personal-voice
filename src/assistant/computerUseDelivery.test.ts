import { afterEach, describe, expect, it, vi } from "vitest";
import { askComputerAction, type ComputerActionApi, type ComputerActionRow } from "@/assistant/computerRemote";
import { ComputerActionStore } from "@/assistant/ComputerActionStore";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import type { RemoteDevice } from "@/assistant/remoteContext";

const claimState = vi.hoisted(() => ({ alreadyClaimed: false }));
afterEach(() => { claimState.alreadyClaimed = false; });
vi.mock("@/settings/deviceSettings", () => ({ loadRemoteComputerActions: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => true }));
vi.mock("@/services/remoteAutoActionService", () => ({
  remoteAutoActionApi: {
    wasClaimed: async () => claimState.alreadyClaimed,
    claim: async () => "claimed",
    validate: async () => true,
  },
}));

describe("Android command to Windows receipt contract", () => {
  it("delivers, executes once and returns the same command's acknowledged result", async () => {
    const rows = new Map<string, ComputerActionRow>();
    let submitted = 0;
    const api: ComputerActionApi & { touch(deviceId: string): Promise<void> } = {
      touch: async () => undefined,
      create: async (userId, requesterDeviceId, targetDeviceId, action, argument) => {
        const id = `command-${++submitted}`;
        rows.set(id, {
          id, userId, requesterDeviceId, targetDeviceId, action, argument,
          status: "pending", result: null, error: null, version: 2,
          expiresAt: "2099-01-01T00:00:00Z",
          requestSignature: "signed-test-request", responseSignature: null,
        });
        return id;
      },
      get: async (_user, id) => rows.get(id) ?? null,
      listPending: async (_user, deviceId) =>
        Array.from(rows.values()).filter(row => row.targetDeviceId === deviceId && row.status === "pending"),
      answer: async (_user, id, result) => {
        const row = rows.get(id);
        if (!row) throw new Error("Missing request");
        row.status = "answered";
        row.result = result;
      },
      deny: async (_user, id, reason) => {
        const row = rows.get(id);
        if (!row) throw new Error("Missing request");
        row.status = "denied";
        row.error = reason;
      },
      remove: async (_user, id) => { rows.delete(id); },
    };
    const open = vi.fn(async () => "Opened Notepad.");
    const windows = new ComputerActionStore(api, async () => [], () => "pc", {
      platform: "windows", openAllowlistedApp: open,
    } as unknown as PlatformAdapter);
    windows.userId = "account";
    const devices: RemoteDevice[] = [
      { id: "phone", name: "Android", platform: "android", lastSeen: "2026-09-28T12:00:00Z" },
      { id: "pc", name: "Desk PC", platform: "windows", lastSeen: "2026-09-28T12:00:00Z" },
    ];
    let time = Date.parse("2026-09-28T12:00:10Z");
    const receipts: string[] = [];
    const response = await askComputerAction(
      api, "account", "phone", devices, "Desk PC", "open_app", "notepad",
      {
        now: () => time,
        sleep: async (ms) => { time += ms; await windows.poll("account"); },
      },
      receipt => receipts.push(`${receipt.requestId}:${receipt.stage}`),
    );
    expect(response).toBe("Opened Notepad.");
    expect(receipts).toEqual(["command-1:queued", "command-1:answered"]);
    expect(submitted).toBe(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(0);
    await windows.poll("account");
    expect(open).toHaveBeenCalledTimes(1);
    expect(windows.getSnapshot().receiverError).toBeNull();
  });
  it("reports a previously claimed request as unknown without replaying it", async () => {
    claimState.alreadyClaimed = true;
    const row: ComputerActionRow = {
      id: "orphaned-claim", userId: "account", requesterDeviceId: "phone", targetDeviceId: "pc",
      action: "open_app", argument: "notepad", status: "pending",
      result: null, error: null, version: 2, expiresAt: "2099-01-01T00:00:00Z",
      requestSignature: "signed-test-request", responseSignature: null,
    };
    const open = vi.fn(async () => "Opened Notepad.");
    const api = {
      touch: async () => undefined,
      create: async () => row.id,
      get: async () => row,
      listPending: async () => row.status === "pending" ? [row] : [],
      answer: async () => { throw new Error("Must not answer without execution"); },
      deny: async (_user: string, _id: string, error: string) => {
        row.status = "denied";
        row.error = error;
      },
      remove: async () => undefined,
    };
    const windows = new ComputerActionStore(api, async () => [], () => "pc", {
      platform: "windows", openAllowlistedApp: open,
    } as unknown as PlatformAdapter);
    windows.userId = "account";
    await windows.poll("account");
    expect(row.status).toBe("denied");
    expect(row.error).toMatch(/outcome is unknown/i);
    expect(open).not.toHaveBeenCalled();
  });

});
