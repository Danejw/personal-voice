import type { AssistantStatus } from "@/assistant/state";
import { handoffDisplayText } from "@/assistant/continuation";
import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import type { Note } from "@/notes/note";
import { migrateDestinationId, type TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";
import type { VoiceState } from "@/voice/session/state";

export const OVERLAY_ITEM_LIMIT = 3;
export const OVERLAY_TEXT_LIMIT = 160;

export type OverlayDictation = "idle" | "listening" | "finalizing" | "error";

/** Assistant on the floating control. Separate from the dictation mic. */
export type OverlayAssistant = "idle" | "listening" | "responding" | "error";

export interface OverlayItem {
  id: string;
  text: string;
  meta: string;
}

export interface OverlaySnapshot {
  visible: boolean;
  dictation: OverlayDictation;
  error: string | null;
  destination: TranscriptDestinationId;
  signedIn: boolean;
  paused: boolean;
  notes: OverlayItem[];
  handoffs: OverlayItem[];
  capture: string | null;
  notice: string | null;
  assistant: OverlayAssistant;
  assistantError: string | null;
  selectionPreview: string | null;
  selectionSource: string | null;
  pendingTitle: string | null;
  pendingPreview: string | null;
  pendingWorking: boolean;
  /** Fallback mode: Stop and listen cuts off playback and resumes the microphone. */
  assistantInterrupt: boolean;
  /** Live Camera Context is sending frames. Keep the indicator obvious and small. */
  cameraOn: boolean;
  computerActive: boolean;
  remoteTargetId: string | null;
  remoteTargetLabel: string | null;
  /** Account device platform string (`android`, `windows`, …). */
  remoteTargetPlatform: string | null;
  /** Compact icon kind for the Remote Dictation control. */
  remoteTargetKind: "phone" | "laptop" | "desktop" | "unknown";
  remoteTargetOnline: boolean;
  remoteTargetCount: number;
  remoteDictationActive: boolean;
  /** Increments when Remote Dictation flashes a cycle tip. */
  remoteTipEpoch: number;
}

export type OverlayHoldDestination = "voice-note";

export type OverlayAction =
  | { type: "dictate-toggle" }
  | { type: "dictate-hold"; phase: "start" | "stop" | "cancel"; destination: OverlayHoldDestination; id: number }
  | { type: "cycle-remote-target" }
  | { type: "remote-dictate-hold"; phase: "start" | "stop"; targetId: string; id: number }
  | { type: "set-destination"; destination: TranscriptDestinationId }
  | { type: "capture-selection" }
  | { type: "insert-handoff"; id: string }
  | { type: "dismiss-handoff"; id: string }
  | { type: "copy-note"; id: string }
  | { type: "copy-handoff"; id: string }
  | { type: "open-settings" }
  | { type: "assistant-toggle" }
  | { type: "assistant-interrupt" }
  | { type: "detach-selection" }
  | { type: "confirm-action" }
  | { type: "cancel-action" };

export const emptyOverlaySnapshot: OverlaySnapshot = {
  visible: false,
  dictation: "idle",
  error: null,
  destination: "active-field",
  signedIn: false,
  paused: false,
  notes: [],
  handoffs: [],
  capture: null,
  notice: null,
  assistant: "idle",
  assistantError: null,
  selectionPreview: null,
  selectionSource: null,
  pendingTitle: null,
  pendingPreview: null,
  pendingWorking: false,
  assistantInterrupt: false,
  cameraOn: false,
  computerActive: false,
  remoteTargetId: null,
  remoteTargetLabel: null,
  remoteTargetPlatform: null,
  remoteTargetKind: "unknown",
  remoteTargetOnline: false,
  remoteTargetCount: 0,
  remoteDictationActive: false,
  remoteTipEpoch: 0,
};

export function overlayDictationFrom(state: VoiceState): OverlayDictation {
  switch (state) {
    case "IDLE": return "idle";
    case "CONNECTING":
    case "LISTENING": return "listening";
    case "FINALIZING":
    case "INSERTING": return "finalizing";
    case "ERROR": return "error";
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled voice state: ${String(unhandled)}`);
    }
  }
}

/** Clicking the same control starts, stops, or waits out transcription. */
export function overlayDictateIntent(dictation: OverlayDictation): "start" | "stop" | "ignore" {
  switch (dictation) {
    case "idle":
    case "error":
      return "start";
    case "listening":
      return "stop";
    case "finalizing":
      return "ignore";
    default: {
      const unhandled: never = dictation;
      throw new Error(`Unhandled overlay dictation: ${String(unhandled)}`);
    }
  }
}

/** Maps the Assistant machine onto the floating control. Connecting counts as listening. */
export function overlayAssistantFrom(status: AssistantStatus): OverlayAssistant {
  switch (status) {
    case "IDLE": return "idle";
    case "CONNECTING":
    case "READY": return "listening";
    case "RESPONDING": return "responding";
    case "ERROR": return "error";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled assistant status: ${String(unhandled)}`);
    }
  }
}

/** True while fallback playback should be cut off from the floating control. */
export function overlayAssistantInterrupt(echoFallback: boolean, playbackHeld: boolean, assistant: OverlayAssistant): boolean {
  if (!echoFallback) return false;
  return playbackHeld || assistant === "responding";
}

/** Press starts a stopped Assistant and ends a running one. */
export function overlayAssistantIntent(assistant: OverlayAssistant): "start" | "end" {
  switch (assistant) {
    case "idle":
    case "error":
      return "start";
    case "listening":
    case "responding":
      return "end";
    default: {
      const unhandled: never = assistant;
      throw new Error(`Unhandled overlay assistant: ${String(unhandled)}`);
    }
  }
}

/**
 * The hidden Android WebView stays resumed while dictation or Assistant still needs
 * the microphone or the speakers. Idle and a failed Assistant let it sleep again.
 */
export function overlayKeepsWebViewAwake(dictation: OverlayDictation, assistant: OverlayAssistant): boolean {
  if (dictation !== "idle") return true;
  return assistant === "listening" || assistant === "responding";
}

/** Which session a floating-control toggle drives. Dictation and Assistant never share a button. */
export function overlayToggleTarget(action: OverlayAction): "dictation" | "assistant" | null {
  switch (action.type) {
    case "dictate-toggle": return "dictation";
    case "assistant-toggle": return "assistant";
    default: return null;
  }
}

export function buildOverlaySnapshot(input: {
  visible: boolean;
  state: VoiceState;
  error: string | null;
  destination: TranscriptDestinationId;
  signedIn: boolean;
  paused: boolean;
  notes: Note[];
  handoffs: Handoff[];
  devices: OwnedDevice[];
  capture: string | null;
  notice: string | null;
  assistant: OverlayAssistant;
  assistantError: string | null;
  selectionPreview: string | null;
  selectionSource: string | null;
  pendingTitle: string | null;
  pendingPreview: string | null;
  pendingWorking: boolean;
  assistantInterrupt?: boolean;
  cameraOn?: boolean;
  computerActive?: boolean;
  remoteTargetId?: string | null;
  remoteTargetLabel?: string | null;
  remoteTargetPlatform?: string | null;
  remoteTargetKind?: "phone" | "laptop" | "desktop" | "unknown";
  remoteTargetOnline?: boolean;
  remoteTargetCount?: number;
  remoteDictationActive?: boolean;
  remoteTipEpoch?: number;
}): OverlaySnapshot {
  return {
    visible: input.visible,
    dictation: overlayDictationFrom(input.state),
    error: input.error,
    destination: input.destination,
    signedIn: input.signedIn,
    paused: input.paused,
    notes: overlayNotesFrom(input.notes),
    handoffs: overlayHandoffsFrom(input.handoffs, input.devices),
    capture: input.capture,
    notice: input.notice,
    assistant: input.assistant,
    assistantError: input.assistantError,
    selectionPreview: input.selectionPreview,
    selectionSource: input.selectionSource,
    pendingTitle: input.pendingTitle,
    pendingPreview: input.pendingPreview,
    pendingWorking: input.pendingWorking,
    assistantInterrupt: input.assistantInterrupt === true,
    cameraOn: input.cameraOn === true,
    computerActive: input.computerActive === true,
    remoteTargetId: input.remoteTargetId ?? null,
    remoteTargetLabel: input.remoteTargetLabel ?? null,
    remoteTargetPlatform: input.remoteTargetPlatform ?? null,
    remoteTargetKind: input.remoteTargetKind ?? "unknown",
    remoteTargetOnline: input.remoteTargetOnline === true,
    remoteTargetCount: input.remoteTargetCount ?? 0,
    remoteDictationActive: input.remoteDictationActive === true,
    remoteTipEpoch: input.remoteTipEpoch ?? 0,
  };
}

/** Short enough for the overlay; full text stays in the stores and is copied by id. */
export function clipOverlayText(text: string, limit = OVERLAY_TEXT_LIMIT): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}

export function overlayNotesFrom(notes: Note[]): OverlayItem[] {
  return notes
    .filter((note) => note.status === "inbox")
    .slice(0, OVERLAY_ITEM_LIMIT)
    .map((note) => ({
      id: note.id,
      text: note.text,
      meta: new Date(note.createdAt).toLocaleString(),
    }));
}

export function overlayHandoffsFrom(handoffs: Handoff[], devices: OwnedDevice[]): OverlayItem[] {
  return handoffs.slice(0, OVERLAY_ITEM_LIMIT).map((handoff) => ({
    id: handoff.id,
      text: handoffDisplayText(handoff.text),
    meta: devices.find((device) => device.id === handoff.sourceDeviceId)?.name ?? "Another device",
  }));
}

function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 80 && !/\s/.test(value);
}

export function parseOverlayAction(payload: unknown): OverlayAction | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as {
    type?: unknown;
    destination?: unknown;
    id?: unknown;
    phase?: unknown;
    targetId?: unknown;
  };
  switch (record.type) {
    case "dictate-toggle":
    case "capture-selection":
    case "open-settings":
    case "assistant-toggle":
    case "assistant-interrupt":
    case "detach-selection":
    case "confirm-action":
    case "cancel-action":
    case "cycle-remote-target":
      return { type: record.type };
    case "dictate-hold":
      return (record.phase === "start" || record.phase === "stop" || record.phase === "cancel")
        && record.destination === "voice-note"
        && typeof record.id === "number"
        ? { type: "dictate-hold", phase: record.phase, destination: record.destination, id: record.id }
        : null;
    case "remote-dictate-hold":
      return (record.phase === "start" || record.phase === "stop")
        && isDeviceId(record.targetId)
        && typeof record.id === "number"
        ? { type: "remote-dictate-hold", phase: record.phase, targetId: record.targetId, id: record.id }
        : null;
    case "set-destination": {
      const destination = migrateDestinationId(record.destination);
      return destination ? { type: "set-destination", destination } : null;
    }
    case "insert-handoff":
    case "dismiss-handoff":
    case "copy-note":
    case "copy-handoff":
      return typeof record.id === "string" && record.id
        ? { type: record.type, id: record.id }
        : null;
    default:
      return null;
  }
}
