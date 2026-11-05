import { dragEndpoints, executableShortcut, isTrustedRemoteAction, parseRemotePointer, type ComputerCall, type RemoteComputerAction } from "@/assistant/computerActions";
import { askComputerAction, fulfillComputerAction, type ComputerActionApi } from "@/assistant/computerRemote";
import type { ComputerImage } from "@/assistant/computerTask";
import type { RemoteDevice } from "@/assistant/remoteContext";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import { loadRemoteComputerActions } from "@/settings/deviceSettings";
import { resolvePairedVoiceTarget } from "@/assistant/remoteVoiceTarget";
import { pairedPublicKey } from "@/assistant/remoteVoiceProof";
import { snapshotFromNative } from "@/assistant/snapshot";
import { encodeSnapshotJpeg } from "@/assistant/snapshotEncode";
import { proposeComputerStep } from "@/services/computerStep";
import { trustedRemoteApi } from "@/services/trustedRemoteService";
import { invoke } from "@tauri-apps/api/core";

export interface ComputerApproval {
  id: string;
  label: string;
}

export interface RemoteGoalState {
  requesterDeviceId: string;
  status: "starting" | "running" | "stopping" | "stopped" | "completed" | "failed";
  steps: number;
  lastAction: string;
  result: string;
}

export interface ComputerActionSnapshot {
  approval: ComputerApproval | null;
}

/**
 * Local allowlisted actions, the Computer Use step host, and remote allowlisted actions.
 * Shell is not a method on this store.
 */
export class ComputerActionStore {
  private snapshot: ComputerActionSnapshot = { approval: null };
  private listeners = new Set<() => void>();
  private approvedId: string | null = null;
  private polling = false;
  private trustedBackendSeen = false;
  private remoteGoal: RemoteGoalState | null = null;
  private pendingGoalStart: { requestId: string; goal: string; requesterDeviceId: string; ownerId: string } | null = null;
  private remoteGoalRunner: ((goal: string, progress: (step: number, action: string) => void, validate: () => Promise<void>) => Promise<string>) | null = null;
  private remoteGoalStop: (() => void) | null = null;

  /** The Windows Assistant owns the executor. This store only routes signed session commands. */
  setRemoteGoalRunner(
    runner: (goal: string, progress: (step: number, action: string) => void, validate: () => Promise<void>) => Promise<string>,
    stop: () => void,
  ): void {
    this.remoteGoalRunner = runner;
    this.remoteGoalStop = stop;
  }

  stopRemoteGoal(): void {
    if (this.remoteGoal?.status === "starting") {
      this.remoteGoal.status = "stopped";
      this.pendingGoalStart = null;
    } else if (this.remoteGoal?.status === "running") {
      this.remoteGoal.status = "stopping";
      this.remoteGoalStop?.();
    }
  }

  constructor(
    private api: ComputerActionApi & { touch(deviceId: string): Promise<void> },
    private listDevices: (userId: string) => Promise<RemoteDevice[]>,
    private getDeviceId: (userId: string) => string,
    private platform: PlatformAdapter,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ComputerActionSnapshot => this.snapshot;

  openApp(id: string): Promise<string> {
    return this.platform.openAllowlistedApp(id);
  }

  pressShortcut(id: string): Promise<string> {
    return this.platform.pressAllowlistedShortcut(id, true);
  }

  async remoteAction(action: RemoteComputerAction, argument: string, deviceName: string | null): Promise<string> {
    const userId = this.userId;
    if (!userId) throw new Error("Sign in to use another device.");
    const devices = await this.listDevices(userId);
    const currentId = this.getDeviceId(userId);
    const target = await resolvePairedVoiceTarget(devices, currentId, deviceName);
    return askComputerAction(
      this.api,
      userId,
      this.getDeviceId(userId),
      devices,
      target.id,
      action,
      argument,
      { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    );
  }

  async capture(): Promise<ComputerImage> {
    const shot = snapshotFromNative(await this.platform.computerCapture(), encodeSnapshotJpeg);
    return { jpeg: shot.jpeg, width: shot.width, height: shot.height };
  }

  propose(body: Record<string, unknown>): Promise<unknown> {
    return proposeComputerStep(body);
  }

  async execute(call: ComputerCall): Promise<string> {
    if (call.name === "click" || call.name === "double_click") {
      if (typeof call.args.x !== "number" || typeof call.args.y !== "number") {
        throw new Error("The click coordinates were not valid.");
      }
      if (this.platform.computerPointerAction) return this.platform.computerPointerAction(call.name, call.args.x, call.args.y);
      return this.platform.computerClick(call.args.x, call.args.y, call.name === "double_click" ? 2 : 1);
    }
    if (call.name === "drag_and_drop") {
      const endpoints = dragEndpoints(call.args.path);
      if (!endpoints || !this.platform.computerPointerAction) throw new Error("Cannot execute this drag path.");
      return this.platform.computerPointerAction("drag", endpoints.x, endpoints.y, endpoints.endX, endpoints.endY);
    }
    if (call.name === "move" || call.name === "right_click" || call.name === "drag") {
      if (!this.platform.computerPointerAction) throw new Error("Desktop pointer control is not available on this device.");
      const { x, y, end_x, end_y } = call.args;
      if (typeof x !== "number" || typeof y !== "number") throw new Error("Pointer coordinates are required.");
      return this.platform.computerPointerAction(call.name, x, y,
        typeof end_x === "number" ? end_x : undefined,
        typeof end_y === "number" ? end_y : undefined);
    }
    if (call.name === "type") {
      if (typeof call.args.text !== "string") throw new Error("Text is required.");
      await this.platform.insertText(call.args.text);
      return "Typed the text into the focused app.";
    }
    if (call.name === "press_key" || call.name === "hotkey") {
      const shortcut = executableShortcut(call);
      if (!shortcut) throw new Error("That shortcut is not on the allowlist.");
      return this.platform.pressAllowlistedShortcut(shortcut, false);
    }
    if (call.name === "take_screenshot") return "Captured the screen.";
    if (call.name === "wait") return "Paused.";
    throw new Error("That action is not available.");
  }

  restore(): Promise<void> {
    return this.platform.computerRestore();
  }

  /** Set by App when the signed-in user changes. Remote asks need it. */
  userId: string | null = null;

  async poll(userId: string): Promise<void> {
    // Never run the same request in overlapping receiver polls or UI callbacks.
    if (this.polling) return;
    this.polling = true;
    try {
      const currentId = this.getDeviceId(userId);
      try { await this.api.touch(currentId); } catch { /* presence is best-effort */ }
      const pending = await this.api.listPending(userId, currentId);
      // A start command that expired or was deleted before its signed reply may not launch later.
      if (this.pendingGoalStart && this.remoteGoal?.status === "starting" &&
          !pending.some(row => row.id === this.pendingGoalStart?.requestId)) {
        this.pendingGoalStart = null;
        this.remoteGoal = null;
      }
      const remoteEnabled = loadRemoteComputerActions();
      // Backend missing, no trusted grant, account signed out, or Android:
      // fail closed to ordinary per-action Windows confirmation.
      let grants: Awaited<ReturnType<typeof trustedRemoteApi.list>> = [];
      let trustedBackendAvailable = false;
      if (remoteEnabled && this.platform.platform === "windows" && this.userId === userId && pending.length) {
        try {
          grants = await trustedRemoteApi.list(currentId);
          trustedBackendAvailable = true;
          this.trustedBackendSeen = true;
        } catch { /* Older backends support ordinary per-action approval only. */ }
      }
      let waiting: ComputerApproval | null = null;
      for (const row of pending) {
        // Once trusted control has been available in this app process, an
        // unavailable backend must not turn stale claimed actions into new
        // manual approvals.
        if (this.trustedBackendSeen && !trustedBackendAvailable) continue;
        if (trustedBackendAvailable) {
          try {
            if (await trustedRemoteApi.wasClaimed(currentId, row.id)) continue;
          } catch {
            // Don't execute or approve if the duplicate-prevention check
            // cannot be completed. Retry the safe read on the next poll.
            continue;
          }
        }
        const eligible = this.approvedId !== row.id &&
          this.userId === userId && this.platform.platform === "windows" && remoteEnabled &&
          isTrustedRemoteAction(row.action, row.argument) &&
          grants.some(grant => grant.phone_device_id === row.requesterDeviceId &&
            !grant.stopped_at && Date.parse(grant.expires_at) > Date.now());
        const sessionControl = row.action === "computer_goal_status" || row.action === "stop_computer_goal";
        const outcome = await fulfillComputerAction(
          this.api, row, this.platform.platform, remoteEnabled,
          sessionControl && this.userId === userId ? row.id : this.approvedId,
          async (action, argument, trusted) => {
            if (trusted) {
              // Fresh remote grant, pairing, request and native lock checks
              // immediately before the OS operation. No caches are authoritative.
              if (this.userId !== userId ||
                  !await trustedRemoteApi.validate(currentId, row.id) ||
                  !await invoke<boolean>("trusted_desktop_unlocked")) {
                throw new Error("Trusted control was stopped, expired, or the PC is locked.");
              }
            }
            return this.run(action, argument, row.requesterDeviceId, row.id);
          },
          eligible ? {
            claim: async () => {
              if (!await invoke<boolean>("trusted_desktop_unlocked")) return "none";
              return trustedRemoteApi.claim(currentId, row.id);
            },
          } : null,
        );
        // Start the background task only AFTER the signed start acknowledgment is committed.
        // A timed-out or rejected request must never leave an unauthorized running task.
        if (row.action === "start_computer_goal" && outcome.action === "answered") {
          this.launchRemoteGoal(row.id);
        } else if (row.action === "start_computer_goal" && outcome.action === "denied" &&
          this.pendingGoalStart?.requestId === row.id) {
          this.pendingGoalStart = null;
          if (this.remoteGoal?.status === "starting") this.remoteGoal = null;
        }
        if (outcome.action === "waiting" && outcome.label && !waiting) {
          waiting = { id: row.id, label: outcome.label };
        }
      }
      if (this.approvedId && !pending.some(row => row.id === this.approvedId)) this.approvedId = null;
      this.setApproval(waiting);
    } finally {
      this.polling = false;
    }
  }

  async approve(userId: string): Promise<void> {
    if (!this.snapshot.approval) return;
    this.approvedId = this.snapshot.approval.id;
    await this.poll(userId);
  }

  async deny(userId: string): Promise<void> {
    const approval = this.snapshot.approval;
    if (!approval) return;
    await this.api.deny(userId, approval.id, "The action was not allowed.");
    if (this.approvedId === approval.id) this.approvedId = null;
    this.setApproval(null);
  }

  private launchRemoteGoal(requestId: string): void {
    const pending = this.pendingGoalStart;
    if (!pending || pending.requestId !== requestId || this.remoteGoal?.status !== "starting" || !this.remoteGoalRunner) return;
    this.pendingGoalStart = null;
    const state = this.remoteGoal;
    state.status = "running";
    const validate = async () => {
      if (this.userId !== pending.ownerId || !loadRemoteComputerActions() ||
        !await invoke<boolean>("trusted_desktop_unlocked")) throw new Error("Computer Use stopped: PC locked, signed out, or remote actions disabled.");
      await pairedPublicKey(this.getDeviceId(pending.ownerId), pending.requesterDeviceId);
    };
    void this.remoteGoalRunner(pending.goal,
      (step, name) => { state.steps = step; state.lastAction = name; }, validate,
    ).then(result => {
      state.status = state.status === "stopping" ? "stopped" : "completed";
      state.result = result.slice(0, 1000);
    }).catch(error => {
      state.status = state.status === "stopping" ? "stopped" : "failed";
      state.result = error instanceof Error ? error.message.slice(0, 1000) : "The Computer Use task failed.";
    });
  }

  private async run(action: RemoteComputerAction, argument: string, requesterDeviceId: string, requestId: string): Promise<string> {
    if (action === "computer_goal_status" || action === "stop_computer_goal") {
      const goal = this.remoteGoal;
      if (!goal) return "No Computer Use session has been started on this PC.";
      if (goal.requesterDeviceId !== requesterDeviceId) throw new Error("This session belongs to a different paired device.");
      if (action === "stop_computer_goal") this.stopRemoteGoal();
      return `Computer Use ${goal.status}; ${goal.steps} steps; ${goal.lastAction || "no actions yet"}; ${goal.result}`.slice(0,1500);
    }
    if (action === "start_computer_goal") {
      if (!this.remoteGoalRunner) throw new Error("Computer Use is not ready on this PC.");
      if (this.remoteGoal?.status === "running" || this.remoteGoal?.status === "stopping" ||
          this.remoteGoal?.status === "starting") throw new Error("A Computer Use session is already active.");
      if (!await invoke<boolean>("trusted_desktop_unlocked")) throw new Error("Unlock Windows before starting Computer Use.");
      const owner = this.userId;
      if (!owner) throw new Error("Sign in before using remote Computer Use.");
      await pairedPublicKey(this.getDeviceId(owner), requesterDeviceId);
      this.remoteGoal = { requesterDeviceId, status: "starting", steps: 0, lastAction: "", result: "" };
      this.pendingGoalStart = { requestId, goal: argument, requesterDeviceId, ownerId: owner };
      return "Computer Use goal accepted on Windows. Check computer_goal_status for progress or use stop_computer_goal to stop.";
    }
    const pointer = parseRemotePointer(action, argument);
    if (pointer) {
      if (!this.platform.computerPointerAction) throw new Error("This PC cannot control its pointer.");
      if (!await invoke<boolean>("trusted_desktop_unlocked")) throw new Error("Unlock the Windows desktop first.");
      return this.platform.computerPointerAction(pointer.kind, pointer.x, pointer.y, pointer.endX, pointer.endY);
    }
    if (action.endsWith("_pointer")) throw new Error("Invalid pointer command.");
    if (action === "open_app") return this.platform.openAllowlistedApp(argument);
    if (action === "press_shortcut") return this.platform.pressAllowlistedShortcut(argument, true);
    await this.platform.insertText(argument);
    return "Inserted the text into the focused app.";
  }

  private setApproval(approval: ComputerApproval | null): void {
    if (this.snapshot.approval?.id === approval?.id && this.snapshot.approval?.label === approval?.label) return;
    this.snapshot = { approval };
    for (const listener of this.listeners) listener();
  }
}
