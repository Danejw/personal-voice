import { describe, expect, it, vi } from "vitest";
import { ComputerActionStore } from "@/assistant/ComputerActionStore";
import type { ComputerActionRow } from "@/assistant/computerRemote";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";

vi.mock("@/settings/deviceSettings", () => ({
  loadRemoteComputerActions: () => true,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => true,
}));
vi.mock("@/services/remoteAutoActionService", () => ({
  remoteAutoActionApi: {
    wasClaimed: async () => false,
    claim: async () => "claimed",
    validate: async () => true,
  },
}));

function request(id: string, action: string, argument: string): ComputerActionRow {
  return {
    id, userId: "account", requesterDeviceId: "phone", targetDeviceId: "pc",
    action, argument, status: "pending", result: null, error: null,
    version: 2, expiresAt: "2099-01-01T00:00:00Z",
    requestSignature: "verified", responseSignature: null,
  };
}

describe("Windows signed remote action receiver", () => {
  it("shows receiver failures and clears them after a successful poll", async () => {
    let unavailable = true;
    const store = new ComputerActionStore({
      touch: async () => undefined,
      create: async () => "",
      get: async () => null,
      listPending: async () => {
        if (unavailable) throw new Error("Database connection unavailable.");
        return [];
      },
      answer: async () => undefined,
      deny: async () => undefined,
      remove: async () => undefined,
    }, async () => [], () => "pc", { platform: "windows" } as PlatformAdapter);
    store.userId = "account";
    await expect(store.poll("account")).rejects.toThrow("Database connection unavailable.");
    store.reportPollFailure(new Error("Database connection unavailable."));
    expect(store.getSnapshot().receiverError).toBe("Database connection unavailable.");
    unavailable = false;
    await store.poll("account");
    expect(store.getSnapshot().receiverError).toBeNull();
  });


  it("runs mouse input and launches Chrome without a second desktop approval", async () => {
    const events: string[] = [];
    const rows = [request("pointer", "click_pointer", "500,500"),
      request("chrome", "open_app", "chrome.exe")];
    const store = new ComputerActionStore({
      touch: async () => undefined,
      create: async () => "",
      get: async () => null,
      listPending: async () => rows.filter(r => r.status === "pending"),
      answer: async (_, id, result) => {
        const row = rows.find(r => r.id === id)!;
        row.status = "answered";
        row.result = result;
      },
      deny: async (_, id, message) => {
        const row = rows.find(r => r.id === id)!;
        row.status = "denied";
        row.error = message;
      },
      remove: async () => undefined,
    }, async () => [], () => "pc", {
      platform: "windows",
      computerPointerAction: async () => { events.push("click"); return "Clicked"; },
      openAllowlistedApp: async (name: string) => { events.push(name); return "Opened"; },
    } as unknown as PlatformAdapter);
    store.userId = "account";
    await store.poll("account");
    expect(events).toEqual(["click", "chrome.exe"]);
    expect(rows.map(r => r.status)).toEqual(["answered", "answered"]);
    expect(store.getSnapshot().approval).toBeNull();
  });

  it("rejects unsupported remote commands without executing them", async () => {
    const row = request("shell", "run_shell", "powershell.exe");
    const platform = { platform: "windows", openAllowlistedApp: vi.fn() } as unknown as PlatformAdapter;
    const store = new ComputerActionStore({
      touch: async () => undefined,
      create: async () => "",
      get: async () => null,
      listPending: async () => row.status === "pending" ? [row] : [],
      answer: async () => { throw new Error("Unexpected execution"); },
      deny: async (_, __, message) => { row.status = "denied"; row.error = message; },
      remove: async () => undefined,
    }, async () => [], () => "pc", platform);
    store.userId = "account";
    await store.poll("account");
    expect(row.status).toBe("denied");
    expect(platform.openAllowlistedApp).not.toHaveBeenCalled();
    expect(store.getSnapshot().approval).toBeNull();
  });
});
