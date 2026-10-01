import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { AvailableUpdate, PlatformAdapter } from "@/platform/PlatformAdapter";
import { shouldAutoInstallUpdate, shouldOfferUpdateToast } from "@/updates/updatePrompt";
import { initialUpdateState, updateReducer } from "@/updates/updateState";
import type { UpdateState } from "@/updates/updateState";

export interface Updates {
  state: UpdateState;
  /** The installed version, once read. */
  version: string | null;
  /** Available update to surface in a toast when auto-update is off. */
  offer: AvailableUpdate | null;
  check(): void;
  install(): void;
  dismissOffer(): void;
}

export interface UseUpdatesOptions {
  /** Install updates found at startup without asking. */
  autoUpdate: boolean;
  /** True while dictation (or similar) would make a Windows install unsafe. */
  busy: boolean;
}

function installError(reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return detail ? `The update couldn't be installed: ${detail}` : "The update couldn't be installed.";
}

/** Checks once at startup, quietly, and again whenever the user asks. */
export function useUpdates(platform: PlatformAdapter, { autoUpdate, busy }: UseUpdatesOptions): Updates {
  const [state, dispatch] = useReducer(updateReducer, initialUpdateState);
  const [version, setVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const autoAttemptedRef = useRef<string | null>(null);
  const installRef = useRef<() => void>(() => {});

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

  installRef.current = install;

  const available = state.kind === "available" ? state.update : null;

  useEffect(() => {
    if (!available) return;
    const alreadyAttempted = autoAttemptedRef.current === available.version;
    if (!shouldAutoInstallUpdate(autoUpdate, busy, alreadyAttempted)) return;
    autoAttemptedRef.current = available.version;
    installRef.current();
  }, [available, autoUpdate, busy]);

  const offer =
    available && shouldOfferUpdateToast(autoUpdate, available.version, dismissedVersion)
      ? available
      : null;

  return {
    state,
    version,
    offer,
    check: () => void runCheck(true),
    install,
    dismissOffer: () => {
      if (available) setDismissedVersion(available.version);
    },
  };
}
