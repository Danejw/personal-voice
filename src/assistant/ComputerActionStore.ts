import { dragEndpoints, executableShortcut, parseRemotePointer, planRemoteComputerAction, type ComputerCall, type RemoteComputerAction } from "@/assistant/computerActions";
import { askComputerAction, fulfillComputerAction, type ComputerActionApi } from "@/assistant/computerRemote";
import { ComputerTaskFailure, type ComputerImage, type ComputerTaskReport, type ComputerTaskTraceEvent } from "@/assistant/computerTask";
import { recordComputerEvent, flightFailureCode, type FlightStage, type FlightFailure } from "@/services/computerFlightRecorder";
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
import { computerJobsApi, type ComputerJob, type ComputerJobPhase, type JobCheckpoint } from "@/services/computerJobsService";

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
  private tracedReceiver = new Set<string>();

  private trace(traceId: string, stage: FlightStage, action?: string, step?: number, code?: FlightFailure): void {
    const userId = this.userId;
    if (!userId) return;
    try {
      recordComputerEvent({
        userId, deviceId: this.getDeviceId(userId), traceId,
        actor: this.platform.platform === "windows" ? "windows" : "android",
        stage, action, step, code,
      });
    } catch { /* Diagnostics never interrupt desktop execution. */ }
  }

  private traceReceiverOnce(row: { id: string; action: string }, stage: FlightStage, code?: FlightFailure): void {
    const marker = `${row.id}:${stage}:${code ?? ""}`;
    if (this.tracedReceiver.has(marker)) return;
    if (this.tracedReceiver.size > 1200) this.tracedReceiver.clear();
    this.tracedReceiver.add(marker);
    // Status/stop observations belong to their autonomous goal.
    // Direct commands use their own signed request ID on both devices.
    const traceId = row.action === "computer_goal_status" || row.action === "stop_computer_goal"
      ? this.remoteGoal?.jobId ?? row.id : row.id;
    this.trace(traceId, stage, row.action, undefined, code);
  }

  recordLocalComputerTrace(traceId: string, event: ComputerTaskTraceEvent): void {
    this.trace(traceId, event.stage, event.action, event.step, event.code);
  }
  private remoteGoal: RemoteGoalState | null = null;
  private pendingGoalStart: { requestId: string; goal: string; requesterDeviceId: string; ownerId: string } | null = null;
  private remoteGoalRunner: ((
    goal: string, progress: (step: number, action: string) => Promise<void>,
    validate: () => Promise<void>, trace: (event: ComputerTaskTraceEvent) => void,
    beforeAction: (step: number, action: string) => Promise<void>,
    beforeVerify: (step: number) => Promise<void>,
  ) => Promise<ComputerTaskReport>) | null = null;
  private reconciledFor: string | null = null;
  private workerHeartbeat: ReturnType<typeof setInterval> | null = null;
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
    runner: (
      goal: string, progress: (step: number, action: string) => Promise<void>,
      validate: () => Promise<void>, trace: (event: ComputerTaskTraceEvent) => void,
      beforeAction: (step: number, action: string) => Promise<void>,
      beforeVerify: (step: number) => Promise<void>,
    ) => Promise<ComputerTaskReport>,
    stop: () => void,
  ): void {
    this.remoteGoalRunner = runner;
    this.remoteGoalStop = stop;
  }

  stopRemoteGoal(): void {
    if (this.remoteGoal?.status === "starting") {
      this.remoteGoal.status = "stopped";
      this.pendingGoalStart = null;
      const owner = this.userId;
      if (owner && this.platform.platform === "windows") {
        void computerJobsApi.cancelPending(this.getDeviceId(owner), this.remoteGoal.jobId)
          .catch(() => undefined); // Reconcile on restart if this best-effort write is unavailable.
      }
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
    const goalId = this.snapshot.remoteGoal?.targetDeviceId === target.id
      ? this.snapshot.remoteGoal.requestId : null;
    let requestId: string | null = null;
    try {
      const result = await askComputerAction(
        this.api, userId, currentId, devices, target.id, action, argument,
        { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
        receipt => {
          requestId = action === "start_computer_goal" ? receipt.requestId : goalId ?? receipt.requestId;
          const traceId = action === "computer_goal_status" || action === "stop_computer_goal"
            ? goalId ?? receipt.requestId : receipt.requestId;
          if (traceId) {
            if (receipt.stage === "queued") this.trace(traceId, "queued", action);
            if (receipt.stage === "answered") this.trace(traceId, "acknowledged", action);
            if (receipt.stage === "denied") this.trace(traceId, "blocked", action, undefined, "refused");
            if (receipt.stage === "timed_out") this.trace(traceId, "timeout", action, undefined, "timeout");
          }
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
    this.tracedReceiver.clear();
    this.pendingGoalStart = null;
    this.remoteGoal = null;
    this.reconciledFor = null;
    if (this.workerHeartbeat) clearInterval(this.workerHeartbeat);
    this.workerHeartbeat = null;
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
      // One native-key-authenticated startup reconciliation. A crashed Windows
      // job is never replayed from the short-lived signed request queue.
      if (this.platform.platform === "windows" && this.remoteGoalRunner &&
          this.userId === userId && this.reconciledFor !== userId) {
        await this.reconcileDurableJob(userId);
      }
      const remoteEnabled = loadRemoteComputerActions();
      for (const row of pending) {
        this.traceReceiverOnce(row, "received");
        // A signed v2 request is already verified by listPending. The service
        // additionally authenticates this Windows PC's native pairing identity
        // and atomically claims the exact request before any native action.
        const decision = planRemoteComputerAction(
          row.action, row.argument, this.platform.platform, remoteEnabled,
        );
        if (decision.action === "deny") {
          this.traceReceiverOnce(row, "blocked", "refused");
          await this.api.deny(userId, row.id, decision.message);
          continue;
        }
        if (this.userId !== userId) continue;
        let claimed: "none" | "claimed" | "already";
        try {
          // Fail closed rather than replaying commands after a crash or reconnect.
          if (await remoteAutoActionApi.wasClaimed(currentId, row.id)) {
            this.traceReceiverOnce(row, "blocked", "unknown");
            continue;
          }
          if (!await invoke<boolean>("trusted_desktop_unlocked") &&
            row.action !== "stop_computer_goal" && row.action !== "computer_goal_status") {
            // Do not execute on a locked desktop. Explain why the request is pending.
            pollIssue = "Windows is locked. Unlock it to run remote computer actions.";
            this.traceReceiverOnce(row, "blocked", "locked");
            continue;
          }
          claimed = await remoteAutoActionApi.claim(currentId, row.id);
        } catch (error) {
          // Never bypass a failed claim. Expose the failure for diagnosis and retry on the next poll.
          pollIssue = error instanceof Error ? `Command authorization: ${error.message}` : "Command authorization unavailable.";
          this.traceReceiverOnce(row, "blocked", flightFailureCode(error, "auth"));
          continue;
        }
        if (claimed === "none") {
          pollIssue = "Windows could not claim the remote command.";
        }
        if (claimed !== "claimed") continue;
        this.traceReceiverOnce(row, "authorized");
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
        if (outcome.action === "answered") {
          if (!["start_computer_goal", "computer_goal_status", "stop_computer_goal"].includes(row.action)) {
            this.traceReceiverOnce(row, "acted");
          }
          this.traceReceiverOnce(row, "acknowledged");
        }
        if (outcome.action === "denied") {
          const code = outcome.failureKind === "policy" ? "refused"
            : flightFailureCode(new Error(outcome.reason ?? ""), "tool");
          this.traceReceiverOnce(row, "blocked", code);
        }
        // Start the background task only AFTER the signed start acknowledgment is committed.
        // A timed-out or rejected request must never leave an unauthorized running task.
        if (row.action === "start_computer_goal" && outcome.action === "answered") {
          void this.launchRemoteGoal(row.id);
        } else if (row.action === "start_computer_goal" && outcome.action === "denied" &&
          this.pendingGoalStart?.requestId === row.id) {
          this.pendingGoalStart = null;
          if (this.remoteGoal?.status === "starting") this.remoteGoal = null;
          void computerJobsApi.cancelPending(currentId, row.id).catch(() => undefined);
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

  /** Reconcile once after a fresh Windows process/account session starts.
   * An in-flight native action is never replayed. With zero actions and a safe
   * observation checkpoint, the existing executor may restart with a new screenshot.
   */
  private async reconcileDurableJob(userId: string): Promise<void> {
    if (this.reconciledFor === userId || !this.remoteGoalRunner) return;
    if (this.remoteGoal?.status === "starting" || this.remoteGoal?.status === "running" ||
        this.remoteGoal?.status === "stopping") { this.reconciledFor = userId; return; }
    const pcId = this.getDeviceId(userId);
    const unlocked = await invoke<boolean>("trusted_desktop_unlocked").catch(() => false);
    const recovery = await computerJobsApi.reconcile(pcId, unlocked && loadRemoteComputerActions());
    if (this.userId !== userId) return;
    this.reconciledFor = userId;
    if (!recovery) return;
    const job = recovery.job;
    this.remoteGoal = {
      jobId: job.id, requesterDeviceId: job.requester_device_id,
      status: job.status === "running" ? "running" : job.status === "pending_ack" ? "interrupted" : job.status,
      steps: job.steps, lastAction: job.last_action, result: job.result, evidence: job.evidence,
    };
    this.persistRemoteGoal();
    if (recovery.resumed && unlocked && loadRemoteComputerActions() &&
        job.status === "running" && job.phase === "observing" && job.steps === 0) {
      this.startRemoteWorker(job, userId);
    }
  }

  private async launchRemoteGoal(requestId: string): Promise<void> {
    const pending = this.pendingGoalStart;
    if (!pending || pending.requestId !== requestId || this.remoteGoal?.status !== "starting" ||
        !this.remoteGoalRunner) return;
    this.pendingGoalStart = null;
    try {
      const job = await computerJobsApi.activate(this.getDeviceId(pending.ownerId), requestId);
      if (this.userId !== pending.ownerId || this.remoteGoal?.status !== "starting") {
        if (job.worker_token) {
          await computerJobsApi.checkpoint(this.getDeviceId(pending.ownerId), job.id, job.worker_token, {
            status: "stopped", phase: "done", steps: job.steps, lastAction: job.last_action,
            result: "The task was stopped before its first desktop action.",
          }).catch(() => undefined);
        }
        return;
      }
      this.startRemoteWorker(job, pending.ownerId);
    } catch (error) {
      if (this.remoteGoal?.jobId !== requestId) return;
      this.remoteGoal.status = "failed";
      this.remoteGoal.result = error instanceof Error ? error.message.slice(0, 1000) :
        "Could not activate the durable task.";
      this.trace(requestId, "failed", "start_computer_goal", 0, "unavailable");
      this.persistRemoteGoal();
      // No native action can run without a durable, signed job lease.
    }
  }

  /** Lives in the Windows application, never in a phone voice session.
   * Each native action receives an in-flight marker before execution and a
   * durable checkpoint afterward. The pre-action marker fences unsafe replay.
   */
  private startRemoteWorker(job: ComputerJob, ownerId: string): void {
    const runner = this.remoteGoalRunner;
    const token = job.worker_token;
    if (!runner || !token || this.userId !== ownerId) return;
    const requestId = job.id;
    const pcId = this.getDeviceId(ownerId);
    const state: RemoteGoalState = {
      jobId: job.id, requesterDeviceId: job.requester_device_id,
      status: "running", steps: job.steps,
      lastAction: job.last_action, result: job.result, evidence: job.evidence,
    };
    this.remoteGoal = state;
    this.persistRemoteGoal();
    this.trace(requestId, "started", "start_computer_goal", job.steps);
    let phase: ComputerJobPhase = "observing";
    const checkpoint = async (point: JobCheckpoint): Promise<void> => {
      if (this.userId !== ownerId || this.remoteGoal !== state) {
        throw new Error("Computer Use authorization changed.");
      }
      await computerJobsApi.checkpoint(pcId, requestId, token, point);
      phase = point.phase;
      state.steps = point.steps;
      state.lastAction = point.lastAction;
      state.result = point.result ?? state.result;
      state.evidence = point.evidence ?? state.evidence;
      this.persistRemoteGoal();
    };
    const validate = async (): Promise<void> => {
      if (this.userId !== ownerId || !loadRemoteComputerActions() ||
          !await invoke<boolean>("trusted_desktop_unlocked")) {
        throw new Error("Computer Use stopped: PC locked, signed out, or remote actions disabled.");
      }
      await pairedPublicKey(pcId, job.requester_device_id);
      await computerJobsApi.heartbeat(pcId, requestId, token);
    };
    // Keep the server lease fresh during a slow model request; a lost lease
    // stops the worker before the next desktop side effect.
    if (this.workerHeartbeat) clearInterval(this.workerHeartbeat);
    const heartbeat = setInterval(() => {
      void computerJobsApi.heartbeat(pcId, requestId, token).catch(() => {
        if (this.remoteGoal === state) this.remoteGoalStop?.();
      });
    }, 20_000);
    this.workerHeartbeat = heartbeat;
    void runner(
      job.goal,
      async (step, action) => checkpoint({
        status: "running", phase: "observing", steps: step, lastAction: action,
      }),
      validate,
      event => this.trace(requestId, event.stage, event.action, event.step, event.code),
      async (step, action) => checkpoint({
        status: "running", phase: "applying", steps: step, lastAction: action,
      }),
      async (step) => checkpoint({
        status: "running", phase: "verifying", steps: step, lastAction: state.lastAction,
      }),
    ).then(async report => {
      const status = state.status === "stopping" ? "stopped"
        : report.status === "verified" && report.evidence ? "completed"
          : report.status === "unverified" ? "needs_review"
            : report.status === "blocked" ? "blocked" : "stopped";
      await checkpoint({
        status, phase: "done", steps: report.steps, lastAction: state.lastAction,
        result: report.summary.slice(0, 1000), evidence: report.evidence,
      });
      state.status = status;
      this.persistRemoteGoal();
    }).catch(async error => {
      // If the most recent action was in-flight, execution may have happened.
      // Never claim it did not happen and never try it a second time.
      const status = phase === "applying" ? "needs_review" : "failed";
      const message = phase === "applying"
        ? "Desktop action outcome is unknown. Inspect Windows before resuming."
        : error instanceof Error ? error.message.slice(0, 1000) : "The Computer Use task failed.";
      try {
        await checkpoint({ status, phase: "done", steps: state.steps,
          lastAction: state.lastAction, result: message });
        state.status = status;
      } catch {
        state.status = "interrupted";
        state.result = "Windows could not save the final checkpoint. Inspect task state before retrying.";
      }
      if (!(error instanceof ComputerTaskFailure)) {
        this.trace(requestId, "failed", undefined, state.steps, flightFailureCode(error));
      }
      this.persistRemoteGoal();
    }).finally(() => {
      clearInterval(heartbeat);
      if (this.workerHeartbeat === heartbeat) this.workerHeartbeat = null;
    });
  }

  private async run(action: RemoteComputerAction, argument: string, requesterDeviceId: string, requestId: string): Promise<string> {
    if (action === "computer_goal_status" || action === "stop_computer_goal") {
      const owner = this.userId;
      if (!owner) throw new Error("Sign in to check Computer Use.");
      const job = await computerJobsApi.latest(owner, this.getDeviceId(owner));
      if (!job) return "No Computer Use session has been started on this PC.";
      if (job.requester_device_id !== requesterDeviceId) {
        throw new Error("This session belongs to a different paired device.");
      }
      if (action === "stop_computer_goal" && this.remoteGoal?.jobId === job.id) this.stopRemoteGoal();
      return `Computer Use job ${job.id}: ${this.remoteGoal?.jobId === job.id && this.remoteGoal.status === "stopping" ? "stopping" : job.status}; ${job.steps} steps; ${job.last_action || "no actions yet"}; ${job.result}${job.evidence ? `; Verified visual evidence: ${job.evidence}` : "; No verified completion evidence"}`.slice(0, 1500);
    }
    if (action === "start_computer_goal") {
      if (!this.remoteGoalRunner) throw new Error("Computer Use is not ready on this PC.");
      if (this.remoteGoal?.status === "running" || this.remoteGoal?.status === "stopping" ||
          this.remoteGoal?.status === "starting") throw new Error("A Computer Use session is already active.");
      if (!await invoke<boolean>("trusted_desktop_unlocked")) throw new Error("Unlock Windows before starting Computer Use.");
      const owner = this.userId;
      if (!owner) throw new Error("Sign in before using remote Computer Use.");
      await pairedPublicKey(this.getDeviceId(owner), requesterDeviceId);
      // Persist the exact signed goal while its request is still pending.
      // If this write fails the command is denied, not executed in memory.
      const durable = await computerJobsApi.create(this.getDeviceId(owner), requestId);
      if (durable.goal !== argument || durable.requester_device_id !== requesterDeviceId ||
          durable.id !== requestId) throw new Error("Durable goal did not match the signed request.");
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
