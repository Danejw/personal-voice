import { useEffect, useSyncExternalStore } from "react";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import type { ComputerActionSnapshot, ComputerActionStore } from "@/assistant/ComputerActionStore";

const COMPUTER_ACTION_POLL_MS = 4_000;

/** Answers allowlisted action requests aimed at this device. */
export function useComputerActions(store: ComputerActionStore, userId: string | null): ComputerActionSnapshot {
  useEffect(() => {
    if (!userId) return;
    let pending = false;
    const tick = () => {
      if (pending) return; // LAN + cloud + poll cannot execute the same request concurrently.
      pending = true;
      void store.poll(userId).catch(error => store.reportPollFailure(error)).finally(() => { pending = false; });
    };
    tick();
    const timer = window.setInterval(tick, COMPUTER_ACTION_POLL_MS);
    const unsubscribe = deviceLinkManager.subscribeWakes(family => {
      if (family === "computer-action") tick();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [store, userId]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
