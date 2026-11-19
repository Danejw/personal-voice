import {
  parseBleWatchManifest, parseWatchManifest, parseWatchPress,
  type WatchEvent, type WearableSnapshot, type WearableSource,
} from "@/wearables/watchProtocol";

const DISCONNECTED: WearableSnapshot = {
  status: "disconnected", source: null, deviceId: null,
  capabilities: [], lastEvent: null, error: null,
};

export class WearableManager {
  private state: WearableSnapshot = DISCONNECTED;
  private listeners = new Set<() => void>();
  private pressListeners = new Set<(event: WatchEvent) => void>();
  private lastSequence = -1;
  private virtualSequence = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): WearableSnapshot => this.state;
  onPress = (listener: (event: WatchEvent) => void): (() => void) => {
    this.pressListeners.add(listener);
    return () => this.pressListeners.delete(listener);
  };
  private publish(next: WearableSnapshot): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  connectVirtual(): void {
    const manifest = parseWatchManifest({
      type: "manifest", protocol: "udp/1",
      device_id: "watch-v0", firmware_version: "sim-0.1.0",
      capabilities: ["button.primary"],
    });
    this.lastSequence = -1;
    this.virtualSequence = 0;
    this.publish({
      status: "connected", source: "virtual", deviceId: manifest.device_id,
      capabilities: manifest.capabilities, lastEvent: null, error: null,
    });
  }
  beginBluetoothConnection(): void {
    this.lastSequence = -1;
    this.publish({
      status: "connecting", source: "bluetooth", deviceId: null,
      capabilities: [], lastEvent: null, error: null,
    });
  }
  confirmBluetooth(value: unknown): void {
    if (this.state.source !== "bluetooth" || this.state.status !== "connecting") return;
    try {
      const manifest = parseBleWatchManifest(value);
      this.lastSequence = -1;
      this.publish({
        status: "connected", source: "bluetooth",
        deviceId: manifest.device_id, capabilities: manifest.capabilities,
        lastEvent: null, error: null,
      });
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : "Invalid BLE watch");
    }
  }
  pressVirtual(): boolean {
    if (this.state.source !== "virtual" || this.state.status !== "connected") return false;
    this.virtualSequence += 1;
    return this.receive({
      type: "event", protocol: "udp/1", device_id: "watch-v0",
      event: "button.primary.pressed", seq: this.virtualSequence,
    }, "virtual");
  }
  receive(value: unknown, source: WearableSource): boolean {
    if (this.state.status !== "connected" || this.state.source !== source ||
        !this.state.capabilities.includes("button.primary")) return false;
    let event: WatchEvent;
    try { event = parseWatchPress(value, source); }
    catch { return false; }
    if (this.state.deviceId !== event.device_id || event.seq <= this.lastSequence) return false;
    this.lastSequence = event.seq;
    this.publish({ ...this.state, lastEvent: event.event, error: null });
    for (const listener of this.pressListeners) listener(event);
    return true;
  }
  reportError(message: string): void {
    this.publish({ ...this.state, status: "error", error: message });
  }
  disconnect(): void {
    this.lastSequence = -1;
    this.publish(DISCONNECTED);
  }
}

export const wearableManager = new WearableManager();
