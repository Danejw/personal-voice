import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceLinkManager } from "@/device-link/DeviceLinkManager";
import type { DeviceLinkEnvelope, DeviceLinkPayload } from "@/device-link/protocol";

const phone = "00000000-0000-4000-8000-000000000001";
const desktop = "00000000-0000-4000-8000-000000000002";
const laptop = "00000000-0000-4000-8000-000000000003";

type TestManager = {
  platform: "android";
  pairs: { id: string; peerDeviceId: string; createdAt: string }[];
  sessions: Map<string, { connected: boolean; stop(): void }>;
  deliver(frame: DeviceLinkEnvelope): void;
};
function setup() {
  vi.useFakeTimers();
  const manager = new DeviceLinkManager();
  const internal = manager as unknown as TestManager;
  internal.platform = "android";
  internal.pairs = [
    { id: "pair-1", peerDeviceId: desktop, createdAt: "" },
    { id: "pair-2", peerDeviceId: laptop, createdAt: "" },
  ];
  internal.sessions = new Map([
    [desktop, { connected: true, stop: () => undefined }],
    [laptop, { connected: true, stop: () => undefined }],
  ]);
  const send = vi.spyOn(manager, "sendEphemeral").mockResolvedValue(true);
  return { manager, internal, send };
}
function frame(sender: string, payload: DeviceLinkPayload): DeviceLinkEnvelope {
  const now = Date.now();
  return {
    v: 1, id: crypto.randomUUID(), sender, target: phone,
    issuedAt: now, expiresAt: now + 2_000, payload,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Companion's paired PC isolation", () => {
  it("starts only the requested PC and sends periodic renewals only there", async () => {
    const { manager, send } = setup();
    manager.setCompanionOpen(true, desktop);
    expect(send).toHaveBeenCalledWith(desktop, { type: "companion", action: "start" });
    expect(send).not.toHaveBeenCalledWith(laptop, expect.anything());
    await vi.advanceTimersByTimeAsync(4_100);
    expect(send.mock.calls.filter(([id]) => id === laptop)).toHaveLength(0);
    manager.stop();
  });

  it("stops the previous PC, drops its stale frames, and accepts only new PC", () => {
    const { manager, internal, send } = setup();
    const received: string[] = [];
    manager.subscribeCompanion((from) => received.push(from));
    manager.setCompanionOpen(true, desktop);
    internal.deliver(frame(desktop, { type: "cursor", x: 10, y: 20 }));
    expect(received).toEqual([desktop]);

    manager.setCompanionOpen(true, laptop);
    expect(send).toHaveBeenCalledWith(desktop, { type: "companion", action: "stop" });
    expect(send).toHaveBeenCalledWith(laptop, { type: "companion", action: "start" });
    internal.deliver(frame(desktop, { type: "cursor", x: 99, y: 99 }));
    internal.deliver(frame(laptop, { type: "cursor", x: 30, y: 40 }));
    expect(received).toEqual([desktop, laptop]);
    manager.stop();
  });

  it("stops streaming when hidden or pairing is no longer verified", () => {
    const { manager, internal, send } = setup();
    const received: string[] = [];
    manager.subscribeCompanion((from) => received.push(from));
    manager.setCompanionOpen(true, desktop);
    manager.setCompanionOpen(false);
    expect(send).toHaveBeenCalledWith(desktop, { type: "companion", action: "stop" });
    internal.deliver(frame(desktop, { type: "cursor", x: 5, y: 5 }));
    expect(received).toEqual([]);

    manager.setCompanionOpen(true, desktop);
    internal.pairs = internal.pairs.filter(p => p.peerDeviceId !== desktop);
    manager.setCompanionOpen(true, desktop);
    expect(send.mock.calls.at(-1)).toEqual([desktop, { type: "companion", action: "stop" }]);
    internal.deliver(frame(desktop, { type: "cursor", x: 6, y: 6 }));
    expect(received).toEqual([]);
    manager.stop();
  });

  it("serializes native relay restart after an in-flight stop", async () => {
    const manager = new DeviceLinkManager();
    const operations: string[] = [];
    let release: () => void = () => undefined;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const relay = manager as unknown as {
      withRelay<T>(task: () => Promise<T>): Promise<T>;
    };
    const stopping = relay.withRelay(async () => {
      operations.push("stop started");
      await blocked;
      operations.push("stop finished");
    });
    const starting = relay.withRelay(async () => {
      operations.push("next start");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(operations).toEqual(["stop started"]);
    release();
    await Promise.all([stopping, starting]);
    expect(operations).toEqual(["stop started", "stop finished", "next start"]);
  });


  it("backs off setup retries and never retries after stop", async () => {
    const manager = new DeviceLinkManager();
    const internal = manager as unknown as {
      deviceId: string | null; userId: string | null; platform: "android" | null;
      generation: number; retryAttempts: number;
      retryTimer: ReturnType<typeof setTimeout> | null;
      scheduleRetry(generation: number): void;
    };
    internal.deviceId = phone;
    internal.userId = "user-1";
    internal.platform = "android";
    internal.scheduleRetry(internal.generation);
    expect(internal.retryTimer).not.toBeNull();
    expect(internal.retryAttempts).toBe(1);
    internal.scheduleRetry(internal.generation);
    expect(internal.retryAttempts).toBe(2);
    manager.stop();
    expect(internal.retryTimer).toBeNull();
    expect(internal.retryAttempts).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(manager.getSnapshot().state).toBe("offline");
  });

  it("does not request streaming when the user has not selected a PC", () => {
    const { manager, send } = setup();
    manager.setCompanionOpen(true, null);
    expect(send).not.toHaveBeenCalled();
    manager.stop();
  });
});
