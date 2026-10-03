import { REMOTE_DICTATION_HOLD_MS } from "@/remote-dictation/constants";

export type RemoteDictationGestureResult =
  | { action: "cycle" }
  | { action: "start-hold" }
  | { action: "stop-hold" }
  | { action: "cancel" };

/**
 * Pure tap-versus-hold rules for the Remote Dictation control.
 * A hold past the threshold starts dictation; releasing before that only cycles.
 */
export function resolveRemoteDictationGesture(input: {
  phase: "down" | "up" | "cancel";
  heldMs: number;
  holdStarted: boolean;
  available: boolean;
}): RemoteDictationGestureResult | null {
  if (!input.available) return null;
  if (input.phase === "down") {
    return input.heldMs >= REMOTE_DICTATION_HOLD_MS ? { action: "start-hold" } : null;
  }
  if (input.phase === "cancel") {
    return input.holdStarted ? { action: "stop-hold" } : { action: "cancel" };
  }
  if (input.holdStarted) return { action: "stop-hold" };
  return { action: "cycle" };
}
