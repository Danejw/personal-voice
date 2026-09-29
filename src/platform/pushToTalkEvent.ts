import type { UsageTrigger } from "@/usage/usageEvents";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

export interface PushToTalkEvent {
  event: "press" | "release" | "cancel" | "capture-selection";
  /** When set, this utterance is delivered here without changing the saved destination. */
  destination?: TranscriptDestinationId;
  /** Set by the platform that emitted the press. The dictation state machine only copies it. */
  trigger?: UsageTrigger;
}

/** The Windows hook already names the binding through its destination override. */
export function windowsShortcutTrigger(destination?: TranscriptDestinationId): UsageTrigger {
  switch (destination) {
    case "voice-note": return "shortcut-note";
    case "send-to-device": return "shortcut-handoff";
    case "active-field":
    case undefined: return "shortcut-dictate";
    default: {
      const unhandled: never = destination;
      throw new Error(`Unhandled shortcut destination: ${String(unhandled)}`);
    }
  }
}

export function parsePushToTalk(payload: unknown): PushToTalkEvent | null {
  if (payload === "press" || payload === "release" || payload === "cancel" || payload === "capture-selection") {
    return { event: payload };
  }
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { event?: unknown; destination?: unknown };
  if (
    record.event !== "press"
    && record.event !== "release"
    && record.event !== "cancel"
    && record.event !== "capture-selection"
  ) {
    return null;
  }
  if (record.event !== "press") return { event: record.event };
  if (
    record.destination === "active-field"
    || record.destination === "voice-note"
    || record.destination === "send-to-device"
  ) {
    return { event: "press", destination: record.destination };
  }
  return { event: "press" };
}
