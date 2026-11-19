import { describe, expect, it, vi } from "vitest";
import { parseBleWatchManifest, parseWatchPress, parseWatchManifest } from "@/wearables/watchProtocol";
import { WearableManager } from "@/wearables/WearableManager";
import { WatchTapRouter } from "@/wearables/watchAction";

describe("UDP watch V0 protocol", () => {
  const manifest = {
    protocol: "udp/1", device_id: "watch-v0", firmware_version: "sim-0.1.0",
    capabilities: ["button.primary"],
  };
  it("accepts only the implemented capability and known version", () => {
    expect(parseWatchManifest(manifest).capabilities).toEqual(["button.primary"]);
    expect(() => parseWatchManifest({ ...manifest, capabilities: ["camera.capture"] })).toThrow();
    expect(() => parseWatchManifest({ ...manifest, protocol: "udp/2" })).toThrow();
    expect(parseBleWatchManifest({ v: 1, id: "watch-v0", caps: ["button.primary"] }).device_id).toBe("watch-v0");
    expect(() => parseBleWatchManifest({ v: 2, id: "watch-v0", caps: ["button.primary"] })).toThrow();
  });
  it("rejects malformed or unsupported events", () => {
    expect(() => parseWatchPress({ type: "event", protocol: "udp/1", device_id: "watch-v0", event: "camera.capture", seq: 1 }, "virtual")).toThrow();
  });
});

describe("wearable manager", () => {
  it("virtual watch can connect, emit one event, disconnect and reject after disconnect", () => {
    const manager = new WearableManager();
    const onPress = vi.fn();
    manager.onPress(onPress);
    expect(manager.pressVirtual()).toBe(false);
    manager.connectVirtual();
    expect(manager.pressVirtual()).toBe(true);
    expect(onPress).toHaveBeenCalledOnce();
    expect(onPress.mock.calls[0]?.[0]).toMatchObject({ source: "virtual", event: "button.primary.pressed" });
    manager.disconnect();
    expect(manager.pressVirtual()).toBe(false);
    expect(onPress).toHaveBeenCalledOnce();
  });
  it("rejects duplicate and untrusted physical events", () => {
    const manager = new WearableManager();
    const onPress = vi.fn();
    manager.onPress(onPress);
    manager.beginBluetoothConnection();
    expect(manager.receive({ type: "event", protocol: "udp/1", device_id: "watch-v0", event: "button.primary.pressed", seq: 1 }, "bluetooth")).toBe(false);
    manager.confirmBluetooth({ v: 1, id: "watch-v0", caps: ["button.primary"] });
    const press = { type: "event", protocol: "udp/1", device_id: "watch-v0", event: "button.primary.pressed", seq: 1 };
    expect(manager.receive(press, "bluetooth")).toBe(true);
    expect(manager.receive(press, "bluetooth")).toBe(false);
    expect(manager.receive({ ...press, seq: 2 }, "virtual")).toBe(false);
    expect(onPress).toHaveBeenCalledOnce();
  });
  it("rejects unknown BLE capabilities", () => {
    const manager = new WearableManager();
    manager.beginBluetoothConnection();
    manager.confirmBluetooth({ v: 1, id: "watch-v0", caps: ["camera.capture"] });
    expect(manager.getSnapshot().status).toBe("error");
  });
});

describe("watch tap routes through existing Assistant lifecycle", () => {
  it("starts through the provided conversation-lease handler and taps again to stop", async () => {
    const router = new WatchTapRouter();
    const start = vi.fn(async () => undefined);
    const stop = vi.fn();
    expect(await router.handle({ signedIn: true, dictationBusy: false, status: "IDLE" }, start, stop)).toBe("started");
    expect(start).toHaveBeenCalledOnce();
    expect(await router.handle({ signedIn: true, dictationBusy: false, status: "READY" }, start, stop)).toBe("stopped");
    expect(stop).toHaveBeenCalledOnce();
  });
  it("blocks sign-out and microphone conflicts", async () => {
    const router = new WatchTapRouter();
    const start = vi.fn(async () => undefined);
    const stop = vi.fn();
    expect(await router.handle({ signedIn: false, dictationBusy: false, status: "IDLE" }, start, stop)).toBe("blocked");
    expect(await router.handle({ signedIn: true, dictationBusy: true, status: "IDLE" }, start, stop)).toBe("blocked");
    expect(start).not.toHaveBeenCalled();
  });
  it("serializes two rapid start attempts and clears state after error", async () => {
    const router = new WatchTapRouter();
    let resume!: () => void;
    const start = vi.fn(() => new Promise<void>(resolve => { resume = resolve; }));
    const stop = vi.fn();
    const first = router.handle({ signedIn: true, dictationBusy: false, status: "IDLE" }, start, stop);
    expect(await router.handle({ signedIn: true, dictationBusy: false, status: "IDLE" }, start, stop)).toBe("busy");
    resume();
    expect(await first).toBe("started");
    await expect(router.handle({ signedIn: true, dictationBusy: false, status: "ERROR" },
      async () => { throw new Error("fail"); }, stop)).rejects.toThrow("fail");
    expect(await router.handle({ signedIn: true, dictationBusy: false, status: "READY" },
      async () => undefined, stop)).toBe("stopped");
  });
});
