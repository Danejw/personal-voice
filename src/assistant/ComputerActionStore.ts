import { dragEndpoints, executableShortcut, parseRemotePointer, planRemoteComputerAction, type ComputerCall, type RemoteComputerAction } from "@/assistant/computerActions";
import { askComputerAction, fulfillComputerAction, type ComputerActionApi } from "@/assistant/computerRemote";
import type { ComputerImage, ComputerTaskReport } from "@/assistant/computerTask";
import type { RemoteDevice } from "@/assistant/remoteContext";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import { loadRemoteComputerActions } from "@/settings/deviceSettings";
import { resolvePairedVoiceTarget } from "@/assistant/remoteVoiceTarget";
import { pairedPublicKey } from "@/assistant/remoteVoiceProof";
import { snapshotFromNative } from "@/assistant/snapshot";
import { encodeSnapshotJpeg } from "@/assistant/snapshotEncode";
import { proposeComputerStep } from "@/services/computerStep";
import { remoteAutoActionApi } from "@/services/remoteAutoActionService";
import { invoke } from "@tauri-apps/api/core";
import { restoreRemoteGoal, saveRemoteGoal } from "@/assistant/remoteGoalJournal";

export interface ComputerApproval {
  id: string;
  label: string;
}

export interface RemoteGoalState {
  jobId: string;
  requesterDeviceId: string;
  status: "starting" | "running" | "stopping" | "stopped" | "completed" | "needs_review" | "blocked" | "failed" | "interrupted";
  steps: number;
  lastAction: string;
  result: string;
  evidence: string | null;
}

export interface RemoteGoalNotice {
  targetDeviceId: string;
  phase: "queued" | "accepted" | "reported" | "connection-error";
  requestId: string | null;
  message: string;
  receivedAt: number;
}

export interface ComputerActionSnapshot {
  approval: ComputerApproval | null;
  remoteGoal: RemoteGoalNotice | null;
  receiverError: string | null;
}

/**
 * Local allowlisted actions, the Computer Use step host, and remote allowlisted actions.
 * Shell is not a method on this store.
 */
export class ComputerActionStore {
  private snapshot: ComputerActionSnapshot = { approval: null, remoteGoal: null, receiverError: null };
  private listeners = new Set<() => void>();
  private approvedId: string | null = null;
  private polling = false;
  private remoteGoal: RemoteGoalState | null = null;
  private pendingGoalStart: { requestId: string; goal: string; requesterDeviceId: string; ownerId: string } | null = null;
  private remoteGoalRunner: ((goal: string, progress: (step: number, action: string) => void, validate: () => Promise<void>) => Promise<ComputerTaskReport>) | null = null;
  private remoteGoalStop: (() => void) | null = null;

  private persistRemoteGoal(): void {
    if (!this.remoteGoal || !this.userId || this.platform.platform !== "windows") return;
    try {
      saveRemoteGoal(localStorage, this.userId, this.getDeviceId(this.userId), {
        jobId: this.remoteGoal.jobId, requesterDeviceId: this.remoteGoal.requesterDeviceId,
        status: this.remoteGoal.status, steps: this.remoteGoal.steps,
        lastAction: this.remoteGoal.lastAction, result: this.remoteGoal.result,
        updatedAt: Date.now(),
      });
    } catch { /* Storage unavailable: execution is in-memory only. */ }
  }

  /** The Windows Assistant owns the executor. This store only routes signed session commands. */
  setRemoteGoalRunner(
    runner: (goal: string, progress: (step: number, action: string) => void, validate: () => Promise<void>) => Promise<ComputerTaskReport>,
    stop: () => void,
  ): void {
    this.remoteGoalRunner = runner;
    this.remoteGoalStop = stop;
  }

  stopRemoteGoal(): void {
    if (this.remoteGoal?.status === "starting") {
      this.remoteGoal.status = "stopped";
      this.pendingGoalStart = null;
      this.persistRemoteGoal();
    } else if (this.remoteGoal?.status === "running") {
      this.remoteGoal.status = "stopping";
      this.remoteGoalStop?.();
      this.persistRemoteGoal();
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

  /** The receiver remains fail-closed; expose failures instead of silently losing them. */
  reportPollFailure(reason: unknown): void {
    const message = reason === null ? null
      : reason instanceof Error ? reason.message.slice(0, 240)
        : "Remote command delivery is unavailable.";
    if (this.snapshot.receiverError === message) return;
    this.snapshot = { ...this.snapshot, receiverError: message };
    for (const listener of this.listeners) listener();
  }

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
    const isGoalCommand = action === "start_computer_goal"
      || action === "computer_goal_status" || action === "stop_computer_goal";
    let requestId: string | null = null;
    try {
      const result = await askComputerAction(
        this.api, userId, currentId, devices, target.id, action, argument,
        { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
        receipt => {
          requestId = receipt.requestId;
          if (action !== "start_computer_goal" || receipt.stage !== "queued") return;
          this.snapshot = {
            ...this.snapshot,
            remoteGoal: {
              targetDeviceId: target.id, phase: "queued", requestId,
              message: "Waiting for Windows to acknowledge the task.",
              receivedAt: Date.now(),
            },
          };
          for (const listener of this.listeners) listener();
        },
      );
      if (isGoalCommand) {
        this.snapshot = {
          ...this.snapshot,
          remoteGoal: {
            targetDeviceId: target.id, phase: action === "start_computer_goal" ? "accepted" : "reported",
            message: result.slice(0, 1500), requestId, receivedAt: Date.now(),
          },
        };
        for (const listener of this.listeners) listener();
      }
      return result;
    } catch (error) {
      // A timeout is an unknown outcome, not proof that Windows never executed the task.
      if (isGoalCommand) {
        const message = error instanceof Error ? error.message : "Command response unavailable.";
        this.snapshot = {
          ...this.snapshot,
          remoteGoal: {
            targetDeviceId: target.id, phase: "connection-error",
            message: `Command response unavailable: ${message} Check status before trying again.`.slice(0, 1500),
            requestId, receivedAt: Date.now(),
          },
        };
        for (const listener of this.listeners) listener();
      }
      throw error;
    }
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
    if (call.name === "scroll") {
      if (!this.platform.computerPointerAction) throw new Error("Desktop scrolling is unavailable on this device.");
      const { x, y, direction } = call.args;
      if (typeof x !== "number" || typeof y !== "number" ||
        (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right")) {
        throw new Error("Scroll requires valid coordinates and a direction.");
      }
      const kind = `scroll_${direction}` as const;
      return this.platform.computerPointerAction(kind, x, y);
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
    if (call.name === "wait") {
      const seconds = call.args.seconds === undefined ? 1 : call.args.seconds;
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 2) {
        throw new Error("Computer Use wait must be between 0 and 2 seconds.");
      }
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      return `Waited ${seconds} seconds.`;
    }
    throw new Error("That action is not available.");
  }

  restore(): Promise<void> {
    return this.platform.computerRestore();
  }

  /** Set by App when the signed-in user changes. Remote asks need it. */
  private accountUserId: string | null = null;
  get userId(): string | null { return this.accountUserId; }
  set userId(userId: string | null) {
    if (this.accountUserId === userId) return;
    this.accountUserId = userId;
    this.pendingGoalStart = null;
    this.remoteGoal = null;
    if (userId && this.platform.platform === "windows") {
      try {
        const saved = restoreRemoteGoal(localStorage, userId, this.getDeviceId(userId));
        this.remoteGoal = saved ? { ...saved, evidence: null } : null;
      } catch { /* Storage unavailable. */ }
    }
  }

  async poll(userId: string): Promise<void> {
    // Never run the same request in overlapping receiver polls or UI callbacks.
    if (this.polling) return;
    this.polling = true;
    try {
      let pollIssue: string | null = null;
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
      for (const row of pending) {
        // A signed v2 request is already verified by listPending. The service
        // additionally authenticates this Windows PC's native pairing identity
        // and atomically claims the exact request before any native action.
        const decision = planRemoteComputerAction(
          row.action, row.argument, this.platform.platform, remoteEnabled,
        );
        if (decision.action === "deny") {
          await this.api.deny(userId, row.id, decision.message);
          continue;
        }
        if (this.userId !== userId) continue;
        let claimed: "none" | "claimed" | "already";
        let desktopUnlocked = true;
        try {
          // Fail closed rather than replaying commands after a crash or reconnect.
          if (await remoteAutoActionApi.wasClaimed(currentId, row.id)) {
            // An earlier claim may have executed the native action before its signed reply was
            // lost. Never replay the action, and don't silently time out the requesting phone.
            await this.api.deny(userId, row.id,
              "Windows claimed this command but its acknowledgment was lost. The outcome is unknown; check the screen before retrying.");
            if (row.action === "start_computer_goal" &&
                this.pendingGoalStart?.requestId === row.id && this.remoteGoal?.status === "starting") {
              this.pendingGoalStart = null;
              this.remoteGoal.status = "failed";
              this.remoteGoal.result = "Task never started because its signed acknowledgment was lost.";
              this.persistRemoteGoal();
            }
            continue;
          }
          if (row.action !== "stop_computer_goal" && row.action !== "computer_goal_status") {
            desktopUnlocked = await invoke<boolean>("trusted_desktop_unlocked");
          }
          // Claim exactly once before returning a signed refusal. Never execute while locked.
          claimed = await remoteAutoActionApi.claim(currentId, row.id);
        } catch (error) {
          // Never bypass a failed claim. Expose the failure for diagnosis and retry on the next poll.
          pollIssue = error instanceof Error ? `Command authorization: ${error.message}` : "Command authorization unavailable.";
          continue;
        }
        if (claimed === "none") {
          pollIssue = "Windows could not claim the remote command.";
        }
        if (claimed !== "claimed") continue;
        if (!desktopUnlocked) {
          pollIssue = "Windows is locked. Unlock it to run remote computer actions.";
          await this.api.deny(userId, row.id, "Windows is locked. Unlock the desktop to run this command.");
          continue;
        }
        const outcome = await fulfillComputerAction(
          this.api, row, this.platform.platform, remoteEnabled, row.id,
          async (action, argument) => {
            if (this.userId !== userId || !loadRemoteComputerActions() ||
                !await remoteAutoActionApi.validate(currentId, row.id) ||
                (action !== "computer_goal_status" && action !== "stop_computer_goal" &&
                  !await invoke<boolean>("trusted_desktop_unlocked"))) {
              throw new Error("Automatic remote control disabled, locked or pairing revoked.");
            }
            return this.run(action, argument, row.requesterDeviceId, row.id);
          },
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
      }
      this.approvedId = null;
      this.setApproval(null);
      this.reportPollFailure(pollIssue);
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
    this.persistRemoteGoal();
    const validate = async () => {
      if (this.userId !== pending.ownerId || !loadRemoteComputerActions() ||
        !await invoke<boolean>("trusted_desktop_unlocked")) throw new Error("Computer Use stopped: PC locked, signed out, or remote actions disabled.");
      await pairedPublicKey(this.getDeviceId(pending.ownerId), pending.requesterDeviceId);
    };
    void this.remoteGoalRunner(pending.goal,
      (step, name) => { state.steps = step; state.lastAction = name; this.persistRemoteGoal(); }, validate,
    ).then(report => {
      state.status = state.status === "stopping" ? "stopped"
        : report.status === "verified" ? "completed"
        : report.status === "unverified" ? "needs_review"
        : report.status === "blocked" ? "blocked" : "stopped";
      state.steps = report.steps;
      state.result = report.summary.slice(0, 1000);
      state.evidence = report.evidence;
      this.persistRemoteGoal();
    }).catch(error => {
      state.status = state.status === "stopping" ? "stopped" : "failed";
      state.result = error instanceof Error ? error.message.slice(0, 1000) : "The Computer Use task failed.";
      this.persistRemoteGoal();
    });
  }

  private async run(action: RemoteComputerAction, argument: string, requesterDeviceId: string, requestId: string): Promise<string> {
    if (action === "computer_goal_status" || action === "stop_computer_goal") {
      const goal = this.remoteGoal;
      if (!goal) return "No Computer Use session has been started on this PC.";
      if (goal.requesterDeviceId !== requesterDeviceId) throw new Error("This session belongs to a different paired device.");
      if (action === "stop_computer_goal") this.stopRemoteGoal();
      return `Computer Use job ${goal.jobId}: ${goal.status}; ${goal.steps} steps; ${goal.lastAction || "no actions yet"}; ${goal.result}${goal.evidence ? `; Verified visual evidence: ${goal.evidence}` : "; No verified completion evidence"}`.slice(0,1500);
    }
    if (action === "start_computer_goal") {
      if (!this.remoteGoalRunner) throw new Error("Computer Use is not ready on this PC.");
      if (this.remoteGoal?.status === "running" || this.remoteGoal?.status === "stopping" ||
          this.remoteGoal?.status === "starting") throw new Error("A Computer Use session is already active.");
      if (!await invoke<boolean>("trusted_desktop_unlocked")) throw new Error("Unlock Windows before starting Computer Use.");
      const owner = this.userId;
      if (!owner) throw new Error("Sign in before using remote Computer Use.");
      await pairedPublicKey(this.getDeviceId(owner), requesterDeviceId);
      this.remoteGoal = { jobId: requestId, requesterDeviceId, status: "starting", steps: 0, lastAction: "", result: "", evidence: null };
      this.persistRemoteGoal();
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
    this.snapshot = { ...this.snapshot, approval };
    for (const listener of this.listeners) listener();
  }
}
