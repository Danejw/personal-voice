import { describe, expect, it, vi } from "vitest";
import { ComputerActionStore } from "@/assistant/ComputerActionStore";
import type { ComputerActionRow } from "@/assistant/computerRemote";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import { recordComputerEvent } from "@/services/computerFlightRecorder";

vi.mock("@/services/computerFlightRecorder", () => ({
  recordComputerEvent: vi.fn(),
  flightFailureCode: () => "unknown",
}));
vi.mock("@/assistant/remoteVoiceTarget", () => ({
  resolvePairedVoiceTarget: async () => ({ id: "pc", name: "Desk PC", platform: "windows" }),
}));
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
    expect(recordComputerEvent).toHaveBeenCalledWith(expect.objectContaining({
      actor: "windows", traceId: "pointer", action: "click_pointer", stage: "acted",
    }));
    expect(recordComputerEvent).toHaveBeenCalledWith(expect.objectContaining({
      actor: "windows", traceId: "chrome", action: "open_app", stage: "acknowledged",
    }));
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
  it("runs scroll through the visible pointer controller", async () => {
    const pointer = vi.fn(async () => "Scrolled down.");
    const store = new ComputerActionStore(
      {} as ConstructorParameters<typeof ComputerActionStore>[0],
      async () => [], () => "pc",
      { platform: "windows", computerPointerAction: pointer } as unknown as PlatformAdapter,
    );
    await expect(store.execute({ name: "scroll", args: { x: 400, y: 600, direction: "down" } }))
      .resolves.toBe("Scrolled down.");
    expect(pointer).toHaveBeenCalledWith("scroll_down", 400, 600);
    await expect(store.execute({ name: "scroll", args: { x: 400, y: 600, direction: "diagonal" } }))
      .rejects.toThrow(/direction/);
    expect(pointer).toHaveBeenCalledTimes(1);
  });

  it("waits for the requested duration rather than returning immediately", async () => {
    vi.useFakeTimers();
    try {
      const store = new ComputerActionStore(
        {} as ConstructorParameters<typeof ComputerActionStore>[0],
        async () => [], () => "pc", { platform: "windows" } as PlatformAdapter,
      );
      let resolved = false;
      const action = store.execute({ name: "wait", args: { seconds: 1 } })
        .then(result => { resolved = true; return result; });
      await vi.advanceTimersByTimeAsync(999);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(action).resolves.toBe("Waited 1 seconds.");
      await expect(store.execute({ name: "wait", args: { seconds: 3 } }))
        .rejects.toThrow(/between 0 and 2/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("correlates direct Android requests with Windows command IDs, not a previous goal", async () => {
    vi.mocked(recordComputerEvent).mockClear();
    let created = 0;
    const api = {
      touch: async () => undefined,
      create: async () => `remote-${++created}`,
      get: async (_user: string, id: string) => ({
        ...request(id, "open_app", "notepad"), status: "answered", result: "Acknowledged.",
      }),
      listPending: async () => [],
      answer: async () => undefined,
      deny: async () => undefined,
      remove: async () => undefined,
    } as unknown as ConstructorParameters<typeof ComputerActionStore>[0];
    const devices = [
      { id: "phone", name: "Phone", platform: "android", lastSeen: new Date().toISOString() },
      { id: "pc", name: "Desk PC", platform: "windows", lastSeen: new Date().toISOString() },
    ];
    const store = new ComputerActionStore(
      api, async () => devices as Parameters<ConstructorParameters<typeof ComputerActionStore>[1]>[0][],
      () => "phone", { platform: "android" } as PlatformAdapter,
    );
    store.userId = "account";
    await store.remoteAction("start_computer_goal", "Open Notepad.", "Desk PC");
    await store.remoteAction("open_app", "notepad", "Desk PC");
    expect(store.getSnapshot().remoteGoal?.requestId).toBe("remote-1");
    expect(recordComputerEvent).toHaveBeenCalledWith(expect.objectContaining({
      actor: "android", traceId: "remote-2", action: "open_app", stage: "queued",
    }));
    expect(recordComputerEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      actor: "android", traceId: "remote-1", action: "open_app",
    }));
  });

});
