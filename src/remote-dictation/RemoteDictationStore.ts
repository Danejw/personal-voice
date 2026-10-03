import {
  REMOTE_DICTATION_CATCHUP_MS,
  REMOTE_DICTATION_HEARTBEAT_MS,
  REMOTE_DICTATION_SENDER_WAIT_MS,
} from "@/remote-dictation/constants";
import type { LockedRemoteTarget } from "@/remote-dictation/RemoteDictationDestination";
import type { RemoteDictationChangeFeed } from "@/remote-dictation/remoteDictationFeed";
import {
  cycleRemoteTarget,
  eligibleRemoteTargets,
  remoteDeviceKind,
  resolveRemoteTarget,
  type RemoteDeviceKind,
  type RemoteDictationDevice,
} from "@/remote-dictation/targets";
import type { RemoteDictationRequest } from "@/remote-dictation/types";
import type { RemoteDictationApi } from "@/services/remoteDictationService";
import {
  loadRemoteDictation,
  loadRemoteDictationTargetDeviceId,
  saveRemoteDictationTargetDeviceId,
} from "@/settings/deviceSettings";

export type RemoteDictationStoreStatus = "signed-out" | "loading" | "ready" | "offline";

export interface RemoteDictationSnapshot {
  status: RemoteDictationStoreStatus;
  devices: RemoteDictationDevice[];
  targetDeviceId: string | null;
  targetLabel: string | null;
  targetPlatform: string | null;
  targetKind: RemoteDeviceKind;
  targetOnline: boolean;
  targetCount: number;
  notice: string | null;
  error: string | null;
  active: boolean;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Source target selection plus receiver claim/insert lifecycle.
 * DictationController only sees the destination interface; this store owns transport.
 */
export class RemoteDictationStore {
  private snapshot: RemoteDictationSnapshot = {
    status: "signed-out",
    devices: [],
    targetDeviceId: null,
    targetLabel: null,
    targetPlatform: null,
    targetKind: "unknown",
    targetOnline: false,
    targetCount: 0,
    notice: null,
    error: null,
    active: false,
  };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private currentDeviceId: string | null = null;
  private generation = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private catchupTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeFeed: (() => void) | null = null;
  private handling = new Set<string>();
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private api: RemoteDictationApi,
    private listDevices: (userId: string) => Promise<RemoteDictationDevice[]>,
    private getDeviceId: (userId: string) => string,
    private insertReceivedText: (text: string) => Promise<void>,
    private feed: RemoteDictationChangeFeed,
    private now: () => number = () => Date.now(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RemoteDictationSnapshot => this.snapshot;

  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    this.stopLoops();
    if (!userId) {
      this.currentDeviceId = null;
      this.publish({
        status: "signed-out",
        devices: [],
        targetDeviceId: null,
        targetLabel: null,
        targetPlatform: null,
        targetKind: "unknown",
        targetOnline: false,
        targetCount: 0,
        notice: null,
        error: null,
        active: false,
      });
      return;
    }
    this.currentDeviceId = this.getDeviceId(userId);
    this.publish({ ...this.snapshot, status: "loading", error: null });
    await this.refreshDevices(this.generation);
    this.startLoops(userId, this.currentDeviceId);
  }

  async reload(): Promise<void> {
    if (!this.userId || !this.currentDeviceId) return;
    await this.refreshDevices(this.generation);
  }

  /** Tap on the Remote Dictation control. Never starts recording. */
  cycleTarget(): RemoteDictationSnapshot {
    if (!this.currentDeviceId) return this.snapshot;
    const { target, onlyOne } = cycleRemoteTarget(
      this.snapshot.devices,
      this.currentDeviceId,
      this.snapshot.targetDeviceId,
      this.now(),
    );
    if (!target) {
      this.flash("No other device is online.");
      return this.snapshot;
    }
    saveRemoteDictationTargetDeviceId(target.id);
    this.publish({
      ...this.snapshot,
      targetDeviceId: target.id,
      targetLabel: target.name,
      targetPlatform: target.platform,
      targetKind: remoteDeviceKind(target.platform, target.name),
      targetOnline: true,
      notice: null,
      error: null,
    });
    // Windows overlay tip / Android side tip both read this notice.
    this.flash(onlyOne ? `Only device available · ${target.name}` : target.name);
    return this.snapshot;
  }

  /** Target locked for the utterance that is about to start. */
  lockSelectedTarget(): LockedRemoteTarget {
    if (!this.currentDeviceId) throw new Error("Sign in to use Remote Dictation.");
    const target = resolveRemoteTarget(
      this.snapshot.devices,
      this.currentDeviceId,
      this.snapshot.targetDeviceId,
      this.now(),
    );
    if (!target) throw new Error("No other device is online.");
    return this.lockTarget(target.id);
  }

  /**
   * Locks a specific eligible target for this utterance.
   * The id comes from hold-start so later cycling cannot redirect it.
   */
  lockTarget(targetId: string): LockedRemoteTarget {
    if (!this.currentDeviceId) throw new Error("Sign in to use Remote Dictation.");
    if (targetId === this.currentDeviceId) throw new Error("Remote Dictation cannot target this device.");
    const eligible = eligibleRemoteTargets(this.snapshot.devices, this.currentDeviceId, this.now());
    const target = eligible.find((device) => device.id === targetId);
    if (!target) throw new Error("That device is offline. Transcript kept.");
    saveRemoteDictationTargetDeviceId(target.id);
    this.publish({
      ...this.snapshot,
      targetDeviceId: target.id,
      targetLabel: target.name,
      targetPlatform: target.platform,
      targetKind: remoteDeviceKind(target.platform, target.name),
      targetOnline: true,
      active: true,
      error: null,
    });
    return { id: target.id, name: target.name };
  }

  setActive(active: boolean): void {
    if (this.snapshot.active === active) return;
    this.publish({ ...this.snapshot, active });
  }

  /** Source path: create request, wait for acknowledgement, clean up. */
  async send(transcript: string, target: LockedRemoteTarget): Promise<void> {
    if (!this.userId || !this.currentDeviceId) throw new Error("Sign in to use Remote Dictation.");
    if (target.id === this.currentDeviceId) throw new Error("Remote Dictation cannot target this device.");
    const text = transcript.trim();
    if (!text) throw new Error("The transcript is empty or too long.");
    let requestId: string;
    try {
      requestId = await this.api.create(this.currentDeviceId, target.id, text);
    } catch (reason) {
      this.publish({ ...this.snapshot, active: false, error: messageOf(reason) });
      throw reason;
    }
    try {
      const outcome = await this.waitForResult(requestId, target.name);
      if (outcome.ok) {
        this.publish({ ...this.snapshot, active: false, error: null });
        return;
      }
      const failure = new Error(outcome.message);
      this.publish({ ...this.snapshot, active: false, error: outcome.message });
      throw failure;
    } finally {
      try { await this.api.remove(requestId); } catch { /* best-effort cleanup */ }
      this.setActive(false);
    }
  }

  /** Receiver path for one request id (Realtime or catch-up). Exactly-once via claim. */
  async handleRequest(id: string): Promise<void> {
    if (!this.userId || !this.currentDeviceId) return;
    if (this.handling.has(id)) return;
    this.handling.add(id);
    try {
      if (!loadRemoteDictation()) {
        const claimed = await this.api.claim(id, this.currentDeviceId);
        if (claimed) {
          await this.api.complete(id, this.currentDeviceId, false, "Remote dictation is turned off on this device.");
        }
        return;
      }
      const claimed = await this.api.claim(id, this.currentDeviceId);
      if (!claimed) return;
      try {
        await this.insertReceivedText(claimed.text);
        await this.api.complete(id, this.currentDeviceId, true);
      } catch (reason) {
        await this.api.complete(
          id,
          this.currentDeviceId,
          false,
          messageOf(reason).slice(0, 500) || "Windows could not insert the text.",
        );
      }
    } finally {
      this.handling.delete(id);
    }
  }

  private async waitForResult(
    requestId: string,
    targetName: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const deadline = this.now() + REMOTE_DICTATION_SENDER_WAIT_MS;
    while (this.now() < deadline) {
      let row: RemoteDictationRequest | null;
      try {
        row = await this.api.get(requestId);
      } catch {
        await sleep(250);
        continue;
      }
      if (!row) {
        return { ok: false, message: `${targetName} did not respond. Transcript kept.` };
      }
      if (row.status === "inserted") return { ok: true };
      if (row.status === "failed") {
        const detail = row.error?.includes("turned off")
          ? `${targetName} is not accepting remote dictation. Transcript kept.`
          : row.error
            ? `${targetName}: ${row.error} Transcript kept.`
            : `${targetName} did not respond. Transcript kept.`;
        return { ok: false, message: detail };
      }
      await sleep(250);
    }
    return { ok: false, message: `${targetName} did not respond. Transcript kept.` };
  }

  private async refreshDevices(generation: number): Promise<void> {
    if (!this.userId || !this.currentDeviceId) return;
    try {
      const devices = await this.listDevices(this.userId);
      if (generation !== this.generation) return;
      const saved = loadRemoteDictationTargetDeviceId();
      const target = resolveRemoteTarget(devices, this.currentDeviceId, saved, this.now());
      if (target && target.id !== saved) saveRemoteDictationTargetDeviceId(target.id);
      if (!target && saved) saveRemoteDictationTargetDeviceId(null);
      const eligible = eligibleRemoteTargets(devices, this.currentDeviceId, this.now());
      this.publish({
        status: "ready",
        devices,
        targetDeviceId: target?.id ?? null,
        targetLabel: target?.name ?? null,
        targetPlatform: target?.platform ?? null,
        targetKind: target ? remoteDeviceKind(target.platform, target.name) : "unknown",
        targetOnline: Boolean(target),
        targetCount: eligible.length,
        notice: null,
        error: null,
        active: this.snapshot.active,
      });
    } catch (reason) {
      if (generation !== this.generation) return;
      this.publish({ ...this.snapshot, status: "offline", error: messageOf(reason) });
    }
  }

  private startLoops(userId: string, deviceId: string): void {
    this.stopLoops();
    const beat = () => {
      void Promise.resolve(this.api.touch(deviceId)).catch(() => undefined);
    };
    beat();
    this.heartbeatTimer = setInterval(beat, REMOTE_DICTATION_HEARTBEAT_MS);

    const catchUp = () => {
      void this.catchUpPending();
      void this.refreshDevices(this.generation);
    };
    catchUp();
    this.catchupTimer = setInterval(catchUp, REMOTE_DICTATION_CATCHUP_MS);

    this.unsubscribeFeed = this.feed.subscribe(userId, deviceId, (requestId) => {
      if (requestId) void this.handleRequest(requestId);
      else void this.catchUpPending();
    });
  }

  private async catchUpPending(): Promise<void> {
    if (!this.userId || !this.currentDeviceId) return;
    try {
      const pending = await this.api.listPending(this.currentDeviceId);
      for (const row of pending) await this.handleRequest(row.id);
    } catch {
      // Catch-up is best-effort; Realtime remains the primary path.
    }
  }

  private stopLoops(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.catchupTimer) clearInterval(this.catchupTimer);
    this.heartbeatTimer = null;
    this.catchupTimer = null;
    this.unsubscribeFeed?.();
    this.unsubscribeFeed = null;
    this.handling.clear();
  }

  private flash(message: string): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.publish({ ...this.snapshot, notice: message });
    this.noticeTimer = setTimeout(() => {
      if (this.snapshot.notice === message) this.publish({ ...this.snapshot, notice: null });
    }, 2500);
  }

  private publish(next: RemoteDictationSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
