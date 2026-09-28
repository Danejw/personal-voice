import type { Handoff, OwnedDevice } from "@/handoffs/handoff";
import type { VoiceNote } from "@/notes/voiceNote";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";
import type { VoiceState } from "@/voice/session/state";

export const OVERLAY_ITEM_LIMIT = 3;
export const OVERLAY_TEXT_LIMIT = 160;

export type OverlayDictation = "idle" | "listening" | "finalizing" | "error";

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
}

export type OverlayHoldDestination = "voice-note" | "send-to-device";

export type OverlayAction =
  | { type: "dictate-toggle" }
  | { type: "dictate-hold"; phase: "start" | "stop"; destination: OverlayHoldDestination; id: number }
  | { type: "set-destination"; destination: TranscriptDestinationId }
  | { type: "capture-selection" }
  | { type: "insert-handoff"; id: string }
  | { type: "dismiss-handoff"; id: string }
  | { type: "copy-note"; id: string }
  | { type: "copy-handoff"; id: string }
  | { type: "open-settings" };

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

export function buildOverlaySnapshot(input: {
  visible: boolean;
  state: VoiceState;
  error: string | null;
  destination: TranscriptDestinationId;
  signedIn: boolean;
  paused: boolean;
  notes: VoiceNote[];
  handoffs: Handoff[];
  devices: OwnedDevice[];
  capture: string | null;
  notice: string | null;
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
  };
}

/** Short enough for the overlay; full text stays in the stores and is copied by id. */
export function clipOverlayText(text: string, limit = OVERLAY_TEXT_LIMIT): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}

export function overlayNotesFrom(notes: VoiceNote[]): OverlayItem[] {
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
    text: handoff.text,
    meta: devices.find((device) => device.id === handoff.sourceDeviceId)?.name ?? "Another device",
  }));
}

export function parseOverlayAction(payload: unknown): OverlayAction | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { type?: unknown; destination?: unknown; id?: unknown; phase?: unknown };
  switch (record.type) {
    case "dictate-toggle":
    case "capture-selection":
    case "open-settings":
      return { type: record.type };
    case "dictate-hold":
      return (record.phase === "start" || record.phase === "stop")
        && (record.destination === "voice-note" || record.destination === "send-to-device")
        && typeof record.id === "number"
        ? { type: "dictate-hold", phase: record.phase, destination: record.destination, id: record.id }
        : null;
    case "set-destination":
      return record.destination === "active-field"
        || record.destination === "voice-note"
        || record.destination === "send-to-device"
        ? { type: "set-destination", destination: record.destination }
        : null;
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
