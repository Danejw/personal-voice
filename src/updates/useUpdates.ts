import { useCallback, useEffect, useReducer, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import { initialUpdateState, updateReducer } from "@/updates/updateState";
import type { UpdateState } from "@/updates/updateState";

export interface Updates {
  state: UpdateState;
  /** The installed version, once read. */
  version: string | null;
  check(): void;
  install(): void;
}

function installError(reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return detail ? `The update couldn't be installed: ${detail}` : "The update couldn't be installed.";
}

/** Checks once at startup, quietly, and again whenever the user asks. Nothing installs without a tap. */
export function useUpdates(platform: PlatformAdapter): Updates {
  const [state, dispatch] = useReducer(updateReducer, initialUpdateState);
  const [version, setVersion] = useState<string | null>(null);

  const runCheck = useCallback(async (manual: boolean) => {
    dispatch({ type: "check", manual });
    try {
      dispatch({ type: "checked", update: await platform.checkForUpdate() });
    } catch {
      dispatch({ type: "checkFailed" });
    }
  }, [platform]);

  useEffect(() => {
    getVersion().then(setVersion, () => setVersion(null));
    void runCheck(false);
  }, [runCheck]);

  const install = useCallback(() => {
    if (state.kind !== "available" && state.kind !== "handedOff" && state.kind !== "error") return;
    const { update } = state;
    if (!update) return;
    dispatch({ type: "install" });
    update.install().then(
      () => dispatch({ type: "installStarted" }),
      (reason: unknown) => dispatch({ type: "installFailed", message: installError(reason) }),
    );
  }, [state]);

  return { state, version, check: () => void runCheck(true), install };
}
