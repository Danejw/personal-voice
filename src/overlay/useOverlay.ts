import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyHandoffText } from "@/assistant/continuation";
import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import { buildOverlaySnapshot, clipOverlayText, overlayAssistantFrom, overlayAssistantIntent, overlayDictateIntent } from "@/overlay/overlay";
import type { OverlayAction, OverlaySnapshot } from "@/overlay/overlay";
import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSnapshot } from "@/assistant/state";
import type { VoiceNote } from "@/notes/voiceNote";
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
  notes: VoiceNote[];
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
}: OverlayBindings): OverlaySnapshot {
  const [capture, setCapture] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const providerRef = useRef(getProvider);
  const armRef = useRef(onArmDictation);
  const canDictateRef = useRef(canDictate);
  useEffect(() => { providerRef.current = getProvider; }, [getProvider]);
  armRef.current = onArmDictation;
  canDictateRef.current = canDictate;

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
    notice,
    assistant: overlayAssistantFrom(assistant.status),
    assistantError: assistant.status === "ERROR" ? assistant.error : null,
    selectionPreview: assistant.selection ? clipOverlayText(assistant.selection.text) : null,
    selectionSource: assistant.selection?.sourceApp ?? null,
    pendingTitle: assistant.pendingAction?.title ?? null,
    pendingPreview: assistant.pendingAction?.preview ?? null,
    pendingWorking: assistant.pendingAction?.working ?? false,
  }), [visible, dictation.state, dictation.error, destination, signedIn, paused, notes, handoffs, devices, capture, notice, assistant]);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const handoffsRef = useRef(handoffs);
  handoffsRef.current = handoffs;

  useEffect(() => {
    quietly(platform.syncOverlay(snapshot));
  }, [platform, snapshot]);

  const releasedHolds = useRef(new Set<number>());

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
          if (action.phase === "stop") {
            releasedHolds.current.add(action.id);
            await controller.stop();
            return;
          }
          if (releasedHolds.current.has(action.id)) return;
          if (snapshotRef.current.paused || !snapshotRef.current.signedIn) return;
          if (canDictateRef.current && !canDictateRef.current()) return;
          if (overlayDictateIntent(snapshotRef.current.dictation) !== "start") return;
          overrideDestination(action.destination);
          armRef.current?.();
          controller.reset();
          await controller.start(providerRef.current());
          if (releasedHolds.current.has(action.id)) await controller.stop();
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
  }, [platform, controller, assistantController, onDestination, overrideDestination, insertHandoff, dismissHandoff, captureSelection, flash]);

  return snapshot;
}
