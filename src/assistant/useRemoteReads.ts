import { useEffect, useSyncExternalStore } from "react";
import { deviceLinkManager } from "@/device-link/DeviceLinkManager";
import type { RemoteReadSnapshot, RemoteReadStore } from "@/assistant/RemoteReadStore";

const REMOTE_READ_POLL_MS = 4_000;

/** Refreshes presence and answers read requests aimed at this device. */
export function useRemoteReads(store: RemoteReadStore, userId: string | null): RemoteReadSnapshot {
  useEffect(() => {
    if (!userId) return;
    let pending = false;
    const tick = () => {
      if (pending) return; // LAN + cloud + poll cannot execute the same request concurrently.
      pending = true;
      void store.poll(userId).catch(() => undefined).finally(() => { pending = false; });
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
