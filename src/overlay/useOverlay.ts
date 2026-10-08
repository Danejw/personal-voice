import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyHandoffText } from "@/assistant/continuation";
import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import { buildOverlaySnapshot, clipOverlayText, overlayAssistantFrom, overlayAssistantIntent, overlayAssistantInterrupt, overlayDictateIntent } from "@/overlay/overlay";
import type { OverlayAction, OverlaySnapshot } from "@/overlay/overlay";
import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSnapshot } from "@/assistant/state";
import type { Note } from "@/notes/note";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import type { VoiceProvider } from "@/voice/provider/VoiceProvider";
import type { DictationController, DictationSnapshot } from "@/voice/session/DictationController";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

const NOTICE_MS = 4000;

function quietly(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}

export interface OverlayBindings {
  platform: PlatformAdapter;
  visible: boolean;
  dictation: DictationSnapshot;
  paused: boolean;
  signedIn: boolean;
  destination: TranscriptDestinationId;
  notes: Note[];
  handoffs: Handoff[];
  devices: OwnedDevice[];
  controller: DictationController;
  getProvider: () => VoiceProvider;
  onDestination(destination: TranscriptDestinationId): void;
  /** One utterance only. Does not change the saved destination. */
  overrideDestination(destination: TranscriptDestinationId | null): void;
  insertHandoff(text: string): Promise<void>;
  dismissHandoff(id: string): Promise<void>;
  onSelectionCaptured?(): void;
  /** Called at the overlay before an utterance starts. */
  onArmDictation?(): void;
  /** False while Assistant holds the microphone. */
  canDictate?(): boolean;
  assistant: AssistantSnapshot;
  assistantController: AssistantController;
  remoteTargetId: string | null;
  remoteTargetLabel: string | null;
  remoteTargetPlatform: string | null;
  remoteTargetKind: "phone" | "laptop" | "desktop" | "unknown";
  remoteTargetOnline: boolean;
  remoteTargetCount: number;
  remoteDictationActive: boolean;
  remoteNotice: string | null;
  remoteTipEpoch: number;
  onCycleRemoteTarget(): void;
  /** Locks the utterance target and returns it. Throws when unavailable. */
  onLockRemoteTarget(targetId: string): { id: string; name: string };
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Android's overlay copies natively when the WebView is backgrounded.
  }
}

/**
 * Pushes one overlay snapshot to the platform and routes overlay clicks back
 * into the shared dictation, notes, and handoff stores.
 */
export function useOverlay({
  platform,
  visible,
  dictation,
  paused,
  signedIn,
  destination,
  notes,
  handoffs,
  devices,
  controller,
  getProvider,
  onDestination,
  overrideDestination,
  insertHandoff,
  dismissHandoff,
  onSelectionCaptured,
  onArmDictation,
  canDictate,
  assistant,
  assistantController,
  remoteTargetId,
  remoteTargetLabel,
  remoteTargetPlatform,
  remoteTargetKind,
  remoteTargetOnline,
  remoteTargetCount,
  remoteDictationActive,
  remoteNotice,
  remoteTipEpoch,
  onCycleRemoteTarget,
  onLockRemoteTarget,
}: OverlayBindings): OverlaySnapshot {
  const [capture, setCapture] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const providerRef = useRef(getProvider);
  const armRef = useRef(onArmDictation);
  const canDictateRef = useRef(canDictate);
  const cycleRef = useRef(onCycleRemoteTarget);
  const lockRef = useRef(onLockRemoteTarget);
  useEffect(() => { providerRef.current = getProvider; }, [getProvider]);
  armRef.current = onArmDictation;
  canDictateRef.current = canDictate;
  cycleRef.current = onCycleRemoteTarget;
  lockRef.current = onLockRemoteTarget;

  const snapshot = useMemo(() => buildOverlaySnapshot({
    visible,
    state: dictation.state,
    error: dictation.error,
    destination,
    signedIn,
    paused,
    notes,
    handoffs,
    devices,
    capture,
    notice: notice ?? remoteNotice,
    assistant: overlayAssistantFrom(assistant.status),
    assistantError: assistant.status === "ERROR" ? assistant.error : null,
    selectionPreview: assistant.selection ? clipOverlayText(assistant.selection.text) : null,
    selectionSource: assistant.selection?.sourceApp ?? null,
    pendingTitle: assistant.pendingAction?.title ?? null,
    pendingPreview: assistant.pendingAction?.preview ?? null,
    pendingWorking: assistant.pendingAction?.working ?? false,
    assistantInterrupt: overlayAssistantInterrupt(
      assistant.echoFallback,
      assistant.playbackHeld,
      overlayAssistantFrom(assistant.status),
    ),
    cameraOn: assistant.cameraContextActive,
    computerActive: assistant.computerRunning,
    remoteTargetId,
    remoteTargetLabel,
    remoteTargetPlatform,
    remoteTargetKind,
    remoteTargetOnline,
    remoteTargetCount,
    remoteDictationActive,
    remoteTipEpoch,
  }), [
    visible,
    dictation.state,
    dictation.error,
    destination,
    signedIn,
    paused,
    notes,
    handoffs,
    devices,
    capture,
    notice,
    remoteNotice,
    assistant,
    remoteTargetId,
    remoteTargetLabel,
    remoteTargetPlatform,
    remoteTargetKind,
    remoteTargetOnline,
    remoteTargetCount,
    remoteDictationActive,
    remoteTipEpoch,
  ]);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const handoffsRef = useRef(handoffs);
  handoffsRef.current = handoffs;

  useEffect(() => {
    quietly(platform.syncOverlay(snapshot));
  }, [platform, snapshot]);

  const releasedHolds = useRef(new Set<string>());
  const activeNoteHold = useRef<number | null>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? null : current), NOTICE_MS);
  }, []);

  const captureSelection = useCallback(async () => {
    try {
      const item = await platform.captureSelection({ restoreSettings: false });
      setCapture(clipOverlayText(item.text));
      try { onSelectionCaptured?.(); } catch { /* usage must not fail capture */ }
      const message = assistantController.attachSelection(item);
      flash(message ?? "Selection attached to Assistant.");
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : String(reason));
    }
  }, [assistantController, flash, onSelectionCaptured, platform]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void platform.onPushToTalk((event) => {
      if (event.event === "capture-selection") void captureSelection();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [captureSelection, platform]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void platform.onOverlayAction((action) => {
      void handleAction(action);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };

    async function handleAction(action: OverlayAction) {
      switch (action.type) {
        case "dictate-toggle": {
          const intent = overlayDictateIntent(snapshotRef.current.dictation);
          switch (intent) {
            case "start":
              if (snapshotRef.current.paused || !snapshotRef.current.signedIn) return;
              if (canDictateRef.current && !canDictateRef.current()) return;
              armRef.current?.();
              controller.reset();
              await controller.start(providerRef.current());
              return;
            case "stop":
              await controller.stop();
              return;
            case "ignore":
              return;
            default: {
              const unhandled: never = intent;
              throw new Error(`Unhandled overlay dictate intent: ${String(unhandled)}`);
            }
          }
        }
        case "dictate-hold": {
          const token = `note:${action.id}`;
          if (action.phase !== "start") {
            releasedHolds.current.add(token);
            if (activeNoteHold.current !== action.id) return;
            activeNoteHold.current = null;
            if (action.phase === "cancel") {
              await controller.cancel();
              overrideDestination(null);
            } else {
              await controller.stop();
              // An accidental too-short hold can be discarded without calling deliver.
              // In that case the one-shot Note destination must not leak to the next
              // regular dictation.
              if (controller.current.state === "IDLE" || controller.current.state === "ERROR") {
                overrideDestination(null);
              }
            }
            return;
          }
          if (releasedHolds.current.delete(token)) return;
          if (snapshotRef.current.paused || !snapshotRef.current.signedIn) return;
          if (canDictateRef.current && !canDictateRef.current()) return;
          if (overlayDictateIntent(snapshotRef.current.dictation) !== "start") return;
          activeNoteHold.current = action.id;
          overrideDestination(action.destination);
          armRef.current?.();
          controller.reset();
          await controller.start(providerRef.current());
          // A fast release/cancel can arrive while capture starts; the earlier handler
          // finishes or cancels it, so do not start another transcription here.
          return;
        }
        case "cycle-remote-target":
          cycleRef.current();
          return;
        case "remote-dictate-hold": {
          const token = `remote:${action.id}`;
          if (action.phase === "stop") {
            releasedHolds.current.add(token);
            // Releasing only ends capture. The remote target must survive FINALIZING
            // until the dictation controller actually delivers, cancels, or fails.
            await controller.stop();
            return;
          }
          if (releasedHolds.current.delete(token)) return;
          if (snapshotRef.current.paused || !snapshotRef.current.signedIn) return;
          if (canDictateRef.current && !canDictateRef.current()) return;
          if (overlayDictateIntent(snapshotRef.current.dictation) !== "start") return;
          try {
            lockRef.current(action.targetId);
          } catch (reason) {
            flash(reason instanceof Error ? reason.message : String(reason));
            return;
          }
          overrideDestination("remote-dictation");
          armRef.current?.();
          controller.reset();
          await controller.start(providerRef.current());
          if (releasedHolds.current.has(token)) {
            await controller.stop();
          }
          return;
        }
        case "set-destination":
          onDestination(action.destination);
          return;
        case "capture-selection":
          await captureSelection();
          return;
        case "copy-note": {
          const text = notesRef.current.find((note) => note.id === action.id)?.text;
          if (!text) {
            flash("That note is no longer in the inbox.");
            return;
          }
          await copyText(text);
          flash("Copied.");
          return;
        }
        case "copy-handoff": {
          const text = handoffsRef.current.find((handoff) => handoff.id === action.id)?.text;
          if (!text) {
            flash("That handoff is no longer pending.");
            return;
          }
          if (classifyHandoffText(text).kind !== "text") {
            flash("Open Handoffs and choose Continue.");
            return;
          }
          await copyText(text);
          flash("Copied.");
          return;
        }
        case "insert-handoff": {
          const text = handoffsRef.current.find((handoff) => handoff.id === action.id)?.text;
          if (!text) {
            flash("That handoff is no longer pending.");
            return;
          }
          if (classifyHandoffText(text).kind !== "text") {
            flash("Open Handoffs and choose Continue.");
            return;
          }
          try {
            await insertHandoff(text);
            flash("Inserted.");
          } catch (reason) {
            flash(reason instanceof Error ? reason.message : String(reason));
          }
          return;
        }
        case "dismiss-handoff":
          try {
            await dismissHandoff(action.id);
          } catch (reason) {
            flash(reason instanceof Error ? reason.message : String(reason));
          }
          return;
        case "open-settings":
          quietly(platform.openSettings());
          return;
        case "assistant-toggle": {
          const intent = overlayAssistantIntent(snapshotRef.current.assistant);
          if (intent === "start") {
            if (snapshotRef.current.paused || !snapshotRef.current.signedIn) return;
            assistantController.start();
            return;
          }
          assistantController.end();
          return;
        }
        case "assistant-interrupt":
          assistantController.interruptPlayback();
          return;
        case "detach-selection":
          assistantController.detachSelection();
          return;
        case "confirm-action":
          assistantController.confirmPending();
          return;
        case "cancel-action":
          assistantController.cancelPending();
          return;
        default: {
          const unhandled: never = action;
          throw new Error(`Unhandled overlay action: ${String(unhandled)}`);
        }
      }
    }
  }, [
    platform,
    controller,
    assistantController,
    onDestination,
    overrideDestination,
    insertHandoff,
    dismissHandoff,
    captureSelection,
    flash,
  ]);

  return snapshot;
}
