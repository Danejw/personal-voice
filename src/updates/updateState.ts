import type { AvailableUpdate } from "@/platform/PlatformAdapter";

/**
 * `handedOff`: Android opened the APK download, and the rest happens in the browser and the
 * package installer. Windows never gets there: its installer closes the app.
 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking"; manual: boolean }
  | { kind: "upToDate" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "installing"; update: AvailableUpdate }
  | { kind: "handedOff"; update: AvailableUpdate }
  | { kind: "error"; message: string; update: AvailableUpdate | null };

export type UpdateEvent =
  | { type: "check"; manual: boolean }
  | { type: "checked"; update: AvailableUpdate | null }
  | { type: "checkFailed" }
  | { type: "install" }
  | { type: "installStarted" }
  | { type: "installFailed"; message: string };

export const initialUpdateState: UpdateState = { kind: "idle" };

export const CHECK_FAILED = "Couldn't check for updates. Check your connection and try again.";

/** Events that don't apply to the current state are ignored, so a late check result can't undo an install. */
export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case "check":
      return state.kind === "checking" || state.kind === "installing" ? state : { kind: "checking", manual: event.manual };
    case "checked":
      if (state.kind !== "checking") return state;
      return event.update ? { kind: "available", update: event.update } : { kind: "upToDate" };
    case "checkFailed":
      if (state.kind !== "checking") return state;
      // The automatic check at startup stays quiet offline; only a check the user asked for reports it.
      return state.manual ? { kind: "error", message: CHECK_FAILED, update: null } : initialUpdateState;
    case "install":
      if (state.kind === "available" || state.kind === "handedOff") return { kind: "installing", update: state.update };
      if (state.kind === "error" && state.update) return { kind: "installing", update: state.update };
      return state;
    case "installStarted":
      return state.kind === "installing" ? { kind: "handedOff", update: state.update } : state;
    case "installFailed":
      return state.kind === "installing" ? { kind: "error", message: event.message, update: state.update } : state;
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled update event: ${String(unhandled)}`);
    }
  }
}
