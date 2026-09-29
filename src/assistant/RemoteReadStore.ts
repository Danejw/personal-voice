import { askRemote, fulfillRemoteRequest } from "@/assistant/remoteContextChannel";
import {
  planRemoteRead,
  resolveRemoteDevice,
  type RemoteDevice,
  type RemoteKind,
  type RemoteResponse,
} from "@/assistant/remoteContext";
import type { RemoteContextApi } from "@/assistant/remoteContextChannel";
import { snapshotFromNative } from "@/assistant/snapshot";
import type { ScreenSnapshot } from "@/assistant/snapshot";
import { encodeSnapshotJpeg } from "@/assistant/snapshotEncode";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import { loadRemoteReads } from "@/settings/deviceSettings";

export interface RemoteApproval {
  id: string;
  label: string;
}

export interface RemoteReadSnapshot {
  approval: RemoteApproval | null;
}

/**
 * Asks another owned device for a read, and answers reads aimed at this device.
 * A screenshot waits for Allow once. The request row is deleted after it is read.
 */
export class RemoteReadStore {
  private snapshot: RemoteReadSnapshot = { approval: null };
  private listeners = new Set<() => void>();
  private notified = new Set<string>();

  constructor(
    private api: RemoteContextApi & { touch(deviceId: string): Promise<void> },
    private listDevices: (userId: string) => Promise<RemoteDevice[]>,
    private getDeviceId: (userId: string) => string,
    private platform: PlatformAdapter,
    private onScreenshotRequest?: (id: string) => void,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RemoteReadSnapshot => this.snapshot;

  /** Read-only. Throws when the device is unknown, ambiguous, offline, or the read is refused. */
  async ask(userId: string, kind: RemoteKind, deviceName: string | null): Promise<{ text: string; screenshot: ScreenSnapshot | null }> {
    const devices = await this.listDevices(userId);
    const currentId = this.getDeviceId(userId);
    const resolved = resolveRemoteDevice(devices, currentId, deviceName, Date.now());
    if (!resolved.ok) throw new Error(resolved.message);
    const response = await askRemote(
      this.api,
      userId,
      currentId,
      resolved.device.id,
      resolved.device.name,
      kind,
      { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    );
    return { text: response.text, screenshot: snapshotFromResponse(response) };
  }

  /** Answers pending reads for this device and refreshes last_seen. */
  async poll(userId: string): Promise<void> {
    const currentId = this.getDeviceId(userId);
    try { await this.api.touch(currentId); } catch { /* presence is best-effort */ }
    const devices = await this.listDevices(userId);
    const mine = devices.find((device) => device.id === currentId);
    const pending = await this.api.listPending(userId, currentId);
    let waiting: { id: string } | null = null;
    for (const row of pending) {
      const plan = planRemoteRead(row.kind, this.platform.platform, loadRemoteReads());
      if (plan.action === "approve-screenshot") {
        if (!waiting) waiting = { id: row.id };
        continue;
      }
      await fulfillRemoteRequest(this.api, row, this.local(userId, mine?.name ?? "This device", null));
    }
    if (waiting) {
      if (this.snapshot.approval?.id !== waiting.id) {
        this.snapshot = { approval: { id: waiting.id, label: "Another device asked for a one-time screenshot of this PC." } };
        if (!this.notified.has(waiting.id)) {
          this.notified.add(waiting.id);
          try { this.onScreenshotRequest?.(waiting.id); } catch { /* the banner still shows */ }
        }
        this.publish();
      }
      return;
    }
    if (this.snapshot.approval) {
      this.snapshot = { approval: null };
      this.publish();
    }
  }

  async approve(userId: string): Promise<void> {
    const approval = this.snapshot.approval;
    if (!approval) return;
    const row = await this.api.get(userId, approval.id);
    this.snapshot = { approval: null };
    this.publish();
    if (!row || row.status !== "pending") return;
    const devices = await this.listDevices(userId);
    const mine = devices.find((device) => device.id === this.getDeviceId(userId));
    await fulfillRemoteRequest(this.api, row, this.local(userId, mine?.name ?? "This device", approval.id));
  }

  async deny(userId: string): Promise<void> {
    const approval = this.snapshot.approval;
    if (!approval) return;
    this.snapshot = { approval: null };
    this.publish();
    await this.api.deny(userId, approval.id, "The screenshot was not allowed.");
  }

  private local(userId: string, deviceName: string, approvedScreenshotId: string | null) {
    return {
      userId,
      deviceName,
      platform: this.platform.platform,
      remoteReads: loadRemoteReads(),
      approvedScreenshotId,
      describe: () => this.platform.describeWindows(),
      capture: async () => {
        const native = snapshotFromNative(await this.platform.captureSnapshot(), encodeSnapshotJpeg);
        return {
          jpeg: native.jpeg,
          sourceApp: native.sourceApp ?? null,
          width: native.width,
          height: native.height,
        };
      },
    };
  }

  private publish() {
    for (const listener of this.listeners) listener();
  }
}

function snapshotFromResponse(response: RemoteResponse): ScreenSnapshot | null {
  const shot = response.screenshot;
  if (!shot) return null;
  return {
    source: "window",
    ...(shot.sourceApp ? { sourceApp: shot.sourceApp } : {}),
    capturedAt: new Date().toISOString(),
    jpeg: shot.jpeg,
    width: shot.width,
    height: shot.height,
  };
}
