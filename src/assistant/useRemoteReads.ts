import { useEffect, useSyncExternalStore } from "react";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import { backgroundTraffic } from "@/services/backgroundTraffic";
import type { RemoteReadSnapshot, RemoteReadStore } from "@/assistant/RemoteReadStore";

// Wake notifications are immediate; the slower poll only recovers missed wakes.
const REMOTE_READ_POLL_MS = 15_000;

/** Refreshes presence and answers read requests aimed at this device. */
export function useRemoteReads(store: RemoteReadStore, userId: string | null): RemoteReadSnapshot {
  useEffect(() => {
    if (!userId) return;
    let pending = false;
    const tick = () => {
      if (pending) return; // LAN + cloud + poll cannot execute the same request concurrently.
      if (!backgroundTraffic.canPoll()) return;
      pending = true;
      void store.poll(userId)
        .then(() => backgroundTraffic.noteSuccess())
        .catch(error => backgroundTraffic.noteFailure(error))
        .finally(() => { pending = false; });
    };
    tick();
    const timer = window.setInterval(tick, REMOTE_READ_POLL_MS);
    const unsubscribe = deviceLinkManager.subscribeWakes(family => {
      if (family === "remote-read") tick();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [store, userId]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
