import type { DictationSnapshot } from "@/voice/session/DictationController";

/** Escape cancels only before insertion starts. */
export function isCancellable(state: DictationSnapshot["state"]): boolean {
  return state === "CONNECTING" || state === "LISTENING" || state === "FINALIZING";
}
