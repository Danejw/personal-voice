import { describe, expect, it, vi } from "vitest";
import { ComputerActionStore } from "@/assistant/ComputerActionStore";
import type { ComputerActionRow } from "@/assistant/computerRemote";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import type { RemoteDevice } from "@/assistant/remoteContext";
import { recordComputerEvent } from "@/services/computerFlightRecorder";
import { computerJobsApi, type ComputerJob } from "@/services/computerJobsService";

vi.mock("@/services/computerJobsService", () => ({
  computerJobsApi: {
    create: vi.fn(), activate: vi.fn(), cancelPending: vi.fn(),
    checkpoint: vi.fn(), heartbeat: vi.fn(), reconcile: vi.fn(), latest: vi.fn(),
  },
}));
vi.mock("@/assistant/remoteVoiceProof", () => ({
  pairedPublicKey: vi.fn(async () => ({})),
}));
vi.mock("@/services/computerFlightRecorder", () => ({
  recordComputerEvent: vi.fn(),
  flightFailureCode: () => "unknown",
}));
vi.mock("@/assistant/remoteVoiceTarget", () => ({
  resolvePairedVoiceTarget: async () => ({ id: "11111111-1111-4111-8111-111111111111", name: "Desk PC", platform: "windows" }),
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
      { id: "11111111-1111-4111-8111-111111111111", name: "Desk PC", platform: "windows", lastSeen: new Date().toISOString() },
    ];
    const store = new ComputerActionStore(
      api, async () => devices as RemoteDevice[],
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

  const durable = (status: ComputerJob["status"] = "running",
    phase: ComputerJob["phase"] = "observing", steps = 0): ComputerJob => ({
    id: "goal-1", user_id: "account", requester_device_id: "phone", target_device_id: "pc",
    goal: "Open Notepad and type Hello World.", status, phase, steps,
    last_action: steps ? "type" : "", result: "", evidence: null,
    worker_token: status === "running" ? "lease-token" : null,
    lease_until: null, heartbeat_at: null, stop_requested_at: null, created_at: "2026-11-05T20:00:00Z",
    updated_at: "2026-11-05T20:01:00Z",
  });

  it("durably creates before acknowledging, and checkpoints before/after desktop input", async () => {
    const row = request("goal-1", "start_computer_goal", "Open Notepad and type Hello World.");
    const messages: string[] = [];
    const api = {
      touch: async () => undefined,
      listPending: async () => row.status === "pending" ? [row] : [],
      answer: async (_user: string, _id: string, result: string) => {
        expect(computerJobsApi.create).toHaveBeenCalledTimes(1);
        messages.push("ack");
        row.status = "answered";
        row.result = result;
      },
      deny: async () => { throw new Error("Unexpected denial"); },
    } as unknown as ConstructorParameters<typeof ComputerActionStore>[0];
    vi.mocked(computerJobsApi.reconcile).mockResolvedValue(null);
    vi.mocked(computerJobsApi.create).mockResolvedValue(durable("pending_ack"));
    vi.mocked(computerJobsApi.activate).mockResolvedValue(durable());
    vi.mocked(computerJobsApi.heartbeat).mockResolvedValue(durable());
    vi.mocked(computerJobsApi.checkpoint).mockImplementation(async (_pc, _id, _token, point) => {
      messages.push(`checkpoint:${point.phase}:${point.steps}`);
      return durable(point.status, point.phase, point.steps);
    });
    const store = new ComputerActionStore(api, async () => [], () => "pc",
      { platform: "windows" } as PlatformAdapter);
    store.setRemoteGoalRunner(async (_goal, progress, validate, _trace, beforeAction, beforeVerify) => {
      await validate();
      await beforeAction(0, "type");
      messages.push("native action");
      await progress(1, "type");
      await beforeVerify(1);
      return { status: "verified", steps: 1,
        summary: "Hello World was typed.", evidence: "Hello World is visibly present in Notepad." };
    }, () => undefined);
    store.userId = "account";
    await store.poll("account");
    await vi.waitFor(() => {
      expect(messages).toContain("checkpoint:done:1");
    });
    expect(messages).toEqual([
      "ack", "checkpoint:applying:0", "native action",
      "checkpoint:observing:1", "checkpoint:verifying:1", "checkpoint:done:1",
    ]);
    expect(computerJobsApi.activate).toHaveBeenCalledWith("pc", "goal-1");
  });

  it("never replays an in-flight action after restart, even with a bad resume flag", async () => {
    vi.mocked(computerJobsApi.reconcile).mockResolvedValue({
      resumed: true, job: durable("running", "applying", 1),
    });
    const store = new ComputerActionStore({
      touch: async () => undefined, listPending: async () => [],
    } as unknown as ConstructorParameters<typeof ComputerActionStore>[0],
    async () => [], () => "pc", { platform: "windows" } as PlatformAdapter);
    const runner = vi.fn(async () => ({ status: "unverified" as const,
      steps: 1, summary: "Unknown action outcome.", evidence: null }));
    store.setRemoteGoalRunner(runner, () => undefined);
    store.userId = "account";
    await store.poll("account");
    expect(computerJobsApi.reconcile).toHaveBeenCalledWith("pc", true);
    expect(runner).not.toHaveBeenCalled();
  });

  it("may restart only a zero-action observing checkpoint using a new screenshot", async () => {
    vi.mocked(computerJobsApi.reconcile).mockResolvedValue({
      resumed: true, job: durable("running", "observing", 0),
    });
    vi.mocked(computerJobsApi.checkpoint).mockResolvedValue(durable("needs_review", "done"));
    const store = new ComputerActionStore({
      touch: async () => undefined, listPending: async () => [],
    } as unknown as ConstructorParameters<typeof ComputerActionStore>[0],
    async () => [], () => "pc", { platform: "windows" } as PlatformAdapter);
    const runner = vi.fn(async () => ({ status: "unverified" as const,
      steps: 0, summary: "No result proven.", evidence: null }));
    store.setRemoteGoalRunner(runner, () => undefined);
    store.userId = "account";
    await store.poll("account");
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    expect(runner).toHaveBeenCalledWith(
      "Open Notepad and type Hello World.",
      expect.any(Function), expect.any(Function), expect.any(Function),
      expect.any(Function), expect.any(Function),
    );
  });

});
