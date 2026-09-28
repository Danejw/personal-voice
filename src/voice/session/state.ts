export type VoiceState =
  | "IDLE"
  | "CONNECTING"
  | "LISTENING"
  | "FINALIZING"
  | "INSERTING"
  | "ERROR";

export type VoiceAction =
  | { type: "start" }
  | { type: "connected" }
  | { type: "finish" }
  | { type: "transcribed" }
  | { type: "inserted" }
  | { type: "fail" }
  | { type: "cancel" }
  | { type: "reset" };

export const initialVoiceState: VoiceState = "IDLE";

/** Lifecycle only; orchestration lives in `DictationController`. */
export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "start": return state === "IDLE" ? "CONNECTING" : state;
    case "connected": return state === "CONNECTING" ? "LISTENING" : state;
    // Releasing while still connecting finalizes from the buffered audio.
    case "finish": return state === "CONNECTING" || state === "LISTENING" ? "FINALIZING" : state;
    case "transcribed": return state === "FINALIZING" ? "INSERTING" : state;
    case "inserted": return state === "INSERTING" ? "IDLE" : state;
    case "fail": return state === "IDLE" ? state : "ERROR";
    // An insertion already in progress cannot be taken back.
    case "cancel": return state === "CONNECTING" || state === "LISTENING" || state === "FINALIZING" ? "IDLE" : state;
    case "reset": return "IDLE";
    default: {
      const unhandled: never = action;
      throw new Error(`Unhandled voice action: ${JSON.stringify(unhandled)}`);
    }
  }
}
