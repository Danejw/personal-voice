import { invoke } from "@tauri-apps/api/core";
import {
  screenOmittedText,
  type AssistantContinuation,
} from "@/assistant/continuation";
import type { ContextItem } from "@/context/ContextItem";
import {
  acceptHandoff,
  acceptNote,
  accountContextText,
  copyHandoff,
  copyNote,
  handoffContextText,
  handoffDetachedText,
  noteContextText,
  noteDetachedText,
  type AttachedHandoff,
  type AttachedNote,
} from "@/assistant/accountContext";
import { personalContextNote } from "@/assistant/personalContext";
import { memoryInjection, type AssistantMemory, type MemoryCommand } from "@/assistant/memory";
import type { AssistantEvent } from "@/assistant/events";
import { ECHO_TAIL_MS, duplexEchoGate, gatedEchoGate, microphoneHeld, noteRemaining, shouldForwardMicrophone, type EchoGate } from "@/assistant/echoGate";
import type { AssistantPlayback } from "@/assistant/playback";
import { assistantToolResponse } from "@/assistant/protocol";
import { createId as newId } from "@/sync/createId";
import {
  acceptSelection,
  selectionContextText,
  selectionDetachedText,
} from "@/assistant/selectionContext";
import {
  assistantReducer,
  initialAssistantState,
  type AssistantSnapshot,
  type AssistantTurn,
  type PendingAssistantAction,
} from "@/assistant/state";
import {
  cameraContextStartedText,
  cameraContextStoppedText,
  cameraPhotoContextText,
  cameraPhotoDetachedText,
  cameraPhotoFromFrame,
  type CameraPhoto,
} from "@/assistant/cameraPhoto";
import {
  snapshotContextText,
  snapshotDetachedText,
  type ScreenSnapshot,
} from "@/assistant/snapshot";
import { decideToolCall, type ConfirmToolName, type ParsedToolCall, type ToolDecision } from "@/assistant/tools";
import type { ComputerCall, RemoteComputerAction } from "@/assistant/computerActions";
import { runComputerTask, type ComputerImage } from "@/assistant/computerTask";
import type { RemoteKind } from "@/assistant/remoteContext";
import type { CameraCapture } from "@/platform/camera/CameraCapture";
import {
  cameraFacingLabel,
  LatestFrameGate,
  UnavailableCameraCapture,
  type CameraFacing,
} from "@/platform/camera";
import { captureEchoFrom, type AudioCapture, type CaptureEchoStatus } from "@/voice/audio/AudioCapture";
import { MicrophoneLease } from "@/voice/audio/microphoneLease";

/** The slice of a Live session the controller drives. */
export interface AssistantSessionHandle {
  connect(): Promise<void>;
  sendTurn(text: string, selectionText?: string | null, accountText?: string | null, personalText?: string | null): void;
  sendHistory(turns: { role: "user" | "model"; text: string }[]): void;
  sendNote(text: string): void;
  sendVideo(jpegBase64: string): void;
  sendToolResponse(message: unknown): void;
  sendAudio(pcm: ArrayBuffer): void;
  close(): void;
}

/** Personal Voice services the tool router may call. Gemini code does not reimplement them. */
export interface AssistantActions {
  copyText(text: string): Promise<void>;
  insertText(text: string): Promise<void>;
  createVoiceNote(text: string): Promise<void>;
  editVoiceNote(id: string, text: string): Promise<void>;
  listSnippets(): Promise<string>;
  createSnippet(trigger: string, content: string): Promise<void>;
  updateSnippet(id: string, trigger: string, content: string): Promise<void>;
  sendRemoteDictation(text: string, device: string): Promise<void>;
  createTransform(name: string, instruction: string): Promise<void>;
  addDictionaryWord(word: string): Promise<void>;
  readDashboard(kind: "read_usage_analytics" | "read_insights"): Promise<string>;
  /** Resolves the handoff target without sending. Throws when none is available. */
  planHandoff(deviceName: string | null): { deviceId: string; label: string };
  sendHandoff(text: string, deviceId: string): Promise<void>;
  /** Read-only look at another owned device. Screenshot pixels are a one-time still. */
  readRemote(kind: RemoteKind, deviceName: string | null): Promise<{ text: string; screenshot: ScreenSnapshot | null }>;
  /** One still of this device's screen. Does not click or type. */
  captureScreen(): Promise<ScreenSnapshot>;
  /** Highlighted text in the other app. */
  captureSelection(): Promise<ContextItem>;
  /** Inbox notes, or every note when archived ones are included. */
  listVoiceNotes(includeArchived: boolean): Promise<string>;
  /** Received handoffs and the names of other devices. */
  listHandoffs(): Promise<string>;
  /** Short text for a confirm card. Throws when the id is not in the current list. */
  describeItem(kind: "note" | "handoff", id: string): string;
  archiveVoiceNote(id: string, archived: boolean): Promise<void>;
  deleteVoiceNote(id: string): Promise<void>;
  dismissHandoff(id: string): Promise<void>;
  /** Active and forgotten memories for this account. */
  listMemories(): Promise<string>;
  rememberMemory(input: { key: string; kind: "preference" | "fact"; value: string }): Promise<string>;
  changeMemory(input: { key: string; value: string }): Promise<string>;
  forgetMemory(key: string): Promise<string>;
  /** Allowlisted desktop actions and the Computer Use step executor. No shell. */
  computer: ComputerHost;
}

export interface ComputerHost {
  openApp(id: string): Promise<string>;
  pressShortcut(id: string): Promise<string>;
  remoteAction(action: RemoteComputerAction, argument: string, deviceName: string): Promise<string>;
  capture(): Promise<ComputerImage>;
  propose(body: Record<string, unknown>): Promise<unknown>;
  execute(call: ComputerCall, image: ComputerImage): Promise<string>;
  restore(): Promise<void>;
}

const RESPONSE_TIMEOUT_MS = 45_000;
const DICTATION_HAS_MICROPHONE = "Dictation is using the microphone.";
const RESUME_LOST = "Assistant disconnected and the conversation could not be resumed.";
const RESUME_FAILED = "Assistant couldn't resume the conversation.";
const ACTION_CANCELLED = "The user cancelled. Nothing was changed.";
const ACTION_BUSY = "Another action is already waiting for confirmation.";

const unavailable = async (): Promise<void> => {
  throw new Error("Assistant actions are not available.");
};

/**
 * Assistant lifecycle, microphone streaming, in-memory conversation, and playback.
 * A replaced or ended session cannot apply later socket events.
 * Microphone audio is forwarded and then dropped. It is never written to disk.
 */
export class AssistantController {
  private snapshot: AssistantSnapshot = initialAssistantState;
  private listeners = new Set<(snapshot: AssistantSnapshot) => void>();
  private session?: AssistantSessionHandle;
  private capture?: AudioCapture;
  private pendingAudio: ArrayBuffer[] = [];
  private streaming = false;
  private generation = 0;
  private connection = 0;
  private resumeHandle: string | null = null;
  private droppingModel = false;
  private resuming = false;
  private selectionItem: ContextItem | null = null;
  /** True after this socket has been told about the current attachment. */
  private selectionNoted = false;
  private personalText: string | null = null;
  private personalNoted = false;
  private personalWasSent = false;
  private memoryText: string | null = null;
  private memoryFingerprint = "none";
  private memoryNoted = false;
  private memorySent = false;
  private injectedFingerprint: string | null = null;
  private memoryRestartPending = false;
  private toolDepth = 0;
  private screenShot: ScreenSnapshot | null = null;
  /** True after this socket has been sent the current screenshot. */
  private screenNoted = false;
  private cameraPhoto: CameraPhoto | null = null;
  /** True after this socket has been sent the current camera still. */
  private cameraPhotoNoted = false;
  /**
   * Explicit Camera Context intent. A Gemini reconnect does not reopen the hardware
   * unless this remains set; old frames are never replayed.
   */
  private cameraDesired: { facing: CameraFacing } | null = null;
  private cameraGate = new LatestFrameGate();
  private camera: CameraCapture = new UnavailableCameraCapture();
  /** Serializes stop before a post-reconnect restart so hardware is not left racing. */
  private cameraStop: Promise<void> = Promise.resolve();
  private notes: AttachedNote[] = [];
  private handoffItem: AttachedHandoff | null = null;
  private notedNoteIds = new Set<string>();
  private handoffNoted = false;
  private historyTurns: { role: "user" | "model"; text: string }[] = [];
  private historySeeded = false;
  /** True when this socket was opened with a resumption handle. That socket already has the history. */
  private openedWithHandle = false;
  private onToolRecord: ((record: { name: string; outcome: string }) => void) | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private pending: ConfirmedTool | null = null;
  /** Bumped when a pending action is dropped so an in-flight confirm cannot report success. */
  private toolEpoch = 0;
  private toolQueue = Promise.resolve();
  /** Turn ids already handed to storage, so a reload does not append them again. */
  private published = new Set<string>();
  private onCommitted: ((turn: AssistantTurn) => void) | null = null;
  private onRevised: ((turn: AssistantTurn) => void) | null = null;
  private mayProduce: () => boolean = () => true;
  private computerStopped = false;
  private computerConfirm: ((allowed: boolean) => void) | null = null;
  /** Off shows a confirm card. On runs the action when the tool is called. */
  private autoRun = true;
  /** Duplex until capture reports otherwise, so desktop barge-in stays open. */
  private echo: EchoGate = duplexEchoGate();
  private echoKnown = false;
  private echoTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private openSession: (
      onEvent: (event: AssistantEvent) => void,
      resumeHandle: string | null,
    ) => AssistantSessionHandle,
    private playback: AssistantPlayback,
    private nextId: () => string = newId,
    private createCapture?: () => AudioCapture,
    private lease: MicrophoneLease = new MicrophoneLease(),
    private actions: AssistantActions = {
      copyText: unavailable,
      insertText: unavailable,
      createVoiceNote: unavailable,
      editVoiceNote: unavailable,
      listSnippets: async () => { throw new Error("Snippets unavailable."); },
      createSnippet: unavailable,
      updateSnippet: unavailable,
      sendRemoteDictation: unavailable,
      createTransform: unavailable,
      addDictionaryWord: unavailable,
      readDashboard: async () => { throw new Error("Assistant dashboards are not available."); },
      planHandoff: () => { throw new Error("Choose a device in Handoffs first."); },
      sendHandoff: unavailable,
      readRemote: async () => { throw new Error("Assistant actions are not available."); },
      captureScreen: async () => { throw new Error("Assistant actions are not available."); },
      captureSelection: async () => { throw new Error("Assistant actions are not available."); },
      listVoiceNotes: async () => { throw new Error("Assistant actions are not available."); },
      listHandoffs: async () => { throw new Error("Assistant actions are not available."); },
      describeItem: () => { throw new Error("Assistant actions are not available."); },
      archiveVoiceNote: unavailable,
      deleteVoiceNote: unavailable,
      dismissHandoff: unavailable,
      listMemories: async () => { throw new Error("Assistant actions are not available."); },
      rememberMemory: async () => { throw new Error("Assistant actions are not available."); },
      changeMemory: async () => { throw new Error("Assistant actions are not available."); },
      forgetMemory: async () => { throw new Error("Assistant actions are not available."); },
      computer: {
        openApp: async () => { throw new Error("Assistant actions are not available."); },
        pressShortcut: async () => { throw new Error("Assistant actions are not available."); },
        remoteAction: async () => { throw new Error("Assistant actions are not available."); },
        capture: async () => { throw new Error("Assistant actions are not available."); },
        propose: async () => { throw new Error("Assistant actions are not available."); },
        execute: async () => { throw new Error("Assistant actions are not available."); },
        restore: async () => {},
      },
    },
  ) {}

  /** Wires clipboard, insert, notes, and handoff. Safe to call once at startup. */
  setActions(actions: AssistantActions): void {
    this.actions = actions;
  }

  /** Platform camera boundary. Safe to call once at startup. */
  setCamera(camera: CameraCapture): void {
    void this.stopCameraHardware();
    this.camera = camera;
  }

  /** Auto runs confirming actions. Review waits for Confirm or Cancel. */
  setAutoRun(enabled: boolean): void {
    this.autoRun = enabled;
  }

  getSnapshot(): AssistantSnapshot {
    return this.snapshot;
  }

  /** When this returns false, new tool work does not start. Already-running work is not repeated. */
  setProducer(mayProduce: () => boolean): void {
    this.mayProduce = mayProduce;
  }

  /** Receives each committed turn once. Streaming text is not included. */
  setCommittedTurnHandler(handler: ((turn: AssistantTurn) => void) | null): void {
    this.onCommitted = handler;
  }

  /** Receives a citation update for a turn that is still waiting to be written. */
  setTurnRevisionHandler(handler: ((turn: AssistantTurn) => void) | null): void {
    this.onRevised = handler;
  }

  /** Replaces the history a fresh session will receive once. Ignored while a session is open. */
  setSavedHistory(turns: readonly { role: "user" | "model"; text: string }[]): void {
    const status = this.snapshot.status;
    if (status === "CONNECTING" || status === "READY" || status === "RESPONDING") return;
    this.historyTurns = turns.map((turn) => ({ role: turn.role, text: turn.text }));
    this.historySeeded = false;
  }

  /** Records a finished tool result so a later session can describe it without running it again. */
  setToolRecordHandler(handler: ((record: { name: string; outcome: string }) => void) | null): void {
    this.onToolRecord = handler;
  }

  /**
   * Shows a saved transcript and does not write those turns again.
   * Ignored while a live session is open; end that session first.
   */
  showSaved(turns: AssistantTurn[]): void {
    const status = this.snapshot.status;
    if (status === "CONNECTING" || status === "READY" || status === "RESPONDING") return;
    for (const turn of turns) this.published.add(turn.id);
    this.dispatch({ type: "replaceTurns", turns });
  }

  subscribe(listener: (snapshot: AssistantSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Opens one Live session and starts the microphone. Ignored while one is already running. */
  start(): void {
    if (this.snapshot.status === "CONNECTING" || this.snapshot.status === "READY" || this.snapshot.status === "RESPONDING") return;
    if (!this.lease.claim("assistant")) {
      this.dispatch({ type: "blocked", message: DICTATION_HAS_MICROPHONE });
      return;
    }
    this.generation += 1;
    const generation = this.generation;
    this.resumeHandle = null;
    this.historySeeded = false;
    this.openedWithHandle = false;
    this.memoryNoted = false;
    this.memorySent = false;
    this.injectedFingerprint = null;
    this.memoryRestartPending = false;
    this.droppingModel = false;
    this.resuming = false;
    this.session?.close();
    this.resetEcho();
    this.playback.clear();
    this.pendingAudio = [];
    this.streaming = false;
    this.dispatch({ type: "start" });
    this.playback.prime();
    this.beginCapture(generation);
    if (this.snapshot.status === "ERROR") return;
    this.openConnection(generation);
  }

  /**
   * Dev hook for a forced reconnect. Uses the newest in-memory handle.
   * Does nothing with credentials, and fails clearly when the session cannot be resumed.
   */
  reconnect(): void {
    if (this.snapshot.status === "IDLE" || this.snapshot.status === "ERROR") return;
    this.resumeOrFail();
  }

  /**
   * Stops playback and resumes listening. Used when echo cancellation is unavailable,
   * because speaking over the reply is not forwarded and cannot barge in.
   */
  interruptPlayback(): void {
    if (this.snapshot.status !== "READY" && this.snapshot.status !== "RESPONDING") return;
    const modelTurn = this.snapshot.status === "RESPONDING";
    if (!modelTurn && !this.snapshot.playbackHeld) return;
    if (modelTurn) {
      this.droppingModel = true;
      clearTimeout(this.timer);
    }
    this.playback.clear();
    this.syncEcho(Date.now());
    if (modelTurn) this.dispatch({ type: "interrupt", id: this.nextId() });
  }

  /** Sends one typed turn on the current session. No-op unless the session is listening. */
  send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.snapshot.status !== "READY" || !this.session) return;
    this.dispatch({ type: "send", id: this.nextId(), text: trimmed });
    try {
      // The current socket already has the still image. A later question does not send it again.
      this.noteSnapshot();
      if (this.screenShot && !this.screenNoted) throw new Error("snapshot");
      this.session.sendTurn(
        trimmed,
        this.selectionItem ? selectionContextText(this.selectionItem) : null,
        accountContextText(this.notes, this.handoffItem),
        this.personalText,
      );
    } catch {
      this.failActive("Couldn't send that message. Try again.");
      return;
    }
    this.armTimer();
  }

  /**
   * Remembers one explicit selection until Remove or End.
   * Does not capture the screen or change the other app. Returns an error when the text is too long.
   */
  attachSelection(item: ContextItem): string | null {
    const decision = acceptSelection(item);
    if (!decision.ok) {
      this.dispatch({ type: "selectionError", message: decision.message });
      return decision.message;
    }
    this.selectionItem = item;
    this.selectionNoted = false;
    this.dispatch({ type: "attachSelection", item });
    this.noteSelection();
    return null;
  }

  /** Drops the attachment and, when a session is open, tells Gemini it is no longer active. */
  detachSelection(): void {
    const had = this.selectionItem;
    this.selectionItem = null;
    this.selectionNoted = false;
    this.dispatch({ type: "detachSelection" });
    if (!had) return;
    this.sendNote(selectionDetachedText());
  }

  /** Remembers one explicit screenshot until Remove or End. Does not start a capture loop. */
  attachSnapshot(screen: ScreenSnapshot): void {
    this.screenShot = screen;
    this.screenNoted = false;
    this.dispatch({ type: "attachScreen", screen });
    this.noteSnapshot();
  }

  /** Drops the screenshot and, when a session is open, tells Gemini it is no longer active. */
  detachSnapshot(): void {
    const had = this.screenShot;
    this.screenShot = null;
    this.screenNoted = false;
    this.dispatch({ type: "detachScreen" });
    if (!had) return;
    this.sendNote(snapshotDetachedText());
  }

  /** Shows a capture failure without pretending a screenshot is attached. */
  reportSnapshotError(message: string): void {
    this.dispatch({ type: "screenError", message });
  }

  /** Remembers one explicit camera still until Remove or End. Does not start a capture loop. */
  attachCameraPhoto(photo: CameraPhoto): void {
    this.cameraPhoto = photo;
    this.cameraPhotoNoted = false;
    this.dispatch({ type: "attachCameraPhoto", photo });
    this.noteCameraPhoto();
  }

  /** Drops the camera still and, when a session is open, tells Gemini it is no longer active. */
  detachCameraPhoto(): void {
    const had = this.cameraPhoto;
    this.cameraPhoto = null;
    this.cameraPhotoNoted = false;
    this.dispatch({ type: "detachCameraPhoto" });
    if (!had) return;
    this.sendNote(cameraPhotoDetachedText());
  }

  reportCameraPhotoError(message: string): void {
    this.dispatch({ type: "cameraPhotoError", message });
  }

  /** UI / tool entry: one still from the device camera. */
  async captureCameraPhoto(facing: CameraFacing = "default"): Promise<void> {
    try {
      const frame = await this.camera.capturePhoto({ facing });
      this.attachCameraPhoto(cameraPhotoFromFrame(frame));
    } catch (error) {
      this.reportCameraPhotoError(messageOf(error));
      throw error;
    }
  }

  /** UI / tool entry: start live Camera Context. */
  async startCameraContext(facing: CameraFacing = "default"): Promise<void> {
    this.cameraDesired = { facing };
    this.dispatch({ type: "cameraContextError", message: null });
    try {
      await this.openCameraFrames(facing);
    } catch (error) {
      this.cameraDesired = null;
      await this.stopCameraHardware();
      this.dispatch({ type: "cameraContext", active: false, facing: null });
      this.dispatch({ type: "cameraContextError", message: messageOf(error) });
      throw error;
    }
    this.sendNote(cameraContextStartedText(facing));
  }

  /** UI / tool entry: stop live Camera Context; conversation stays up. */
  async stopCameraContext(): Promise<void> {
    const was = this.cameraDesired !== null || this.camera.isActive();
    this.cameraDesired = null;
    await this.stopCameraHardware();
    this.dispatch({ type: "cameraContext", active: false, facing: null });
    if (was) this.sendNote(cameraContextStoppedText());
  }

  /** Switch front/back without ending the Live session. */
  async switchCameraContext(facing: CameraFacing): Promise<void> {
    if (!this.cameraDesired) throw new Error("Camera Context is not active.");
    this.cameraDesired = { facing };
    if (this.camera.isActive()) await this.camera.switchCamera(facing);
    else await this.openCameraFrames(facing);
    this.dispatch({ type: "cameraContext", active: true, facing });
    this.sendNote(cameraContextStartedText(facing));
  }

  /**
   * Remembers one note until Remove, End, or sign-out.
   * Does not archive, edit, or delete the saved note.
   */
  attachNote(note: AttachedNote): string | null {
    const decision = acceptNote(this.notes, this.handoffItem, note);
    if (!decision.ok) {
      this.dispatch({ type: "accountError", message: decision.message });
      return decision.message;
    }
    const copy = copyNote(note);
    this.notes = [...this.notes, copy];
    this.dispatch({ type: "attachNote", note: copy });
    this.noteAccount();
    return null;
  }

  /** Drops one attached note. The saved note is left as it was. */
  detachNote(id: string): void {
    const had = this.notes.find((note) => note.id === id);
    this.notes = this.notes.filter((note) => note.id !== id);
    this.notedNoteIds.delete(id);
    this.dispatch({ type: "detachNote", id });
    if (!had) return;
    this.sendNote(noteDetachedText(had));
  }

  /** Remembers one handoff, replacing any handoff already attached. Does not dismiss it. */
  attachHandoff(handoff: AttachedHandoff): string | null {
    const decision = acceptHandoff(this.notes, this.handoffItem, handoff);
    if (!decision.ok) {
      this.dispatch({ type: "accountError", message: decision.message });
      return decision.message;
    }
    const previous = this.handoffItem;
    const copy = copyHandoff(handoff);
    this.handoffItem = copy;
    this.handoffNoted = false;
    this.dispatch({ type: "attachHandoff", handoff: copy });
    if (previous) this.sendNote(handoffDetachedText());
    this.noteAccount();
    return null;
  }

  /** Drops the attached handoff. The received row is left as it was. */
  detachHandoff(): void {
    const had = this.handoffItem;
    this.handoffItem = null;
    this.handoffNoted = false;
    this.dispatch({ type: "detachHandoff" });
    if (!had) return;
    this.sendNote(handoffDetachedText());
  }

  /**
   * Opens a continuation on a new Live session. The other device's socket and
   * resumption handle are not reused. Returns an error when the session cannot start.
   */
  openContinuation(payload: AssistantContinuation): string | null {
    if (this.snapshot.status !== "IDLE") this.end();
    this.clearAccountContext();
    this.detachSelection();
    this.detachSnapshot();
    this.resumeHandle = null;
    const turns = payload.turns.map((turn) => ({ id: this.nextId(), role: turn.role, text: turn.text }));
    this.dispatch({ type: "seed", turns, from: payload.sourceDeviceName });
    if (payload.selection) {
      this.attachSelection({
        type: "selection",
        text: payload.selection.text,
        ...(payload.selection.sourceApp ? { sourceApp: payload.selection.sourceApp } : {}),
        capturedAt: payload.selection.capturedAt,
      });
    }
    for (const note of payload.notes) this.attachNote(note);
    if (payload.handoff) this.attachHandoff(payload.handoff);
    this.historyTurns = [
      ...payload.turns.map((turn) => ({
        role: turn.role === "assistant" ? "model" as const : "user" as const,
        text: turn.text,
      })),
      ...(payload.screen ? [{ role: "user" as const, text: screenOmittedText(payload.screen) }] : []),
    ];
    this.historySeeded = false;
    this.start();
    const started = this.snapshot.status === "CONNECTING"
      || this.snapshot.status === "READY"
      || this.snapshot.status === "RESPONDING";
    if (started) return null;
    const message = this.snapshot.error ?? "Couldn't start Assistant.";
    if (this.snapshot.status !== "IDLE") this.end();
    return message;
  }

  /**
   * Drops account attachments and the saved-transcript seed.
   * Used on sign-out, including when Assistant is idle and End would do nothing.
   */
  clearAccountContext(): void {
    const notes = this.notes;
    const handoff = this.handoffItem;
    const hadSelection = this.selectionItem !== null;
    const hadScreen = this.screenShot !== null;
    const hadCamera = this.cameraPhoto !== null;
    const hadCameraContext = this.cameraDesired !== null || this.camera.isActive();
    this.notes = [];
    this.handoffItem = null;
    this.notedNoteIds.clear();
    this.handoffNoted = false;
    this.selectionItem = null;
    this.selectionNoted = false;
    this.screenShot = null;
    this.screenNoted = false;
    this.cameraPhoto = null;
    this.cameraPhotoNoted = false;
    this.cameraDesired = null;
    void this.stopCameraHardware();
    this.historyTurns = [];
    this.historySeeded = false;
    this.resumeHandle = null;
    this.openedWithHandle = false;
    this.dropPending();
    this.dispatch({ type: "clearAccount" });
    this.dispatch({ type: "clearPending" });
    if (!notes.length && !handoff && !hadSelection && !hadScreen && !hadCamera && !hadCameraContext) return;
    for (const note of notes) this.sendNote(noteDetachedText(note));
    if (handoff) this.sendNote(handoffDetachedText());
    if (hadSelection) this.sendNote(selectionDetachedText());
    if (hadScreen) this.sendNote(snapshotDetachedText());
    if (hadCamera) this.sendNote(cameraPhotoDetachedText());
    if (hadCameraContext) this.sendNote(cameraContextStoppedText());
  }

  /** Closes the session and stops the microphone and playback. An unfinished line is kept as interrupted. */
  end(): void {
    this.haltComputer();
    if (this.snapshot.status === "IDLE") return;
    this.generation += 1;
    this.connection += 1;
    this.resumeHandle = null;
    this.droppingModel = false;
    this.resuming = false;
    this.selectionItem = null;
    this.selectionNoted = false;
    this.screenShot = null;
    this.screenNoted = false;
    this.cameraPhoto = null;
    this.cameraPhotoNoted = false;
    this.cameraDesired = null;
    void this.stopCameraHardware();
    this.notes = [];
    this.handoffItem = null;
    this.notedNoteIds.clear();
    this.handoffNoted = false;
    this.historyTurns = [];
    this.historySeeded = false;
    this.openedWithHandle = false;
    this.memoryNoted = false;
    this.memorySent = false;
    this.injectedFingerprint = null;
    this.memoryRestartPending = false;
    this.dropPending();
    clearTimeout(this.timer);
    this.resetEcho();
    this.playback.clear();
    this.stopCapture();
    this.session?.close();
    this.session = undefined;
    this.dispatch({ type: "end", ...this.sealedSpeech() });
  }

  private openConnection(generation: number) {
    this.openedWithHandle = this.resumeHandle !== null;
    this.connection += 1;
    const connection = this.connection;
    this.streaming = false;
    this.selectionNoted = false;
    this.personalNoted = false;
    this.memoryNoted = false;
    this.screenNoted = false;
    this.cameraPhotoNoted = false;
    this.notedNoteIds.clear();
    this.handoffNoted = false;
    // Physical camera stays off across a socket hop until ready resumes an explicit intent.
    void this.stopCameraHardware();
    const session = this.openSession(
      (event) => this.onEvent(generation, connection, event),
      this.resumeHandle,
    );
    this.session = session;
    void session.connect().catch(() => undefined);
  }

  /** Opens a new socket with the newest handle. A changed memory drops that handle. */
  private resumeOrFail() {
    if (this.snapshot.status === "IDLE") return;
    if (this.memorySent && this.injectedFingerprint !== this.memoryFingerprint) {
      this.resumeHandle = null;
      this.restartWithoutResume();
      return;
    }
    if (this.resuming || !this.resumeHandle) {
      this.failActive(this.resumeHandle && this.resuming ? RESUME_FAILED : RESUME_LOST);
      return;
    }
    this.resuming = true;
    this.droppingModel = false;
    this.dropPending();
    clearTimeout(this.timer);
    this.playback.clear();
    this.syncEcho(Date.now());
    this.streaming = false;
    this.dispatch({ type: "reconnect", id: this.nextId() });
    this.connection += 1;
    this.session?.close();
    this.openConnection(this.generation);
  }

  private sendNote(text: string): boolean {
    if (!this.session || (this.snapshot.status !== "READY" && this.snapshot.status !== "RESPONDING")) return false;
    try {
      this.session.sendNote(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Replaces the analytics profile sent with this session.
   * A null body clears it. The preference itself stays on the device.
   */
  setPersonalContext(body: string | null): void {
    const next = body?.trim() ? personalContextNote(body) : null;
    if (next === this.personalText) return;
    this.personalText = next;
    this.personalNoted = false;
    this.notePersonal();
  }

  /** Tells the open socket about the current highlight once per connection. */
  private noteSelection() {
    if (!this.selectionItem || this.selectionNoted) return;
    if (!this.sendNote(selectionContextText(this.selectionItem))) return;
    this.selectionNoted = true;
  }

  /** Sends the carried conversation once. A resumed socket already has it. */
  private seedHistory() {
    if (this.openedWithHandle || !this.historyTurns.length || this.historySeeded || !this.session) return;
    try {
      this.session.sendHistory(this.historyTurns);
      this.historySeeded = true;
    } catch {
      this.failActive("Couldn't open the continued conversation. Try again.");
    }
  }

  /** Sends the current personal-context package once per connection. */
  private notePersonal() {
    if (this.personalNoted) return;
    if (!this.personalText && !this.personalWasSent) return;
    const text = this.personalText ?? "Personal context was cleared. Do not use earlier analytics facts.";
    if (!this.sendNote(text)) return;
    this.personalNoted = true;
    this.personalWasSent = Boolean(this.personalText);
  }

  /**
   * Replaces the explicit memories a new session will hear.
   * A live session that already heard a different list is restarted, because
   * the provider cannot remove a fact from the open socket.
   */
  setMemories(rows: readonly AssistantMemory[]): void {
    const next = memoryInjection(rows);
    if (next.fingerprint === this.memoryFingerprint) return;
    const sent = this.memorySent;
    this.memoryText = next.text;
    this.memoryFingerprint = next.fingerprint;
    this.memoryNoted = false;
    const live = this.snapshot.status === "CONNECTING" || this.snapshot.status === "READY" || this.snapshot.status === "RESPONDING";
    if (sent && live) {
      this.memorySent = false;
      if (this.toolDepth > 0) {
        this.memoryRestartPending = true;
        return;
      }
      this.restartWithoutResume();
      return;
    }
    this.noteMemories();
  }

  /** Sends the account memories once. A resumed socket keeps the same list. */
  private noteMemories() {
    if (this.memoryNoted) return;
    if (this.openedWithHandle && this.injectedFingerprint === this.memoryFingerprint) {
      this.memoryNoted = true;
      return;
    }
    if (!this.memoryText) {
      this.memoryNoted = true;
      this.injectedFingerprint = this.memoryFingerprint;
      return;
    }
    if (!this.sendNote(this.memoryText)) return;
    this.memoryNoted = true;
    this.memorySent = true;
    this.injectedFingerprint = this.memoryFingerprint;
  }

  /**
   * Opens a new socket without the resumption handle so the forgotten or
   * corrected memory is not still in the provider context.
   */
  private restartWithoutResume(): void {
    if (this.snapshot.status === "IDLE" || this.snapshot.status === "ERROR") return;
    this.memoryRestartPending = false;
    this.resumeHandle = null;
    this.resuming = false;
    this.droppingModel = false;
    this.dropPending();
    clearTimeout(this.timer);
    this.playback.clear();
    this.dispatch({
      type: "actionNotice",
      message: "A remembered preference changed. This session is restarting so it does not keep the old one.",
    });
    this.dispatch({ type: "reconnect", id: this.nextId() });
    this.session?.close();
    this.openConnection(this.generation);
  }

  /** Sends each attached note and the handoff once per connection. */
  private noteAccount() {
    for (const note of this.notes) {
      if (this.notedNoteIds.has(note.id)) continue;
      if (!this.sendNote(noteContextText(note))) return;
      this.notedNoteIds.add(note.id);
    }
    if (!this.handoffItem || this.handoffNoted) return;
    if (!this.sendNote(handoffContextText(this.handoffItem))) return;
    this.handoffNoted = true;
  }

  /** Sends the still image once per connection, then a note that it is not a live screen. */
  private noteSnapshot() {
    if (!this.screenShot || this.screenNoted || !this.session) return;
    if (this.snapshot.status !== "READY" && this.snapshot.status !== "RESPONDING") return;
    try {
      this.session.sendVideo(this.screenShot.jpeg);
      if (!this.sendNote(snapshotContextText(this.screenShot))) return;
      this.screenNoted = true;
    } catch {
      this.screenNoted = false;
    }
  }

  /** Sends the camera still once per connection. Distinct from screen context. */
  private noteCameraPhoto() {
    if (!this.cameraPhoto || this.cameraPhotoNoted || !this.session) return;
    if (this.snapshot.status !== "READY" && this.snapshot.status !== "RESPONDING") return;
    try {
      this.session.sendVideo(this.cameraPhoto.jpeg);
      if (!this.sendNote(cameraPhotoContextText(this.cameraPhoto))) return;
      this.cameraPhotoNoted = true;
    } catch {
      this.cameraPhotoNoted = false;
    }
  }

  private async openCameraFrames(facing: CameraFacing): Promise<void> {
    const generation = this.generation;
    this.cameraGate.clear();
    await this.camera.startFrames(
      { facing, maxFps: 1 },
      (frame) => {
        if (generation !== this.generation || !this.cameraDesired) return;
        if (this.snapshot.status !== "READY" && this.snapshot.status !== "RESPONDING") return;
        const ready = this.cameraGate.offer(frame);
        if (!ready) return;
        try {
          this.session?.sendVideo(ready.jpeg);
        } catch {
          // Drop the frame while the socket is not ready; never replay it.
        }
      },
      (message) => {
        if (generation !== this.generation) return;
        this.cameraDesired = null;
        void this.stopCameraHardware();
        this.dispatch({ type: "cameraContext", active: false, facing: null });
        this.dispatch({ type: "cameraContextError", message });
      },
    );
    this.dispatch({ type: "cameraContext", active: true, facing: this.camera.activeFacing() ?? facing });
  }

  private stopCameraHardware(): Promise<void> {
    this.cameraGate.clear();
    this.cameraStop = this.camera.stop().catch(() => undefined);
    return this.cameraStop;
  }

  /** After a Live socket is ready, resume Camera Context only when still explicitly desired. */
  private resumeCameraIfDesired() {
    const desired = this.cameraDesired;
    if (!desired) return;
    void this.cameraStop.then(async () => {
      if (!this.cameraDesired) return;
      if (this.camera.isActive()) return;
      try {
        await this.openCameraFrames(desired.facing);
        this.sendNote(cameraContextStartedText(desired.facing));
      } catch (error) {
        this.cameraDesired = null;
        this.dispatch({ type: "cameraContext", active: false, facing: null });
        this.dispatch({ type: "cameraContextError", message: messageOf(error) });
      }
    });
  }

  private beginCapture(generation: number) {
    if (!this.createCapture) return;
    let capture: AudioCapture;
    try {
      capture = this.createCapture();
    } catch (error) {
      this.failActive(messageOf(error));
      return;
    }
    this.capture = capture;
    this.playback.onAudibleChange?.(() => {
      if (generation !== this.generation) return;
      this.syncEcho(Date.now());
    });
    this.playback.onDuplexChange?.((fullDuplex, nativePlayback) => {
      if (generation !== this.generation) return;
      this.echoKnown = true;
      if (fullDuplex) this.echo = duplexEchoGate();
      else this.echo = { ...gatedEchoGate(), remainingMs: 1 };
      this.playback.setNativeRoute?.(nativePlayback);
      this.syncEcho(Date.now());
    });
    void capture.start(
      (chunk) => this.onMic(generation, chunk),
      (message) => { if (generation === this.generation) this.failActive(message); },
    ).then((status) => {
      if (generation !== this.generation) return;
      this.applyCaptureEcho(status);
    }).catch((error: unknown) => {
      if (generation === this.generation) this.failActive(messageOf(error));
    });
  }

  private onMic(generation: number, chunk: ArrayBuffer) {
    if (generation !== this.generation || chunk.byteLength === 0) return;
    this.syncEcho(Date.now());
    if (!shouldForwardMicrophone(this.echo, Date.now())) return;
    if (!this.streaming) {
      this.pendingAudio.push(chunk);
      return;
    }
    this.forward(chunk);
  }

  private forward(chunk: ArrayBuffer) {
    try {
      this.session?.sendAudio(chunk);
    } catch {
      if (this.resuming || this.snapshot.status === "CONNECTING") {
        this.pendingAudio.push(chunk);
        return;
      }
      if (this.snapshot.status !== "IDLE") this.failActive("Couldn't send microphone audio.");
    }
  }

  private flushPending() {
    const queued = this.pendingAudio;
    this.pendingAudio = [];
    this.streaming = true;
    for (const chunk of queued) this.forward(chunk);
  }

  private stopCapture() {
    this.streaming = false;
    this.pendingAudio = [];
    const capture = this.capture;
    this.capture = undefined;
    if (capture) void capture.stop(false).catch(() => undefined);
    this.lease.release("assistant");
  }

  private applyCaptureEcho(status: CaptureEchoStatus | void) {
    if (this.snapshot.status === "IDLE" || this.snapshot.status === "ERROR") return;
    const echo = captureEchoFrom(status);
    this.echoKnown = true;
    this.echo = echo.fullDuplex ? duplexEchoGate() : gatedEchoGate();
    this.playback.setNativeRoute?.(echo.nativePlayback);
    this.syncEcho(Date.now());
  }

  private syncEcho(now: number) {
    if (this.snapshot.status === "IDLE" || this.snapshot.status === "ERROR") return;
    if (!this.echo.duplex) {
      const pending = this.playback.pendingMs?.(now) ?? 0;
      this.echo = noteRemaining(this.echo, now, pending, ECHO_TAIL_MS);
    }
    this.publishEcho();
    this.scheduleEcho(now);
  }

  private publishEcho() {
    const fallback = this.echoKnown && !this.echo.duplex;
    const held = fallback && microphoneHeld(this.echo, Date.now());
    this.dispatch({ type: "echo", fallback, held });
  }

  private scheduleEcho(now: number) {
    clearTimeout(this.echoTimer);
    if (this.echo.duplex) return;
    const pending = this.playback.pendingMs?.(now) ?? this.echo.remainingMs;
    const untilSilence = this.echo.holdUntil > now ? this.echo.holdUntil - now : 0;
    const wait = pending > 0 ? pending : untilSilence;
    if (wait <= 0) return;
    const generation = this.generation;
    this.echoTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.syncEcho(Date.now());
    }, Math.min(wait, 500) + 20);
  }

  private resetEcho() {
    clearTimeout(this.echoTimer);
    this.echo = duplexEchoGate();
    this.echoKnown = false;
  }

  private onEvent(generation: number, connection: number, event: AssistantEvent) {
    if (generation !== this.generation || connection !== this.connection) return;
    switch (event.type) {
      case "ready":
        this.resuming = false;
        this.droppingModel = false;
        this.dispatch({ type: "ready" });
        this.seedHistory();
        this.noteSelection();
        this.noteAccount();
        this.notePersonal();
        this.noteMemories();
        this.noteSnapshot();
        this.noteCameraPhoto();
        this.resumeCameraIfDesired();
        this.flushPending();
        return;
      case "resumption":
        this.resumeHandle = event.handle;
        return;
      case "inputTranscription":
        if (event.partial) this.dispatch({ type: "userPartial", text: event.text });
        else {
          const id = this.nextId();
          const spokenId = this.snapshot.status === "RESPONDING" ? this.nextId() : undefined;
          this.dispatch({
            type: "userFinal",
            id,
            text: event.text,
            ...(spokenId ? { spokenId } : {}),
          });
          this.armTimer();
        }
        return;
      case "audio":
        if (this.droppingModel) return;
        this.dispatch({ type: "assistantSpeaking" });
        this.playback.enqueue(event.pcm);
        this.syncEcho(Date.now());
        this.armTimer();
        return;
      case "outputTranscription":
        if (this.droppingModel) return;
        this.dispatch({ type: "output", text: event.text });
        this.armTimer();
        return;
      case "turnComplete":
        clearTimeout(this.timer);
        if (this.droppingModel) {
          this.droppingModel = false;
          return;
        }
        this.dispatch({ type: "turnComplete", id: this.nextId() });
        return;
      case "interrupted":
        this.droppingModel = true;
        clearTimeout(this.timer);
        this.playback.clear();
        this.syncEcho(Date.now());
        this.dispatch({ type: "interrupt", id: this.nextId() });
        return;
      case "goAway":
      case "disconnected":
        this.resumeOrFail();
        return;
      case "toolCalls":
        this.enqueueTools(event.calls);
        return;
      case "grounding":
        this.dispatch({ type: "grounding", sources: event.sources });
        return;
      case "notice":
        this.dispatch({ type: "actionNotice", message: event.message });
        return;
      case "error":
        if (this.resuming) this.failActive(RESUME_FAILED);
        else if (event.retryable && this.resumeHandle) this.resumeOrFail();
        else this.failActive(event.message);
        return;
      default: {
        const unhandled: never = event;
        throw new Error(`Unhandled assistant event: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** Confirms the action that is waiting. Does nothing when none is waiting or it is already running. */
  confirmPending(): void {
    const pending = this.pending;
    if (!pending || pending.working) return;
    pending.working = true;
    this.dispatch({ type: "setPending", pending: pendingCard(pending) });
    const epoch = this.toolEpoch;
    void this.finishPending(pending, epoch);
  }

  /** Ends a supervised screen task before the next step. */
  stopComputer(): void {
    this.haltComputer();
  }

  /** Confirms the Computer Use step that is waiting. */
  confirmComputer(): void {
    this.computerConfirm?.(true);
  }

  /** Cancels the waiting action and tells Gemini nothing changed. */
  cancelPending(): void {
    const pending = this.pending;
    if (!pending || pending.working) return;
    this.pending = null;
    this.dispatch({ type: "clearPending" });
    this.replyTool(pending.id, pending.name, false, ACTION_CANCELLED);
  }

  private enqueueTools(calls: ParsedToolCall[]) {
    this.toolQueue = this.toolQueue
      .then(() => this.handleToolCalls(calls))
      .catch(() => undefined);
  }

  private async handleToolCalls(calls: ParsedToolCall[]) {
    this.toolDepth += 1;
    try {
      for (const call of calls) {
        // Tool execution is local to the active socket, not gated by the cloud transcript lease.
        // The conversation store independently fences shared transcript writes.
        const decision = decideToolCall(call, (deviceName) => this.actions.planHandoff(deviceName));
        if (decision.kind === "ignore") continue;
        if (decision.kind === "reject") {
          this.replyTool(decision.id, decision.name, false, decision.message);
          continue;
        }
        if (decision.kind === "copy") {
          await this.runCopy(decision);
          continue;
        }
        if (decision.kind === "capture") {
          await this.runCapture(decision);
          continue;
        }
        if (decision.kind === "cameraPhoto") {
          await this.runCameraPhoto(decision);
          continue;
        }
        if (decision.kind === "cameraStart") {
          await this.runCameraStart(decision);
          continue;
        }
        if (decision.kind === "cameraStop") {
          await this.runCameraStop(decision);
          continue;
        }
        if (decision.kind === "accessibility") {
          await this.runAccessibility(decision);
          continue;
        }
        if (decision.kind === "selection") {
          await this.runSelection(decision);
          continue;
        }
        if (decision.kind === "apps") {
          await this.runInstalledApps(decision);
          continue;
        }
        if (decision.kind === "snippets") {
          await this.runSnippets(decision);
          continue;
        }
        if (decision.kind === "dashboard") {
          await this.runDashboard(decision);
          continue;
        }
        if (decision.kind === "notes") {
          await this.runNotes(decision);
          continue;
        }
        if (decision.kind === "memories") {
          await this.runMemories(decision);
          continue;
        }
        if (decision.kind === "handoffs") {
          await this.runHandoffs(decision);
          continue;
        }
        if (decision.kind === "remote") {
          await this.runRemote(decision);
          continue;
        }
        if (this.pending) {
          this.replyTool(decision.id, decision.name, false, ACTION_BUSY);
          continue;
        }
        let preview = decision.preview;
        const kind = itemKind(decision.name);
        if (kind) {
          try {
            preview = this.actions.describeItem(kind, decision.text);
          } catch (error) {
            this.replyTool(decision.id, decision.name, false, toolFailure(error));
            continue;
          }
        }
        this.pending = {
          id: decision.id,
          name: decision.name,
          text: decision.text,
          title: decision.title,
          preview,
          deviceId: decision.deviceId,
          label: decision.name === "send_handoff" ? decision.title.slice("Send this text to ".length) : null,
          remote: decision.remote,
          memory: decision.memory,
          working: false,
        };
        if (this.autoRun) {
          this.pending.working = true;
          const epoch = this.toolEpoch;
          await this.finishPending(this.pending, epoch);
          continue;
        }
        this.dispatch({ type: "setPending", pending: pendingCard(this.pending) });
      }
    } finally {
      this.toolDepth -= 1;
      if (this.toolDepth === 0 && this.memoryRestartPending) this.restartWithoutResume();
    }
  }

  private async runRemote(decision: Extract<ToolDecision, { kind: "remote" }>) {
    const epoch = this.toolEpoch;
    try {
      const result = await this.actions.readRemote(decision.read, decision.device);
      if (epoch !== this.toolEpoch) return;
      if (result.screenshot) this.attachSnapshot(result.screenshot);
      this.replyTool(decision.id, decision.name, true, result.text);
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runCapture(decision: Extract<ToolDecision, { kind: "capture" }>) {
    const epoch = this.toolEpoch;
    try {
      const screen = await this.actions.captureScreen();
      if (epoch !== this.toolEpoch) return;
      this.attachSnapshot(screen);
      this.replyTool(decision.id, decision.name, true, "Captured the screen.");
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runCameraPhoto(decision: Extract<ToolDecision, { kind: "cameraPhoto" }>) {
    const epoch = this.toolEpoch;
    try {
      await this.captureCameraPhoto(decision.facing);
      if (epoch !== this.toolEpoch) return;
      this.replyTool(
        decision.id,
        decision.name,
        true,
        `Captured a photo from the ${cameraFacingLabel(decision.facing)}.`,
      );
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runCameraStart(decision: Extract<ToolDecision, { kind: "cameraStart" }>) {
    const epoch = this.toolEpoch;
    try {
      await this.startCameraContext(decision.facing);
      if (epoch !== this.toolEpoch) return;
      this.replyTool(
        decision.id,
        decision.name,
        true,
        `Camera Context is on using the ${cameraFacingLabel(decision.facing)}.`,
      );
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.cameraDesired = null;
      this.dispatch({ type: "cameraContext", active: false, facing: null });
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runCameraStop(decision: Extract<ToolDecision, { kind: "cameraStop" }>) {
    const epoch = this.toolEpoch;
    try {
      await this.stopCameraContext();
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, true, "Camera Context is off.");
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runAccessibility(decision: Extract<ToolDecision, { kind: "accessibility" }>) {
    const epoch = this.toolEpoch;
    if (!navigator.userAgent.includes("Windows")) {
      this.replyTool(decision.id, decision.name, false, "Accessibility inspection is Windows-only.");
      return;
    }
    try {
      const result = await invoke<{windowTitle: string | null; focusedName: string | null; text: string | null; status: string}>("inspect_accessibility");
      if (epoch !== this.toolEpoch) return;
      if (result.status === "protected") {
        this.replyTool(decision.id, decision.name, false, "The focused control is protected.");
        return;
      }
      const text = [result.windowTitle, result.focusedName, result.text].filter(Boolean).join("\n");
      this.replyTool(decision.id, decision.name, true, text || "No accessible text was available.");
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runSelection(decision: Extract<ToolDecision, { kind: "selection" }>) {
    const epoch = this.toolEpoch;
    try {
      const item = await this.actions.captureSelection();
      if (epoch !== this.toolEpoch) return;
      const message = this.attachSelection(item);
      if (message) {
        this.replyTool(decision.id, decision.name, false, message);
        return;
      }
      const source = item.sourceApp ? ` From ${item.sourceApp}.` : "";
      this.replyTool(decision.id, decision.name, true, `Attached the selection.${source}\n${item.text}`);
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runInstalledApps(decision: Extract<ToolDecision, { kind: "apps" }>) {
    const epoch = this.toolEpoch;
    if (!navigator.userAgent.includes("Windows")) {
      this.replyTool(decision.id, decision.name, false, "Windows only.");
      return;
    }
    try {
      const apps = await invoke<Array<{name: string}>>("list_installed_apps");
      if (epoch === this.toolEpoch) {
        this.replyTool(decision.id, decision.name, true, JSON.stringify(apps).slice(0, 8000));
      }
    } catch (error) {
      if (epoch === this.toolEpoch) this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runSnippets(decision: Extract<ToolDecision, { kind: "snippets" }>) {
    const epoch = this.toolEpoch;
    try {
      const result = await this.actions.listSnippets();
      if (epoch === this.toolEpoch) this.replyTool(decision.id, decision.name, true, result.slice(0, 8000));
    } catch (error) {
      if (epoch === this.toolEpoch) this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runDashboard(decision: Extract<ToolDecision, { kind: "dashboard" }>) {
    const epoch = this.toolEpoch;
    try {
      const text = await this.actions.readDashboard(decision.name);
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, true, text.slice(0, 8000));
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runNotes(decision: Extract<ToolDecision, { kind: "notes" }>) {
    const epoch = this.toolEpoch;
    try {
      const text = await this.actions.listVoiceNotes(decision.includeArchived);
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, true, text);
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runMemories(decision: Extract<ToolDecision, { kind: "memories" }>) {
    const epoch = this.toolEpoch;
    try {
      const text = await this.actions.listMemories();
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, true, text);
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runHandoffs(decision: Extract<ToolDecision, { kind: "handoffs" }>) {
    const epoch = this.toolEpoch;
    try {
      const text = await this.actions.listHandoffs();
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, true, text);
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async runCopy(decision: Extract<ToolDecision, { kind: "copy" }>) {
    const epoch = this.toolEpoch;
    try {
      await this.actions.copyText(decision.text);
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, true, "Copied to the clipboard.");
      this.dispatch({ type: "actionNotice", message: "Copied to the clipboard." });
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(decision.id, decision.name, false, toolFailure(error));
    }
  }

  private async finishPending(pending: ConfirmedTool, epoch: number) {
    // User-confirmed local actions do not require ownership of the shared transcript lease.
    try {
      const message = await this.execute(pending);
      if (epoch !== this.toolEpoch) return;
       this.replyTool(pending.id, pending.name, true, message);
    } catch (error) {
      if (epoch !== this.toolEpoch) return;
      this.replyTool(pending.id, pending.name, false, toolFailure(error));
    } finally {
      if (epoch === this.toolEpoch && this.pending?.id === pending.id) {
        this.pending = null;
        this.dispatch({ type: "clearPending" });
      }
    }
  }

  private haltComputer(): void {
    this.computerStopped = true;
    const confirm = this.computerConfirm;
    this.computerConfirm = null;
    confirm?.(false);
    if (this.snapshot.computerRunning || this.snapshot.computerPrompt) {
      this.dispatch({ type: "computer", running: false, prompt: null });
    }
  }

  private confirmComputerStep(explanation: string): Promise<boolean> {
    if (this.computerStopped) return Promise.resolve(false);
    if (this.autoRun) return Promise.resolve(true);
    this.dispatch({ type: "computer", running: true, prompt: explanation });
    return new Promise((resolve) => {
      this.computerConfirm = (allowed) => {
        this.computerConfirm = null;
        if (!this.computerStopped) this.dispatch({ type: "computer", running: true, prompt: null });
        resolve(allowed && !this.computerStopped);
      };
    });
  }

  private async runSupervised(goal: string): Promise<string> {
    this.computerStopped = false;
    this.dispatch({ type: "computer", running: true, prompt: null });
    try {
      return await runComputerTask(goal, {
        now: () => Date.now(),
        stopped: () => this.computerStopped,
        capture: () => this.actions.computer.capture(),
        propose: (body) => this.actions.computer.propose(body),
        execute: (call, image) => this.actions.computer.execute(call, image),
        confirm: (explanation) => this.confirmComputerStep(explanation),
      });
    } finally {
      this.computerConfirm = null;
      this.computerStopped = true;
      this.dispatch({ type: "computer", running: false, prompt: null });
      await this.actions.computer.restore().catch(() => undefined);
    }
  }

  private async execute(pending: ConfirmedTool): Promise<string> {
    switch (pending.name) {
      case "insert_text":
        await this.actions.insertText(pending.text);
        return "Inserted the text into the focused app.";
      case "focus_accessible_control":
        if (!navigator.userAgent.includes("Windows")) throw new Error("Windows only.");
        return invoke<string>("focus_accessible_control", { expectedName: pending.text });
      case "invoke_accessible_control":
        if (!navigator.userAgent.includes("Windows")) throw new Error("Windows only.");
        return invoke<string>("invoke_accessible_control", { expectedName: pending.text });
      case "create_snippet":
      case "update_snippet": {
        const input = JSON.parse(pending.text) as {id: string | null; trigger: string; content: string};
        if (pending.name === "create_snippet") await this.actions.createSnippet(input.trigger, input.content);
        else {
          if (!input.id) throw new Error("Snippet id required.");
          await this.actions.updateSnippet(input.id, input.trigger, input.content);
        }
        return pending.name === "create_snippet" ? "Created the snippet." : "Updated the snippet.";
      }
      case "send_remote_dictation": {
        const input = JSON.parse(pending.text) as {text: string; device: string};
        await this.actions.sendRemoteDictation(input.text, input.device);
        return `Sent dictation to ${input.device}.`;
      }
      case "edit_voice_note": {
        const input = JSON.parse(pending.text) as {id: string; text: string};
        await this.actions.editVoiceNote(input.id, input.text);
        return "Updated the note.";
      }
      case "create_transform": {
        const input = JSON.parse(pending.text) as {name: string; instruction: string};
        await this.actions.createTransform(input.name, input.instruction);
        return "Created the transform.";
      }
      case "add_dictionary_word":
        await this.actions.addDictionaryWord(pending.text);
        return "Added the dictionary word.";
      case "create_voice_note":
        await this.actions.createVoiceNote(pending.text);
        return "Saved the note.";
      case "archive_voice_note":
        await this.actions.archiveVoiceNote(pending.text, true);
        return "Archived the note.";
      case "restore_voice_note":
        await this.actions.archiveVoiceNote(pending.text, false);
        return "Restored the note.";
      case "delete_voice_note":
        await this.actions.deleteVoiceNote(pending.text);
        return "Deleted the note.";
      case "dismiss_handoff":
        await this.actions.dismissHandoff(pending.text);
        return "Dismissed the handoff.";
      case "send_handoff":
        if (!pending.deviceId) throw new Error("Choose a device in Handoffs first.");
        await this.actions.sendHandoff(pending.text, pending.deviceId);
        return `Sent the text to ${pending.label ?? "the selected device"}.`;
      case "open_app":
        return this.actions.computer.openApp(pending.text);
      case "press_shortcut":
        return this.actions.computer.pressShortcut(pending.text);
      case "remote_action": {
        if (!pending.remote) throw new Error("That action is not available.");
        return this.actions.computer.remoteAction(pending.remote.action, pending.text, pending.remote.device);
      }
      case "supervise_screen":
        return this.runSupervised(pending.text);
      case "remember_memory":
        if (!pending.memory || pending.memory.action !== "remember") throw new Error("That memory is not available.");
        return this.actions.rememberMemory(pending.memory);
      case "change_memory":
        if (!pending.memory || pending.memory.action !== "change") throw new Error("That memory is not available.");
        return this.actions.changeMemory(pending.memory);
      case "forget_memory":
        if (!pending.memory || pending.memory.action !== "forget") throw new Error("That memory is not available.");
        return this.actions.forgetMemory(pending.memory.key);
      default: {
        const unhandled: never = pending.name;
        throw new Error(`Unhandled assistant action: ${String(unhandled)}`);
      }
    }
  }

  private replyTool(id: string, name: string, ok: boolean, message: string) {
    if (ok) this.onToolRecord?.({ name, outcome: message });
    const session = this.session;
    if (!session) return;
    try {
      session.sendToolResponse(assistantToolResponse([{ id, name, ok, message }]));
    } catch {
      // The socket is gone. Do not invent a later success.
    }
  }

  private dropPending() {
    this.toolEpoch += 1;
    this.pending = null;
  }

  private failActive(message: string) {
    this.resuming = false;
    this.droppingModel = false;
    this.resumeHandle = null;
    this.cameraDesired = null;
    void this.stopCameraHardware();
    this.dropPending();
    clearTimeout(this.timer);
    this.resetEcho();
    this.playback.clear();
    this.stopCapture();
    this.connection += 1;
    this.session?.close();
    this.session = undefined;
    this.dispatch({ type: "cameraContext", active: false, facing: null });
    this.dispatch({ type: "fail", message, ...this.sealedSpeech() });
  }

  private armTimer() {
    if (this.snapshot.status !== "RESPONDING") return;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.failActive("Assistant didn't respond. Try again.");
    }, RESPONSE_TIMEOUT_MS);
  }

  /** Ids for speech still on screen, so a stop or a dropped connection can store it as interrupted. */
  private sealedSpeech(): { user?: { id: string; text: string }; assistant?: { id: string; text: string } } {
    const assistant = this.snapshot.liveText.trim();
    const user = this.snapshot.liveUser.trim();
    return {
      ...(assistant ? { assistant: { id: this.nextId(), text: assistant } } : {}),
      ...(user ? { user: { id: this.nextId(), text: user } } : {}),
    };
  }

  private dispatch(action: Parameters<typeof assistantReducer>[1]) {
    const previous = this.snapshot.turns;
    const next = assistantReducer(this.snapshot, action);
    if (next === this.snapshot) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
    this.publishTurns(previous, next.turns);
  }

  /** Hands new turns to storage once. A later reload of the same ids is not a second copy. */
  private publishTurns(previous: readonly AssistantTurn[], turns: readonly AssistantTurn[]) {
    const before = new Map(previous.map((turn) => [turn.id, turn]));
    for (const turn of turns) {
      const prior = before.get(turn.id);
      if (!prior) {
        if (this.published.has(turn.id)) continue;
        this.published.add(turn.id);
        this.onCommitted?.(turn);
        continue;
      }
      if (sourcesChanged(prior, turn)) this.onRevised?.(turn);
    }
  }
}

function sourcesChanged(previous: AssistantTurn, next: AssistantTurn): boolean {
  const left = previous.sources ?? [];
  const right = next.sources ?? [];
  if (left.length !== right.length) return true;
  return left.some((source, index) => source.url !== right[index]?.url || source.title !== right[index]?.title);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Couldn't start the microphone.";
}

function itemKind(name: ConfirmToolName): "note" | "handoff" | null {
  if (name === "archive_voice_note" || name === "restore_voice_note" || name === "delete_voice_note") return "note";
  if (name === "dismiss_handoff") return "handoff";
  return null;
}

interface ConfirmedTool {
  id: string;
  name: ConfirmToolName;
  text: string;
  title: string;
  preview: string;
  deviceId: string | null;
  label: string | null;
  remote: { action: RemoteComputerAction; device: string } | null;
  memory: MemoryCommand | null;
  working: boolean;
}

function pendingCard(pending: ConfirmedTool): PendingAssistantAction {
  return { id: pending.id, title: pending.title, preview: pending.preview, working: pending.working };
}

function toolFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The action failed.";
}
