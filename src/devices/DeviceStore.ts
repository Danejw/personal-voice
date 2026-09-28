import type { OwnedDevice } from "@/handoffs/handoff";
import type { DeviceApi } from "@/services/deviceService";
import { MAX_DEVICE_NAME } from "@/services/deviceService";

export type DeviceStatus = "signed-out" | "loading" | "synced" | "offline";

export interface DeviceSnapshot {
  status: DeviceStatus;
  devices: OwnedDevice[];
  currentDeviceId: string | null;
  error: string | null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Account device list for rename/remove. Does not issue remote commands. */
export class DeviceStore {
  private snapshot: DeviceSnapshot = {
    status: "signed-out",
    devices: [],
    currentDeviceId: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private currentDeviceId: string | null = null;
  private generation = 0;

  constructor(
    private api: DeviceApi,
    private getDeviceId: (userId: string) => string,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DeviceSnapshot => this.snapshot;

  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    if (!userId) {
      this.currentDeviceId = null;
      this.publish({
        status: "signed-out",
        devices: [],
        currentDeviceId: null,
        error: null,
      });
      return;
    }
    const currentDeviceId = this.getDeviceId(userId);
    this.currentDeviceId = currentDeviceId;
    this.publish({
      ...this.snapshot,
      status: "loading",
      devices: [],
      currentDeviceId,
      error: null,
    });
    await this.load(userId, currentDeviceId, this.generation);
  }

  async reload(): Promise<void> {
    if (!this.userId || !this.currentDeviceId) return;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "loading", error: null });
    await this.load(this.userId, this.currentDeviceId, generation);
  }

  async rename(id: string, rawName: string): Promise<void> {
    this.requireConnected();
    const name = rawName.trim();
    if (!name) throw new Error("Enter a device name.");
    if (name.length > MAX_DEVICE_NAME) {
      throw new Error(`Device names can be at most ${MAX_DEVICE_NAME} characters.`);
    }
    const generation = this.generation;
    try {
      await this.api.rename(id, name);
      if (generation !== this.generation) return;
      this.publish({
        ...this.snapshot,
        devices: this.snapshot.devices.map((device) => device.id === id ? { ...device, name } : device),
        error: null,
      });
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  async remove(id: string): Promise<void> {
    this.requireConnected();
    if (id === this.currentDeviceId) throw new Error("You can't remove the device you're using.");
    const generation = this.generation;
    try {
      await this.api.remove(id);
      if (generation !== this.generation) return;
      this.publish({
        ...this.snapshot,
        devices: this.snapshot.devices.filter((device) => device.id !== id),
        error: null,
      });
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  private requireConnected(): void {
    if (!this.userId || !this.currentDeviceId) throw new Error("Sign in to manage devices.");
    if (this.snapshot.status !== "synced") {
      throw new Error("Devices are unavailable until sync reconnects.");
    }
  }

  private async load(userId: string, currentDeviceId: string, generation: number): Promise<void> {
    try {
      const devices = await this.api.list(userId);
      if (generation !== this.generation) return;
      this.publish({
        status: "synced",
        devices,
        currentDeviceId,
        error: null,
      });
    } catch (reason) {
      if (generation !== this.generation) return;
      this.publish({ ...this.snapshot, status: "offline", error: messageOf(reason) });
    }
  }

  private reportFailure(generation: number, reason: unknown): void {
    if (generation !== this.generation) return;
    this.publish({ ...this.snapshot, error: messageOf(reason) });
  }

  private publish(next: DeviceSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
