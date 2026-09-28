import type { IndicatorState } from "../../platform/PlatformAdapter";
import type { DictationSnapshot } from "./DictationController";

/** What the floating indicator shows for a snapshot; `null` hides it. */
export function indicatorFor({ state, error }: DictationSnapshot): IndicatorState | null {
  switch (state) {
    case "IDLE": return null;
    case "CONNECTING":
    case "LISTENING": return { kind: "listening" };
    case "FINALIZING":
    case "INSERTING": return { kind: "finalizing" };
    case "ERROR": return { kind: "error", message: error ?? "Dictation failed." };
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled voice state: ${String(unhandled)}`);
    }
  }
}

/** Escape cancels only before insertion starts. */
export function isCancellable(state: DictationSnapshot["state"]): boolean {
  return state === "CONNECTING" || state === "LISTENING" || state === "FINALIZING";
}
