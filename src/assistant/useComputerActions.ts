import { useEffect, useSyncExternalStore } from "react";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { backgroundTraffic } from "@/services/backgroundTraffic";
import type { ComputerActionSnapshot, ComputerActionStore } from "@/assistant/ComputerActionStore";

// Wake notifications are immediate; the slower poll only recovers missed wakes.
const COMPUTER_ACTION_POLL_MS = 15_000;

/** Answers allowlisted action requests aimed at this device. */
export function useComputerActions(store: ComputerActionStore, userId: string | null): ComputerActionSnapshot {
  useEffect(() => {
    if (!userId) return;
    let pending = false;
    const tick = () => {
      if (pending) return; // LAN + cloud + poll cannot execute the same request concurrently.
      if (!backgroundTraffic.canPoll()) return;
      pending = true;
      void store.poll(userId)
        .then(() => backgroundTraffic.noteSuccess())
        .catch(error => {
          backgroundTraffic.noteFailure(error);
          store.reportPollFailure(error);
        })
        .finally(() => { pending = false; });
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
