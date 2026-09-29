import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import type { HandoffApi } from "@/services/handoffService";

export type HandoffStatus = "signed-out" | "loading" | "synced" | "offline";

export interface HandoffSnapshot {
  status: HandoffStatus;
  devices: OwnedDevice[];
  received: Handoff[];
  targetDeviceId: string | null;
  error: string | null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Account-scoped handoffs sent through Supabase, with no direct device networking. */
export class HandoffStore {
  private snapshot: HandoffSnapshot = {
    status: "signed-out",
    devices: [],
    received: [],
    targetDeviceId: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private currentDeviceId: string | null = null;
  private generation = 0;

  constructor(
    private api: HandoffApi,
    private getDeviceId: (userId: string) => string,
    private onSent?: () => void,
    private onClipboard?: () => void,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HandoffSnapshot => this.snapshot;

  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    if (!userId) {
      this.currentDeviceId = null;
      this.publish({
        status: "signed-out",
        devices: [],
        received: [],
        targetDeviceId: null,
        error: null,
      });
      return;
    }
    const currentDeviceId = this.getDeviceId(userId);
    this.currentDeviceId = currentDeviceId;
    this.publish({ ...this.snapshot, status: "loading", devices: [], received: [], error: null });
    await this.load(userId, currentDeviceId, this.generation);
  }

  async reload(): Promise<void> {
    if (!this.userId || !this.currentDeviceId) return;
    const generation = this.generation;
    this.publish({ ...this.snapshot, status: "loading", error: null });
    await this.load(this.userId, this.currentDeviceId, generation);
  }

  selectTarget(deviceId: string | null): void {
    if (deviceId === this.currentDeviceId) return;
    if (deviceId && !this.snapshot.devices.some((device) => device.id === deviceId)) return;
    this.publish({ ...this.snapshot, targetDeviceId: deviceId });
  }

  /** Destination delivery and manual send share the same confirmed online write. */
  async send(text: string, source: "dictation" | "clipboard" = "dictation"): Promise<void> {
    const { userId, currentDeviceId } = this.requireConnected();
    const handoff = text.trim();
    if (!handoff) throw new Error("Enter text to send.");
    const generation = this.generation;
    try {
      await this.api.send(userId, handoff, currentDeviceId, this.snapshot.targetDeviceId);
      try { this.onSent?.(); } catch { /* usage must not fail dest delivery */ }
      if (source === "clipboard") {
        try { this.onClipboard?.(); } catch { /* usage must not fail dest delivery */ }
      }
      if (generation === this.generation) this.publish({ ...this.snapshot, error: null });
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  async consume(id: string): Promise<void> {
    this.requireConnected();
    const generation = this.generation;
    try {
      await this.api.consume(id);
      if (generation === this.generation) {
        this.publish({
          ...this.snapshot,
          received: this.snapshot.received.filter((handoff) => handoff.id !== id),
          error: null,
        });
      }
    } catch (reason) {
      this.reportFailure(generation, reason);
      throw reason;
    }
  }

  private requireConnected(): { userId: string; currentDeviceId: string } {
    if (!this.userId || !this.currentDeviceId) throw new Error("Sign in to send text between devices.");
    if (this.snapshot.status !== "synced") {
      throw new Error("Device handoff is unavailable until sync reconnects.");
    }
    return { userId: this.userId, currentDeviceId: this.currentDeviceId };
  }

  private async load(userId: string, currentDeviceId: string, generation: number): Promise<void> {
    try {
      const [devices, received] = await Promise.all([
        this.api.listDevices(userId),
        this.api.listReceived(userId, currentDeviceId),
      ]);
      if (generation !== this.generation) return;
      const otherDevices = devices.filter((device) => device.id !== currentDeviceId);
      const targetStillExists = this.snapshot.targetDeviceId
        && otherDevices.some((device) => device.id === this.snapshot.targetDeviceId);
      this.publish({
        status: "synced",
        devices: otherDevices,
        received,
        targetDeviceId: targetStillExists ? this.snapshot.targetDeviceId : null,
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

  private publish(next: HandoffSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
