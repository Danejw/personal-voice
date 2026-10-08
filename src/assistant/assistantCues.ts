import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSnapshot } from "@/assistant/state";
import type { DictationCue, PlatformAdapter } from "@/platform/PlatformAdapter";

type CueState = Pick<AssistantSnapshot, "status" | "resuming">;

interface CueTransition {
  cue: DictationCue | null;
  readySeen: boolean;
}

/**
 * Only the first successful connection of a user-started Assistant session
 * gets a ready cue. Reconnects and subsequent responses stay silent.
 */
export function assistantCueTransition(
  previous: CueState,
  next: CueState,
  readySeen: boolean,
): CueTransition {
  if ((previous.status === "IDLE" || previous.status === "ERROR") && next.status === "CONNECTING") {
    return { cue: null, readySeen: false };
  }
  if (previous.status === "CONNECTING" && next.status === "READY" && !previous.resuming && !readySeen) {
    return { cue: "ready", readySeen: true };
  }
  if (next.status === "IDLE" && previous.status !== "IDLE") {
    // A user-ended session gets a done cue; clearing a failed session does not.
    return { cue: previous.status === "ERROR" ? null : "done", readySeen: false };
  }
  if (next.status === "ERROR") return { cue: null, readySeen: false };
  return { cue: null, readySeen };
}

/** Listen once at the controller boundary, regardless of whether the Assistant UI is visible. */
export function bindAssistantCues(
  controller: Pick<AssistantController, "getSnapshot" | "subscribe">,
  platform: Pick<PlatformAdapter, "playDictationCue">,
  enabled: () => boolean,
): () => void {
  let previous = controller.getSnapshot();
  let readySeen = previous.status === "READY" || previous.status === "RESPONDING";
  return controller.subscribe((next) => {
    const transition = assistantCueTransition(previous, next, readySeen);
    previous = next;
    readySeen = transition.readySeen;
    if (!transition.cue || !enabled()) return;
    // Playback must never interfere with the Assistant microphone/session.
    try {
      void platform.playDictationCue(transition.cue).catch(() => undefined);
    } catch {
      // Treat synchronous platform failures as non-fatal too.
    }
  });
}
